@tool
extends EditorPlugin
## Per-run CLI overrides avoid rewriting the project's movie file/fps/run args.

const Files = preload("res://addons/postplay/session_files.gd")
const Finalizer = preload("res://addons/postplay/capture_finalizer.gd")
const RUNTIME := "res://addons/postplay/runtime.gd"
const JOURNAL := "res://.godot/postplay-editor.json"
var _bar: HBoxContainer
var _record: Button
var _stop: Button
var _status: Label
var _directory := ""
var _previous_movie := false
var _was_playing := false
var _started_ticks := 0
var _stop_ticks := 0
var _worker: Thread
var _autoload_ok := false


func _enter_tree() -> void:
	name = "PostPlayEditor"
	var autoload: String = ProjectSettings.get_setting("autoload/PostPlay", "")
	if autoload.is_empty():
		add_autoload_singleton("PostPlay", RUNTIME)
		_autoload_ok = ProjectSettings.save() == OK and _owns_autoload()
	else:
		_autoload_ok = _owns_autoload()
	_bar = HBoxContainer.new()
	_record = Button.new()
	_record.text = "Record Session"
	_record.pressed.connect(start_recording)
	_bar.add_child(_record)
	_stop = Button.new()
	_stop.text = "Stop PostPlay"
	_stop.pressed.connect(stop_recording)
	_stop.disabled = true
	_bar.add_child(_stop)
	_status = Label.new()
	_bar.add_child(_status)
	_record.disabled = not _autoload_ok
	add_control_to_container(CONTAINER_TOOLBAR, _bar)
	set_process(true)
	var journal := Files.read_json(ProjectSettings.globalize_path(JOURNAL))
	if journal.get("active", false):
		EditorInterface.set_movie_maker_enabled(journal.get("previous_movie", false))
		journal.active = false
		Files.write_json(ProjectSettings.globalize_path(JOURNAL), journal)
		_message("Recovered prior Movie Maker state; inspect previous capture: " + String(journal.get("directory", "")))
	elif not _autoload_ok:
		_message("Autoload name PostPlay is already used; no changes made to that autoload.")
	else:
		_message("Ready (30 fps AVI)")


func _disable_plugin() -> void:
	if _owns_autoload():
		remove_autoload_singleton("PostPlay")
		ProjectSettings.save()


func start_recording() -> Error:
	if not _autoload_ok or not _directory.is_empty() or _worker != null or EditorInterface.is_playing_scene():
		_message("Stop the current run before recording; verify the PostPlay autoload is available.")
		return ERR_BUSY
	var settings := EditorInterface.get_editor_settings()
	if settings.get_project_metadata("debug_options", "multiple_instances_enabled", false):
		_message("PostPlay records one run: disable multiple run instances first.")
		return ERR_UNAVAILABLE
	var scene: String = ProjectSettings.get_setting("application/run/main_scene", "")
	if scene.begins_with("uid://"):
		var uid := ResourceUID.text_to_id(scene)
		if uid == ResourceUID.INVALID_ID or not ResourceUID.has_id(uid):
			_message("Main scene UID is unknown; select and save the main scene again.")
			return ERR_UNCONFIGURED
		scene = ResourceUID.get_id_path(uid)
	if not scene.begins_with("res://") or not ResourceLoader.exists(scene):
		_message("Set and save a main scene before recording.")
		return ERR_UNCONFIGURED
	var project_name: String = ProjectSettings.get_setting("application/config/name", "Godot project")
	if project_name.is_empty():
		project_name = "Godot project"
	var project := {"id": "game-" + project_name.sha256_text().left(16), "name": project_name.left(256), "scene": scene.trim_prefix("res://")}
	if not _portable_scene(project.scene):
		_message("Main scene must have a portable res:// path.")
		return ERR_INVALID_PARAMETER
	var capture := {"mode": "movie_maker", "format": "avi", "fps": 30,
		"width": int(ProjectSettings.get_setting("display/window/size/viewport_width", 960)),
		"height": int(ProjectSettings.get_setting("display/window/size/viewport_height", 540)),
		"collision_debug": settings.get_project_metadata("debug_options", "run_debug_collisions", false)}
	if capture.width < 1 or capture.width > 16384 or capture.height < 1 or capture.height > 16384:
		_message("Configure supported viewport dimensions (1–16384) before recording.")
		return ERR_INVALID_PARAMETER
	var reserved := Files.reserve(ProjectSettings.get_setting("postplay/output_directory", "user://postplay/sessions"), project, capture)
	if reserved.is_empty():
		_message("Cannot reserve a fresh session directory. Check the output directory permissions.")
		return ERR_CANT_CREATE
	_directory = reserved.directory
	_previous_movie = EditorInterface.is_movie_maker_enabled()
	var error := Files.write_json(ProjectSettings.globalize_path(JOURNAL), {"active": true, "directory": _directory, "previous_movie": _previous_movie})
	if error != OK:
		Finalizer.finalize(_directory, "Editor state checkpoint failed; recording was not launched.")
		_directory = ""
		_message("Could not checkpoint editor state; capture not launched.")
		return error
	_was_playing = false
	_started_ticks = Time.get_ticks_msec()
	_stop_ticks = 0
	EditorInterface.set_movie_maker_enabled(false)
	_record.disabled = true
	_stop.disabled = false
	_stop.text = "Stop PostPlay"
	_message("Starting: " + _directory)
	EditorInterface.play_main_scene()
	return OK


func _run_scene(_scene: String, args: PackedStringArray) -> PackedStringArray:
	if _directory.is_empty():
		return args
	var separator := args.find("--")
	if separator < 0:
		separator = args.size()
	var engine_args := PackedStringArray()
	var index := 0
	while index < separator:
		if args[index] in ["--write-movie", "--fixed-fps"]:
			index += 2
			continue
		engine_args.append(args[index])
		index += 1
	engine_args.append_array(["--write-movie", _directory.path_join("recording.avi"), "--fixed-fps", "30"])
	var user_args := args.slice(separator + 1) if separator < args.size() else PackedStringArray()
	user_args.append("--postplay-session=" + _directory)
	engine_args.append("--")
	engine_args.append_array(user_args)
	return engine_args


func stop_recording() -> Error:
	if _directory.is_empty():
		return ERR_UNCONFIGURED
	if _stop_ticks != 0 and Time.get_ticks_msec() - _stop_ticks > 5000:
		EditorInterface.stop_playing_scene()
		_message("Forced stop; partial capture will remain incomplete.")
		return OK
	_stop_ticks = Time.get_ticks_msec()
	_message("Requesting graceful stop…")
	var error := Files.write_json(_directory.path_join("stop.request.json"), {"stop": true})
	if error != OK:
		_message("Cannot write graceful stop request; native Stop will leave an incomplete capture.")
	return error


func _process(_delta: float) -> void:
	if _worker != null:
		if not _worker.is_alive():
			var result: Dictionary = _worker.wait_to_finish()
			_worker = null
			_record.disabled = not _autoload_ok
			_message(result.message + " " + String(result.get("directory", "")))
		return
	if _directory.is_empty():
		return
	if EditorInterface.is_playing_scene():
		_was_playing = true
		if _stop_ticks != 0 and Time.get_ticks_msec() - _stop_ticks > 5000:
			_stop.text = "Force Stop (incomplete)"
		return
	var ready := Files.read_json(_directory.path_join("runtime.ready.json"))
	if ready.has("pid") and Files.process_alive(int(ready.pid)):
		return
	if _was_playing or Time.get_ticks_msec() - _started_ticks > 10000:
		_finish("" if _was_playing else "Editor launch did not start a runtime within 10 seconds.")


func _finish(failure: String) -> void:
	var directory := _directory
	_restore()
	_directory = ""
	_stop.disabled = true
	_message("Checking finalized media… " + directory)
	_worker = Thread.new()
	if _worker.start(func(): return Finalizer.finalize(directory, failure)) != OK:
		_worker = null
		_record.disabled = not _autoload_ok
		_message("Cannot start media finalizer; session remains unfinalized: " + directory)


func _restore() -> void:
	EditorInterface.set_movie_maker_enabled(_previous_movie)
	Files.write_json(ProjectSettings.globalize_path(JOURNAL), {"active": false, "directory": _directory, "previous_movie": _previous_movie})


func _exit_tree() -> void:
	if not _directory.is_empty():
		Files.write_json(_directory.path_join("stop.request.json"), {"stop": true})
		_restore()
		push_warning("PostPlay disabled/closed during capture; inspect unfinalized session: " + _directory)
	if _worker != null:
		_worker.wait_to_finish()
	remove_control_from_container(CONTAINER_TOOLBAR, _bar)
	_bar.queue_free()


func _message(message: String) -> void:
	_status.text = message.left(90)
	_status.tooltip_text = message
	print("PostPlay: ", message)


static func _portable_scene(path: String) -> bool:
	if path.is_empty() or path.length() > 512:
		return false
	for part in path.split("/"):
		if part in ["", ".", ".."]:
			return false
	for character in path:
		if character.unicode_at(0) < 32 or character.unicode_at(0) == 127 or character in "\\:%?#":
			return false
	return true


static func _owns_autoload() -> bool:
	var path := String(ProjectSettings.get_setting("autoload/PostPlay", "")).trim_prefix("*")
	if path.begins_with("uid://"):
		var uid := ResourceUID.text_to_id(path)
		if uid == ResourceUID.INVALID_ID or not ResourceUID.has_id(uid):
			return false
		path = ResourceUID.get_id_path(uid)
	return path == RUNTIME

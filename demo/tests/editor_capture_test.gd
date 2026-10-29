@tool
extends EditorPlugin
## GUI/editor integration check in a disposable project copy; no model requests.

const Files = preload("res://addons/postplay/session_files.gd")


func _enter_tree() -> void:
	call_deferred("_run")


func _wait_until(predicate: Callable, seconds: float = 30.0) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000)
	while not predicate.call():
		if Time.get_ticks_msec() > deadline:
			return false
		await get_tree().process_frame
	return true


func _run() -> void:
	get_tree().create_timer(70.0).timeout.connect(func(): get_tree().quit(1))
	await get_tree().process_frame
	await get_tree().process_frame
	var editor = Engine.get_singleton("EditorInterface")
	assert(editor != null)
	assert(await _wait_until(func(): return not editor.get_resource_filesystem().is_scanning()))
	var plugin = get_tree().root.find_child("PostPlayEditor", true, false)
	assert(plugin != null, "PostPlay editor plugin must be loaded")
	var output := OS.get_cmdline_user_args()[0]
	ProjectSettings.set_setting("postplay/output_directory", output)
	ProjectSettings.set_setting("editor/movie_writer/fps", 47)
	var original_path := output.path_join("original owner movie.avi")
	DirAccess.make_dir_recursive_absolute(output)
	var original := FileAccess.open(original_path, FileAccess.WRITE)
	original.store_string("synthetic original movie fixture")
	original.close()
	ProjectSettings.set_setting("editor/movie_writer/movie_file", original_path)
	ProjectSettings.set_setting("editor/run/main_run_args", "-- --fixture-user-argument=kept")
	# The shipped minimal scene has no UID header; normal editor saving assigns one.
	assert(ResourceSaver.save(load("res://main.tscn"), "res://main.tscn") == OK)
	assert(ResourceLoader.get_resource_uid("res://main.tscn") != ResourceUID.INVALID_ID)
	var directories: Array[String] = []
	for previous in [false, true]:
		editor.set_movie_maker_enabled(previous)
		if previous:
			ProjectSettings.set_setting("application/run/main_scene", ResourceUID.id_to_text(ResourceLoader.get_resource_uid("res://main.tscn")))
		assert(plugin.start_recording() == OK)
		var directory: String = plugin._directory
		directories.append(directory)
		assert(await _wait_until(func(): return FileAccess.file_exists(directory.path_join("runtime.ready.json"))))
		assert(plugin.start_recording() == ERR_BUSY)
		await get_tree().create_timer(0.4).timeout
		assert(plugin.stop_recording() == OK)
		assert(await _wait_until(func(): return plugin._directory.is_empty() and plugin._worker == null))
		var manifest := Files.read_json(directory.path_join("session.json"))
		assert(manifest.status == "complete", JSON.stringify(manifest.synchronization.notes))
		assert(editor.is_movie_maker_enabled() == previous)
		assert(ProjectSettings.get_setting("editor/movie_writer/fps") == 47)
		assert(ProjectSettings.get_setting("editor/movie_writer/movie_file") == original_path)
		assert(ProjectSettings.get_setting("editor/run/main_run_args") == "-- --fixture-user-argument=kept")
		assert(FileAccess.get_file_as_string(original_path) == "synthetic original movie fixture")
	assert(directories[0] != directories[1])
	# A normal run with Movie Maker originally off must not start PostPlay capture.
	editor.set_movie_maker_enabled(false)
	editor.play_main_scene()
	assert(await _wait_until(func(): return editor.is_playing_scene()))
	await get_tree().create_timer(0.3).timeout
	editor.stop_playing_scene()
	assert(await _wait_until(func(): return not editor.is_playing_scene()))
	assert(DirAccess.get_directories_at(output).size() == 2)
	# Reject multi-instance capture without changing the owner's current flag.
	var settings = editor.get_editor_settings()
	settings.set_project_metadata("debug_options", "multiple_instances_enabled", true)
	assert(plugin.start_recording() == ERR_UNAVAILABLE)
	assert(not editor.is_movie_maker_enabled())
	settings.set_project_metadata("debug_options", "multiple_instances_enabled", false)
	editor.set_movie_maker_enabled(true)
	assert(plugin.start_recording() == OK)
	var interrupted: String = plugin._directory
	assert(await _wait_until(func(): return FileAccess.file_exists(interrupted.path_join("runtime.ready.json"))))
	assert(DirAccess.make_dir_absolute(interrupted.path_join("stop.request.json.pending")) == OK)
	assert(plugin.stop_recording() != OK) # Failed stop request must be visible, never success.
	editor.stop_playing_scene() # Native stop deliberately bypasses PostPlay's graceful request.
	assert(await _wait_until(func(): return plugin._directory.is_empty() and plugin._worker == null))
	assert(Files.read_json(interrupted.path_join("session.json")).status == "incomplete")
	assert(editor.is_movie_maker_enabled())
	# Fail before launch and prove the prior owner state remains unchanged.
	ProjectSettings.set_setting("application/run/main_scene", "res://missing-fixture.tscn")
	assert(plugin.start_recording() == ERR_UNCONFIGURED)
	assert(editor.is_movie_maker_enabled())
	ProjectSettings.set_setting("application/run/main_scene", "res://main.tscn")
	ProjectSettings.set_setting("postplay/output_directory", original_path) # Not a directory.
	assert(plugin.start_recording() == ERR_CANT_CREATE)
	assert(editor.is_movie_maker_enabled())
	ProjectSettings.set_setting("postplay/output_directory", output)
	# Simulate an interrupted editor journal, then actually disable/re-enable the plugin.
	assert(Files.write_json(ProjectSettings.globalize_path(plugin.JOURNAL), {"active": true, "directory": interrupted, "previous_movie": true}) == OK)
	editor.set_movie_maker_enabled(false)
	editor.set_plugin_enabled("postplay", false)
	assert(not ProjectSettings.has_setting("autoload/PostPlay"))
	editor.set_plugin_enabled("postplay", true)
	await get_tree().process_frame
	assert(editor.is_movie_maker_enabled())
	assert(ProjectSettings.has_setting("autoload/PostPlay"))
	assert(get_tree().root.find_child("PostPlayEditor", true, false)._autoload_ok)
	assert(FileAccess.get_file_as_string(original_path) == "synthetic original movie fixture")
	print("POSTPLAY_EDITOR_RESULT " + JSON.stringify({"directories": directories, "interrupted": interrupted, "normal_run": true, "settings_restored": true, "recovery": true}))
	get_tree().quit(0)

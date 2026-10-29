extends "res://addons/postplay/collector.gd"
## Public PostPlay autoload. Ordinary runs are inactive and create no files.

var _recording_run := false


func _ready() -> void:
	var directory := ""
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--postplay-session="):
			directory = argument.trim_prefix("--postplay-session=")
	if directory.is_empty():
		set_process(false)
		return
	if Engine.get_write_movie_path() != directory.path_join("recording.avi"):
		push_error("PostPlay: Movie Maker output does not match the reserved session")
		get_tree().quit(1)
		return
	var error := start_reserved_session(directory)
	if error != OK:
		push_error("PostPlay: runtime capture could not start (%s)" % error_string(error))
		get_tree().quit(1)
		return
	_recording_run = true
	process_mode = Node.PROCESS_MODE_ALWAYS
	SessionFiles.write_json(directory.path_join("runtime.ready.json"), {"session_id": _manifest.session_id, "pid": OS.get_process_id()})
	print("PostPlay recording: ", directory)


func _process(delta: float) -> void:
	if not _recording_run:
		super._process(delta)
		return
	if not get_tree().paused:
		super._process(delta)
	if FileAccess.file_exists(session_directory.path_join("stop.request.json")):
		get_tree().quit()


func _exit_tree() -> void:
	if _recording_run and _active:
		var error := seal_for_finalization()
		if error == OK or (error == ERR_OUT_OF_MEMORY and _manifest.telemetry.truncated):
			SessionFiles.write_json(session_directory.path_join("runtime.closed.json"), {
				"session_id": _manifest.session_id, "event_count": _manifest.telemetry.event_count,
				"pid": OS.get_process_id()})
	super._exit_tree()

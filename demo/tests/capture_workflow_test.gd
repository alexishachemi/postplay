extends SceneTree
## Deterministic lifecycle/media fixtures, not actual gameplay recordings.

const Files = preload("res://addons/postplay/session_files.gd")
const Collector = preload("res://addons/postplay/collector.gd")
const Finalizer = preload("res://addons/postplay/capture_finalizer.gd")


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var mode := args[1]
	var reserved := Files.reserve(args[0], {"id": "fixture", "name": "Capture fixture", "scene": "main.tscn"}, {"fps": 30})
	assert(not reserved.is_empty())
	var directory: String = reserved.directory
	var capture := Collector.new()
	root.add_child(capture)
	assert(capture.start_reserved_session(directory) == OK)
	assert(capture.seal_for_finalization() == OK)
	var original_log := FileAccess.get_file_as_string(directory.path_join("events.jsonl"))
	var second := Collector.new()
	root.add_child(second)
	assert(second.start_reserved_session(directory) != OK)
	assert(second.start_session(args[0], reserved.manifest.project, {}, directory.get_file()) != OK)
	assert(FileAccess.get_file_as_string(directory.path_join("events.jsonl")) == original_log)
	if mode != "interrupted":
		assert(Files.write_json(directory.path_join("runtime.closed.json"), {"session_id": directory.get_file(), "event_count": 2}) == OK)
	if mode in ["complete", "fps"]:
		var output: Array = []
		assert(OS.execute("ffmpeg", PackedStringArray(["-v", "error", "-n", "-f", "lavfi", "-i", "color=c=blue:s=64x48:r=" + ("25" if mode == "fps" else "30"), "-t", "0.2", "-c:v", "mjpeg", directory.path_join("recording.avi")]), output, true) == 0)
	elif mode == "bad_media":
		var media := FileAccess.open(directory.path_join("recording.avi"), FileAccess.WRITE)
		media.store_string("synthetic invalid AVI fixture")
		media.close()
	elif mode == "corrupt_tail":
		var log := FileAccess.open(directory.path_join("events.jsonl"), FileAccess.READ_WRITE)
		log.seek_end()
		log.store_string("{\"broken\":")
		log.close()
	elif mode == "alive":
		Files.write_json(directory.path_join("runtime.ready.json"), {"session_id": directory.get_file(), "pid": OS.get_process_id()})
	var before := FileAccess.get_file_as_string(directory.path_join("session.json"))
	var result := Finalizer.finalize(directory)
	if mode == "complete":
		assert(result.ok, result.message)
	else:
		assert(not result.ok)
	if mode == "alive":
		assert(FileAccess.get_file_as_string(directory.path_join("session.json")) == before)
	else:
		var finalized := FileAccess.get_file_as_string(directory.path_join("session.json"))
		assert(not Finalizer.finalize(directory).ok) # Terminal manifests never promoted/replaced.
		assert(FileAccess.get_file_as_string(directory.path_join("session.json")) == finalized)
	print("POSTPLAY_WORKFLOW_RESULT " + directory)
	quit(0)

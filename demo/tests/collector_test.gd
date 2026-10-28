extends SceneTree
## Synthetic lifecycle fixture, not a gameplay recording or timing measurement.

const Collector = preload("res://addons/postplay/collector.gd")
const PROJECT := {"id": "fixture", "name": "Collector fixture", "scene": "main.tscn"}
var collector: Node
var output_root := ""
var mode := ""


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var arguments := OS.get_cmdline_user_args()
	assert(arguments.size() == 2)
	output_root = arguments[0]
	mode = arguments[1]
	collector = Collector.new()
	root.add_child(collector)
	assert(collector.start_session(output_root, PROJECT) == OK)
	assert(collector.start_session(output_root, PROJECT) == ERR_ALREADY_IN_USE)
	assert(collector.append_event("annotation", "fixture_observation", {"position": Vector2(1, 2), "safe": true}) == OK)
	assert(collector.append_event("invalid", "ignored") == ERR_INVALID_PARAMETER)
	assert(collector.append_event("annotation", "") == ERR_INVALID_PARAMETER)
	var directory: String = collector.session_directory
	if mode == "kill":
		# Deliberately don't checkpoint: persisted log may be ahead of the manifest.
		print("POSTPLAY_COLLECTOR_READY " + directory)
		return
	await process_frame
	await process_frame
	assert(collector.append_event("annotation", "after_frames", [true, null, 4.5]) == OK)
	if mode == "checkpoint":
		await create_timer(1.2).timeout
		var saved: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("session.json")))
		assert(saved.telemetry.event_count == 3)
		assert(saved.status == "recording")
	if mode == "limit":
		for index in range(collector.MAX_EVENTS - 3):
			assert(collector.append_event("annotation", "bounded") == OK)
		assert(collector.append_event("annotation", "excess") == ERR_OUT_OF_MEMORY)
		assert(collector.abort_session() == ERR_OUT_OF_MEMORY)
	elif mode == "bytes":
		var large := []
		for index in range(7):
			large.append("x".repeat(1000))
		while collector.append_event("annotation", "bounded_bytes", large) == OK:
			pass
		assert(collector.last_error == OK)
		assert(collector.abort_session() == ERR_OUT_OF_MEMORY)
	elif mode == "abort":
		assert(collector.abort_session() == OK)
	elif mode == "io_error":
		assert(collector.checkpoint() == OK)
		var manifest_path := directory.path_join("session.json")
		var previous := FileAccess.get_file_as_string(manifest_path)
		# Simulate an unwritable temporary manifest without changing old evidence.
		assert(DirAccess.make_dir_absolute(directory.path_join("session.json.pending")) == OK)
		assert(collector.append_event("annotation", "before_io_failure") == OK)
		assert(collector.checkpoint() != OK)
		assert(FileAccess.get_file_as_string(manifest_path) == previous)
		assert(collector.abort_session() != OK)
		assert(FileAccess.get_file_as_string(manifest_path) == previous)
	elif mode == "tree_exit":
		collector.queue_free()
		await process_frame
	else:
		assert(collector.seal_for_finalization() == OK)
	if is_instance_valid(collector) and mode != "tree_exit":
		assert(collector.append_event("annotation", "after_close") == ERR_UNCONFIGURED)
		assert(collector.abort_session() == ERR_UNCONFIGURED)
	# The same ID must fail without modifying any previous file.
	var second := Collector.new()
	root.add_child(second)
	var id: String = directory.get_file()
	var original_manifest := FileAccess.get_file_as_string(directory.path_join("session.json"))
	var original_events := FileAccess.get_file_as_string(directory.path_join("events.jsonl"))
	assert(second.start_session(output_root, PROJECT, {}, id) != OK)
	assert(FileAccess.get_file_as_string(directory.path_join("session.json")) == original_manifest)
	assert(FileAccess.get_file_as_string(directory.path_join("events.jsonl")) == original_events)
	assert(second.start_session(output_root, PROJECT, {}, "../unsafe") == ERR_INVALID_PARAMETER)
	assert(second.start_session(output_root, PROJECT, {}, id + "\n") == ERR_INVALID_PARAMETER)
	assert(second.start_session(output_root, PROJECT, {"fps": NAN}) == ERR_INVALID_PARAMETER)
	assert(second.start_session(output_root, PROJECT, {"width": 4.5}) == ERR_INVALID_PARAMETER)
	assert(second.start_session(output_root, PROJECT, {"mode": "external"}) == ERR_INVALID_PARAMETER)
	assert(second.start_session(output_root, {"id": "fixture", "name": "Fixture", "scene": "../unsafe"}) == ERR_INVALID_PARAMETER)
	var supplied_id := "11111111-1111-4111-8111-111111111111"
	assert(second.start_session(output_root, PROJECT, {"collision_debug": true}, supplied_id) == OK)
	assert(second.abort_session() == OK)
	print("POSTPLAY_COLLECTOR_RESULT " + JSON.stringify({"directory": directory, "supplied": second.session_directory}))
	quit(0)

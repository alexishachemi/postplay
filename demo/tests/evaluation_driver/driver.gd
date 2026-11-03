@tool
extends EditorPlugin
## Ground truth stays in a separate evaluation index, outside portable sessions.

const Files = preload("res://addons/postplay/session_files.gd")


func _enter_tree() -> void:
	call_deferred("run_evaluation")


func wait_until(predicate: Callable, seconds: float = 120.0) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000)
	while not predicate.call():
		if Time.get_ticks_msec() > deadline:
			return false
		await get_tree().process_frame
	return true


func run_evaluation() -> void:
	await get_tree().process_frame
	var editor = Engine.get_singleton("EditorInterface")
	assert(await wait_until(func(): return not editor.get_resource_filesystem().is_scanning()))
	var plugin = get_tree().root.find_child("PostPlayEditor", true, false)
	assert(plugin != null)
	var output: String = OS.get_cmdline_user_args()[0]
	ProjectSettings.set_setting("application/run/main_scene", "res://playtest.tscn")
	ProjectSettings.set_setting("postplay/output_directory", output.path_join("sessions"))
	assert(ProjectSettings.save() == OK)
	var previous: bool = editor.is_movie_maker_enabled()
	var runs: Array = []
	var pairs := [["progress", false], ["ui", true], ["boundary", false], ["progress", true], ["ui", false], ["boundary", true]]
	for pair in pairs:
		OS.set_environment("POSTPLAY_DEMO_CASE", pair[0])
		OS.set_environment("POSTPLAY_DEMO_FAULT", "1" if pair[1] else "0")
		assert(plugin.start_recording() == OK)
		var directory: String = plugin._directory
		assert(await wait_until(func(): return plugin._directory.is_empty() and plugin._worker == null))
		assert(Files.read_json(directory.path_join("session.json")).status == "complete")
		assert(editor.is_movie_maker_enabled() == previous)
		runs.append({"scenario": pair[0], "fault_enabled": pair[1], "session_id": directory.get_file()})
		assert(Files.write_json(output.path_join("evaluation.json"), {"version": "1", "method": "Fixed scripted inputs; actual Movie Maker gameplay, not human play or autonomous exploration", "runs": runs}) == OK)
		print("POSTPLAY_EVALUATION_CAPTURE " + directory)
	print("POSTPLAY_EVALUATION_COMPLETE " + output)
	get_tree().quit()

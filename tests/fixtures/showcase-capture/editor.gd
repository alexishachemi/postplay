@tool
extends EditorPlugin
## Actual editor/addon orchestration. No model calls or game-mode selection.


func _enter_tree() -> void:
	call_deferred("_verify")


func _wait_until(predicate: Callable, seconds: float = 90.0) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000)
	while not predicate.call():
		if Time.get_ticks_msec() > deadline:
			return false
		await get_tree().process_frame
	return true


func _verify() -> void:
	await get_tree().process_frame
	var editor = Engine.get_singleton("EditorInterface")
	assert(await _wait_until(func(): return not editor.get_resource_filesystem().is_scanning()))
	var addon = get_tree().root.find_child("PostPlayEditor", true, false)
	assert(addon != null)
	var output: String = OS.get_cmdline_user_args()[0]
	ProjectSettings.set_setting("postplay/output_directory", output)
	ProjectSettings.set_setting("editor/run/main_run_args", "--disable-vsync")
	assert(ProjectSettings.save() == OK)
	var previous: bool = editor.is_movie_maker_enabled()
	assert(addon.start_recording() == OK)
	var directory: String = addon._directory
	if not await _wait_until(func(): return addon._directory.is_empty() and addon._worker == null):
		addon.stop_recording()
		await _wait_until(func(): return addon._directory.is_empty() and addon._worker == null, 15.0)
		push_error("Showcase recording deadline exceeded; partial capture retained")
		get_tree().quit(1)
		return
	assert(editor.is_movie_maker_enabled() == previous)
	print("POSTPLAY_SHOWCASE_RESULT " + directory)
	get_tree().quit()

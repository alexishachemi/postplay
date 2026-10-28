extends SceneTree
## Run with --headless --editor to probe the pinned editor's capture API.


func _initialize() -> void:
	call_deferred("run_probe")


func run_probe() -> void:
	# Let editor initialization and its resource scan finish before quitting.
	await process_frame
	await process_frame
	var editor = Engine.get_singleton("EditorInterface")
	if editor == null:
		push_error("EditorInterface singleton unavailable")
		quit(1)
		return
	while editor.get_resource_filesystem().is_scanning():
		await process_frame
	for method in ["is_movie_maker_enabled", "set_movie_maker_enabled", "play_main_scene", "stop_playing_scene", "is_playing_scene"]:
		if not editor.has_method(method):
			push_error("Missing editor method: " + method)
			quit(1)
			return
	var original: bool = editor.is_movie_maker_enabled()
	editor.set_movie_maker_enabled(not original)
	var changed: bool = editor.is_movie_maker_enabled() == not original
	editor.set_movie_maker_enabled(original)
	if not changed or editor.is_movie_maker_enabled() != original:
		push_error("Movie Maker toggle/restoration failed")
		quit(1)
		return
	print("PASS: Movie Maker toggle/restoration; launch/stop methods available")
	print("Movie output setting exists: ", ProjectSettings.has_setting("editor/movie_writer/movie_file"))
	quit()

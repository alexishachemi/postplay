@tool
extends EditorPlugin
## Enable the copied addon, then capture independent basic/annotated scenes.

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
	assert(await _wait_until(func(): return not editor.get_resource_filesystem().is_scanning()))
	assert(not ProjectSettings.has_setting("autoload/PostPlay"))
	assert(get_tree().root.find_child("PostPlayEditor", true, false) == null)
	editor.set_plugin_enabled("postplay", true)
	await get_tree().process_frame
	var plugin = get_tree().root.find_child("PostPlayEditor", true, false)
	assert(plugin != null and plugin._autoload_ok)
	assert(ProjectSettings.has_setting("autoload/PostPlay"))
	var output := OS.get_cmdline_user_args()[0]
	ProjectSettings.set_setting("postplay/output_directory", output)
	ProjectSettings.set_setting("editor/movie_writer/fps", 47)
	ProjectSettings.set_setting("editor/movie_writer/movie_file", "res://owner-movie.avi")
	var directories: Array[String] = []
	for scene in ["basic", "observed"]:
		ProjectSettings.set_setting("application/run/main_scene", "res://%s.tscn" % scene)
		assert(ProjectSettings.save() == OK)
		var previous: bool = scene == "observed"
		editor.set_movie_maker_enabled(previous)
		assert(plugin.start_recording() == OK)
		var directory: String = plugin._directory
		directories.append(directory)
		assert(await _wait_until(func(): return plugin._directory.is_empty() and plugin._worker == null))
		var manifest := Files.read_json(directory.path_join("session.json"))
		assert(manifest.status == "complete", JSON.stringify(manifest))
		assert(editor.is_movie_maker_enabled() == previous)
		assert(ProjectSettings.get_setting("editor/movie_writer/fps") == 47)
		assert(ProjectSettings.get_setting("editor/movie_writer/movie_file") == "res://owner-movie.avi")
	assert(directories[0] != directories[1])
	# An ordinary annotated run must remain safe/inactive and create no package.
	editor.set_movie_maker_enabled(false)
	editor.play_main_scene()
	assert(await _wait_until(func(): return editor.is_playing_scene()))
	assert(await _wait_until(func(): return not editor.is_playing_scene()))
	assert(DirAccess.get_directories_at(output).size() == 2)
	editor.set_plugin_enabled("postplay", false)
	assert(not ProjectSettings.has_setting("autoload/PostPlay"))
	assert(get_tree().root.find_child("PostPlayEditor", true, false) == null)
	print("POSTPLAY_FRESH_PROJECT_RESULT " + JSON.stringify({"directories": directories, "normal_run": true, "settings_restored": true, "disabled": true}))
	get_tree().quit(0)

extends SceneTree
## Synthetic observations of the real smoke scene. Not a recording/evaluation.

const Collector = preload("res://addons/postplay/collector.gd")


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var mode := args[1]
	var scene = preload("res://main.tscn").instantiate()
	root.add_child(scene)
	current_scene = scene
	scene.set_process(false)
	debug_collisions_hint = true
	var capture := Collector.new()
	root.add_child(capture)
	assert(capture.set_input_actions([]) == ERR_UNCONFIGURED)
	assert(capture.start_session(args[0], {"id": "fixture", "name": "Observation fixture", "scene": "main.tscn"}) == OK)
	capture.set_process(false)
	if mode == "demo":
		var player: String = capture.set_player(scene, 100, "player_position", "scene_local")
		assert(not player.is_empty())
		assert(capture.set_player(scene, 500, "player_position", "scene_local") == player)
		assert(not capture.set_playable_bounds(scene.PLAY_AREA, "Declared playable rectangle", "scene_local").is_empty())
		var progress: String = capture.watch_progression(scene.beacon_activated, "Beacon activation count")
		assert(not progress.is_empty())
		assert(capture.watch_progression(scene.beacon_activated, "Duplicate") == progress)
		Input.action_press("ui_right")
		scene._process(0.1)
		capture._process(0.025)
		capture._process(0.025)
		capture._process(0.05)
		Input.action_release("ui_right")
		Input.action_press("ui_accept")
		var event := InputEventAction.new()
		event.action = "ui_accept"
		event.pressed = true
		scene._unhandled_input(event)
		assert(scene.activation_count == 1)
		capture._process(0.1)
		Input.action_release("ui_accept")
		capture._process(0.1)
		assert(capture.unwatch(player))
		assert(capture.unwatch(progress))
		assert(scene.beacon_activated.get_connections().is_empty())
		capture._process(1.0)
	elif mode == "no_annotations":
		Input.action_press("ui_right")
		scene._process(0.1)
		capture._process(0.1)
		Input.action_release("ui_right")
		capture._process(0.1)
	elif mode == "privacy":
		for editor in [LineEdit.new(), TextEdit.new()]:
			scene.add_child(editor)
			editor.text = "sensitive_fixture_text"
			editor.grab_focus()
			assert(root.gui_get_focus_owner() == editor)
			Input.action_press("ui_right")
			Input.action_press("ui_accept")
			capture._process(1.0)
			var key := InputEventKey.new()
			key.keycode = KEY_J
			key.unicode = 106
			key.pressed = true
			Input.parse_input_event(key)
			capture._process(0.1)
			key = key.duplicate()
			key.pressed = false
			Input.parse_input_event(key)
			Input.action_release("ui_right")
			Input.action_release("ui_accept")
			editor.release_focus()
			capture._process(0.1)
			editor.free()
	elif mode == "custom":
		InputMap.add_action("fixture_jump")
		assert(capture.set_input_actions(["fixture_jump"], 100) == OK)
		Input.action_press("ui_right") # Unselected action must not appear.
		for index in range(100):
			Input.action_press("fixture_jump") if index % 2 == 0 else Input.action_release("fixture_jump")
			capture._process(0.001)
		Input.action_press("fixture_jump")
		capture._process(1.0) # One batch, not ten catch-up samples.
		Input.action_release("fixture_jump")
		capture._process(0.1)
		assert(capture.set_input_actions([]) == OK)
		Input.action_press("fixture_jump")
		capture._process(1.0)
		Input.action_release("fixture_jump")
		Input.action_release("ui_right")
		InputMap.erase_action("fixture_jump")
	elif mode == "spatial":
		var player := Node3D.new()
		scene.add_child(player)
		var id: String = capture.set_player(player, 50)
		assert(not id.is_empty())
		assert(not capture.set_playable_bounds(AABB(Vector3(-1, -2, -3), Vector3(4, 5, 6))).is_empty())
		player.position = Vector3(1, 2, 3)
		capture._process(0.05)
		capture._process(5.0) # Stationary position still sampled, without catch-up burst.
		scene.remove_child(player) # A detached Node3D has no valid world transform.
		capture._process(0.1)
		assert(not capture.unwatch(id))
		player.free()
	elif mode == "invalid":
		for selected in [["missing_action"], ["ui_right", "ui_right"], [42], ["ui_right\n"]]:
			assert(capture.set_input_actions(selected) == ERR_INVALID_PARAMETER)
		assert(capture.set_input_actions(["ui_right"], 49) == ERR_INVALID_PARAMETER)
		assert(capture.set_input_actions(["ui_right"], 60001) == ERR_INVALID_PARAMETER)
		assert(capture.set_input_actions(range(33)) == ERR_INVALID_PARAMETER)
		assert(capture.set_player(scene, 49).is_empty())
		assert(capture.set_player(scene, 100, "activation_count").is_empty())
		assert(capture.set_player(scene, 100, "missing").is_empty())
		assert(capture.set_player(scene, 100, "global_position", "ambiguous").is_empty())
		var detached := Node3D.new()
		assert(capture.set_player(detached).is_empty())
		detached.free()
		assert(capture.set_player(detached).is_empty())
		assert(capture.set_playable_bounds(Rect2(0, 0, -1, 5)).is_empty())
		assert(capture.set_playable_bounds(Rect2(NAN, 0, 1, 5)).is_empty())
		assert(capture.set_playable_bounds(Rect2(1e20, 0, 1, 5)).is_empty())
		assert(capture.set_playable_bounds(AABB(Vector3.ZERO, Vector3.ZERO)).is_empty())
		assert(capture.set_playable_bounds("not geometry").is_empty())
	elif mode == "io":
		assert(DirAccess.make_dir_absolute(capture.session_directory.path_join("session.json.pending")) == OK)
		assert(capture.set_player(scene).is_empty())
		assert(capture.set_playable_bounds(scene.PLAY_AREA).is_empty())
		assert(capture.watch_progression(scene.beacon_activated, "Progress").is_empty())
		assert(scene.beacon_activated.get_connections().is_empty())
		assert(capture.seal_for_finalization() != OK)
	elif mode == "limit":
		assert(not capture.set_player(scene).is_empty())
		assert(not capture.watch_progression(scene.beacon_activated, "Progress").is_empty())
		for index in range(capture.MAX_EVENTS - 2):
			assert(capture.append_event("annotation", "bounded_fixture") == OK)
		Input.action_press("ui_right")
		capture._process(0.1)
		assert(scene.beacon_activated.get_connections().is_empty())
		Input.action_release("ui_right")
		capture._process(1.0)
		assert(capture.seal_for_finalization() == ERR_OUT_OF_MEMORY)
	else:
		assert(false, "Unknown fixture mode")
	if mode not in ["io", "limit"]:
		assert(capture.seal_for_finalization() == OK)
	assert(capture.set_input_actions([]) == ERR_UNCONFIGURED)
	assert(capture.set_player(scene).is_empty())
	print("POSTPLAY_OBSERVATION_RESULT " + capture.session_directory)
	capture.free()
	scene.free()
	quit(0)

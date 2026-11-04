extends Node
## Deterministic gameplay regression fixture, not model-evaluation evidence.

var failures: Array[String] = []

func _ready() -> void:
	_run.call_deferred()

func _expect(condition: bool, description: String) -> void:
	if not condition:
		failures.append(description)
		push_error(description)

func _new_game(mode: String, fault: bool) -> Node2D:
	OS.set_environment("POSTPLAY_DEMO_CASE", mode)
	OS.set_environment("POSTPLAY_DEMO_FAULT", "1" if fault else "0")
	var game: Node2D = load("res://main.tscn").instantiate()
	add_child(game)
	return game

func _tick(count: int = 1) -> void:
	for index in range(count):
		await get_tree().physics_frame
		await get_tree().process_frame

func _dispose(game: Node) -> void:
	Input.action_release("ui_right")
	Input.action_release("ui_accept")
	game.queue_free()
	await _tick(2)

func _run() -> void:
	var game := _new_game("hud", false)
	await _tick(4)
	# Validate the actual replacement atlas regions, not only resource paths.
	var tiles: Texture2D = game._tiles
	_expect(tiles.get_size() == Vector2(160, 160), "Replacement platform sheet has expected dimensions")
	var atlas: SpriteFrames = game.player.sprite.sprite_frames
	for animation in ["idle", "run"]:
		var count := 4 if animation == "run" else 3
		_expect(atlas.get_frame_count(animation) == count, "Replacement animation uses only nonempty frames: %s" % animation)
		for index in range(count):
			var texture: AtlasTexture = atlas.get_frame_texture(animation, index)
			_expect(texture.atlas.get_size() == Vector2(128, 256), "Replacement character sheet dimensions")
			_expect(Rect2(Vector2.ZERO, texture.atlas.get_size()).encloses(texture.region), "Animation region stays within character sheet")
			var image := texture.atlas.get_image().get_region(Rect2i(texture.region))
			_expect(image.get_used_rect().has_area(), "Animation frame contains visible artwork")
			_expect(texture.region.position.y == (32 if animation == "run" else 0), "Idle and run use their distinct intended atlas rows")
	_expect(game.player.is_on_floor(), "Pilot starts on the deck")
	_expect(game.cells == 0 and game.displayed_cells == 0, "Run starts empty")
	game.collect_cell(0)
	game.collect_cell(0)
	_expect(game.cells == 1 and game.displayed_cells == 1, "Clean pickup updates visible HUD; duplicate pickup ignored")
	game.collect_cell(1)
	game.collect_cell(2)
	_expect(game.airlock_ready, "Three power cells open the airlock")
	game.player.position = Vector2(1180, 620)
	await _tick(3)
	_expect(game.completed, "Powered exit completes the run")
	game.restart()
	_expect(not game.completed and game.cells == 0 and game.player.enabled, "Restart clears completion and restores control")
	game.trigger_timing_pulse()
	_expect(game.pulse_sequence == 1 and game._stripe.visible, "Timing pulse is visible and increments sequence")
	await _tick(30)
	_expect(not game._stripe.visible, "Timing pulse expires")
	await _dispose(game)

	game = _new_game("hud", true)
	game.collect_cell(0)
	_expect(game.cells == 1 and game.displayed_cells == 0, "Opt-in HUD regression is independently observable")
	game.restart()
	_expect(game.cells == 0 and game.displayed_cells == 0, "Fault-mode restart restores initial state")
	await _dispose(game)

	for fault in [false, true]:
		game = _new_game("boundary", fault)
		await _tick(4)
		game.player.position = Vector2(1200, 620)
		Input.action_press("ui_right")
		await _tick(14)
		_expect(game.player.position.x > 1244 if fault else game.player.position.x < 1244, "Boundary control / opt-in excursion: %s" % fault)
		Input.action_release("ui_right")
		game.restart()
		_expect(game.player.position == game.SPAWN, "Boundary excursion is recoverable using restart")
		await _dispose(game)

	# Traverse the whole route using engine physics, rather than moving to pickups.
	game = _new_game("", false)
	await _tick(4)
	Input.action_press("ui_right")
	for step in range(600):
		Input.action_release("ui_accept")
		var at: Vector2 = game.player.position
		if game.player.is_on_floor() and ((at.y > 600 and at.x > 210 and at.x < 260) or (at.y > 510 and at.y < 530 and at.x > 420) or (at.y > 415 and at.y < 435 and at.x > 700)):
			Input.action_press("ui_accept")
		await _tick()
		if game.completed:
			break
	_expect(game.cells == 3 and game.completed, "Clean level is physically traversable and completable with jump / run inputs")
	await _dispose(game)
	# Remove the optional observer entirely, then prove ordinary gameplay survives.
	var recorder := get_node_or_null("/root/PostPlay")
	if recorder != null:
		recorder.get_parent().remove_child(recorder)
	game = _new_game("", false)
	game.collect_cell(0)
	game.trigger_timing_pulse()
	_expect(game.cells == 1 and game._stripe.visible, "Game works with no PostPlay autoload")
	await _dispose(game)
	if recorder != null:
		get_tree().root.add_child(recorder)
	OS.unset_environment("POSTPLAY_DEMO_CASE")
	OS.unset_environment("POSTPLAY_DEMO_FAULT")
	if failures.is_empty():
		print("Starfall Relay: gameplay, physical completion, HUD pairs, containment pairs, restart, timing and missing-addon checks passed")
	get_tree().quit(0 if failures.is_empty() else 1)

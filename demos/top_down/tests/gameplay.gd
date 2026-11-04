extends Node

var checks := 0


func require(condition: bool, description: String) -> void:
	checks += 1
	if not condition:
		push_error(description)
		get_tree().quit(1)
		assert(condition, description)


func _ready() -> void:
	call_deferred("run_tests")


func run_tests() -> void:
	var original_case := OS.get_environment("POSTPLAY_DEMO_CASE")
	var original_fault := OS.get_environment("POSTPLAY_DEMO_FAULT")
	for scenario: String in ["hud", "progress"]:
		for faulty: bool in [false, true]:
			OS.set_environment("POSTPLAY_DEMO_CASE", scenario)
			OS.set_environment("POSTPLAY_DEMO_FAULT", "1" if faulty else "0")
			var game = load("res://main.tscn").instantiate()
			add_child(game)
			game.set_physics_process(false)
			require(game.inventory == 0 and game.gate_state == "closed", "Fresh quest")
			var before: Vector2 = game.player_position
			Input.action_press("move_right")
			game._physics_process(1.0 / 60)
			Input.action_release("move_right")
			require(game.player_position.x > before.x, "Configured input action actually moves player")
			game.move_player(Vector2(900, 0))
			require(game.player_position.x == 680, "Closed gate blocks passage")
			for point: Vector2 in game.SUPPLY_POINTS:
				game.player_position = point
				game.interact()
			game.interact()
			require(game.inventory == 3, "Three bundles; no duplicate collection")
			require(game.displayed_inventory == (0 if faulty and scenario == "hud" else 3), "HUD tracks state except deliberate stale display")
			game.player_position = Vector2(665, 330)
			game.interact()
			require(game.inventory == 0 and game.gate_state == "repairing", "Repair consumes exactly three bundles")
			game.advance_game(2)
			require(game.gate_state == "repairing", "Repair is not instantaneous")
			game.cancel_repair()
			if faulty and scenario == "progress":
				require(game.gate_state == "repairing" and game.inventory == 0, "Cancellation fails in controlled progression case")
				for attempt in range(4):
					game.advance_game(3)
					game.interact()
					game.cancel_repair()
				require(game.gate_state == "repairing" and not game.quest_complete, "Repeated reasonable attempts do not progress")
			else:
				require(game.gate_state == "closed" and game.inventory == 3, "Cancellation refunds timber")
				game.interact()
				game.advance_game(4)
				require(game.gate_state == "open", "Repair completes after four seconds")
				game.move_player(Vector2(153, 0))
				require(game.quest_complete, "Clean quest can finish")
			var pulse_count := [0]
			game.timing_pulse.connect(func(sequence: int): pulse_count[0] = sequence)
			game.trigger_timing_pulse()
			require(pulse_count[0] == 1 and game._pulse_remaining > 0, "Timing signal and visible pulse")
			game.advance_game(0.5)
			require(game._pulse_remaining == 0, "Timing pulse expires in simulation time")
			game.reset_game()
			require(game.inventory == 0 and game.gate_state == "closed" and not game.quest_complete, "Restart recovers even deliberate progression failure")
			require(game.collected == [false, false, false], "Restart restores supplies")
			game.free()
	# Gameplay must also initialize and finish if no observer autoload is present.
	OS.set_environment("POSTPLAY_DEMO_FAULT", "0")
	var observer := get_node_or_null("/root/PostPlay")
	if observer != null:
		get_tree().root.remove_child(observer)
	var unobserved = load("res://main.tscn").instantiate()
	add_child(unobserved)
	unobserved.set_physics_process(false)
	for point: Vector2 in unobserved.SUPPLY_POINTS:
		walk_to(unobserved, point)
		unobserved.interact()
	walk_to(unobserved, Vector2(665, 330))
	unobserved.interact()
	unobserved.advance_game(4)
	walk_to(unobserved, Vector2(818, 330))
	require(unobserved.quest_complete, "Continuous clean route completes without addon autoload")
	unobserved.free()
	if observer != null:
		get_tree().root.add_child(observer)
	OS.set_environment("POSTPLAY_DEMO_CASE", original_case)
	OS.set_environment("POSTPLAY_DEMO_FAULT", original_fault)
	print("Harbor Warden: %d gameplay checks passed (inactive optional addon)." % checks)
	get_tree().quit(0)


func walk_to(game: Node, target: Vector2) -> void:
	for step in range(600):
		var difference: Vector2 = target - game.player_position
		if difference.length() < 1:
			return
		game.move_player(difference.limit_length(game.SPEED / 60))
		game.advance_game(1.0 / 60)
	require(false, "Continuous route reaches its target")

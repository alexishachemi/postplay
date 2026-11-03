extends SceneTree
## Deterministic gameplay checks; no recording, model or fabricated findings.


func _initialize() -> void:
	call_deferred("run_test")


func run_test() -> void:
	for fault in ["", "ui", "boundary", "progress"]:
		OS.set_environment("POSTPLAY_DEMO_CASE", fault)
		OS.set_environment("POSTPLAY_DEMO_FAULT", "0" if fault.is_empty() else "1")
		var game = load("res://playtest.tscn").instantiate()
		root.add_child(game)
		game.set_process(false)
		game.player_position = Vector2(260, 330)
		game.interact()
		assert(game.energy == 80)
		assert(game.displayed_energy == (100 if fault == "ui" else 80))
		game.player_position = Vector2(880, 240)
		game.move_player(Vector2.RIGHT, 1.0)
		assert(game.player_position.x == (940.0 if fault == "boundary" else 884.0))
		game.player_position = Vector2(650, 330)
		game.interact()
		game._process(1.2)
		assert(game.transferring == (fault == "progress"))
		assert(game.gate_open == (fault != "progress"))
		game.reset_transfer()
		assert(game.transferring == (fault == "progress"))
		game.free()
	OS.set_environment("POSTPLAY_DEMO_FAULT", "0")
	print("PASS: energy/HUD, collision segment, transfer/reset and clean counterparts")
	quit()

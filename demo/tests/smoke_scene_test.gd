extends SceneTree
## Deterministic behavior fixture, not a recording or evaluation session.


func _initialize() -> void:
	call_deferred("run_test")


func run_test() -> void:
	var scene = preload("res://main.tscn").instantiate()
	root.add_child(scene)
	scene.set_process(false)
	var event := InputEventAction.new()
	event.action = "ui_accept"
	event.pressed = true
	scene._unhandled_input(event)
	assert(scene.activation_count == 1, "An interaction must activate the beacon once")
	assert(scene.flash_seconds > 0.0, "The interaction must create a visible flash")
	assert(scene.get_node("InteractionCount").text == "Beacon activations: 1")
	scene._process(0.6)
	assert(scene.flash_seconds == 0.0, "The flash must finish")
	Input.action_press("ui_right")
	var previous_position: Vector2 = scene.player_position
	scene._process(0.1)
	assert(scene.player_position.x > previous_position.x, "Movement must respond to input")
	scene._process(10.0)
	assert(scene.player_position.x <= scene.PLAY_AREA.end.x - scene.PLAYER_RADIUS)
	Input.action_release("ui_right")
	scene.queue_free()
	print("PASS: interaction, visible counter/flash, movement and boundary")
	quit()

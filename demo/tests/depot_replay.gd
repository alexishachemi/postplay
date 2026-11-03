extends Node
## Fixed evaluation input schedule. No exploration, AI agent or answer synthesis.
## Used only by the explicitly invoked disposable recording runner.

var frame := 0
var game: Node
var released := ""


func _ready() -> void:
	process_priority = 100
	call_deferred("configure")


func configure() -> void:
	game = get_tree().root.get_node("RelayDepot")


func tap(action: String) -> void:
	var event := InputEventAction.new()
	event.action = action
	event.pressed = true
	Input.parse_input_event(event)
	released = action


func _process(_delta: float) -> void:
	if game == null:
		return
	if not released.is_empty():
		var event := InputEventAction.new()
		event.action = released
		event.pressed = false
		Input.parse_input_event(event)
		released = ""
	frame += 1
	if frame in [30, 450, 870]:
		tap("ui_focus_next")
	var scenario := OS.get_environment("POSTPLAY_DEMO_CASE")
	if scenario == "ui":
		if frame == 45: Input.action_press("ui_right")
		if frame == 59: Input.action_release("ui_right")
		if frame in [90, 180, 270]: tap("ui_accept")
	elif scenario == "boundary":
		if frame == 60: Input.action_press("ui_up")
		if frame == 72: Input.action_release("ui_up")
		if frame == 90: Input.action_press("ui_right")
		if frame == 300: Input.action_release("ui_right")
		if frame == 600: Input.action_press("ui_left")
		if frame == 660: Input.action_release("ui_left")
	elif scenario == "progress":
		if frame == 60: Input.action_press("ui_right")
		if frame == 126: Input.action_release("ui_right")
		if frame in [180, 300, 420, 780]: tap("ui_accept")
		if frame in [360, 660]: tap("depot_reset")
		if frame == 480: Input.action_press("ui_right")
		if frame == 540: Input.action_release("ui_right")
		if frame == 600: Input.action_press("ui_left")
		if frame == 609: Input.action_release("ui_left")
	if frame == 900:
		get_tree().quit()

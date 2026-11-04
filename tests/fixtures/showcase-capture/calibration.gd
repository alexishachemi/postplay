extends Node
## Six-second fixed calibration, not autonomous exploration or model evaluation.

var _frame := 0


func _process(_delta: float) -> void:
	var game = get_tree().current_scene
	if game == null:
		return
	_frame += 1
	if _frame in [30, 90, 150]:
		assert(game.has_method("trigger_timing_pulse"))
		game.trigger_timing_pulse()
	if _frame == 50:
		Input.action_press("move_right" if InputMap.has_action("move_right") else "ui_right")
	if _frame == 70:
		Input.action_release("move_right" if InputMap.has_action("move_right") else "ui_right")
	if _frame == 180:
		get_tree().quit()

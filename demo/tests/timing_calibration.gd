extends Node
## Deterministic visible-event calibration ONLY. Enabled only in a disposable test copy.
## This is not a gameplay agent, evaluation session or human playtest.

var _frame := 0
var _demo: Node


func _ready() -> void:
	call_deferred("_configure")


func _configure() -> void:
	_demo = get_tree().root.get_node("PostPlayDemo")
	var capture = get_tree().root.get_node("PostPlay")
	assert(capture._recording_run)
	assert(not capture.watch_signal(_demo.beacon_activated, "Visible calibration beacon").is_empty())


func _process(_delta: float) -> void:
	if _demo == null:
		return
	_frame += 1
	if _frame in [30, 90, 150]:
		_demo.activate_beacon()
	if _frame == 180:
		get_tree().quit()

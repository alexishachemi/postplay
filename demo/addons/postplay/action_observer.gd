extends RefCounted
## Selected action states only. Never inspects InputEventKey or text contents.

const DEFAULT_ACTIONS := [&"ui_left", &"ui_right", &"ui_up", &"ui_down", &"ui_accept", &"ui_cancel"]
var _owner: WeakRef
var _actions: Array[StringName] = []
var _states: Dictionary = {}
var _interval_ms := 50
var _elapsed_ms := 0.0
var _suppressed := false


func _init(collector: Node) -> void:
	_owner = weakref(collector)


func start() -> Dictionary:
	_actions.clear()
	for action in DEFAULT_ACTIONS:
		if InputMap.has_action(action):
			_actions.append(action)
	return policy()


func policy() -> Dictionary:
	return {"actions": _actions.duplicate(), "interval_ms": _interval_ms,
		"observation": "Sampled action states, not guaranteed edges or game handling; text-focus intervals and short transitions may be omitted."}


func configure(actions: Array, interval_ms: int) -> Error:
	if actions.size() > 32 or interval_ms < 50 or interval_ms > 60000:
		return ERR_INVALID_PARAMETER
	var selected: Array[StringName] = []
	for action in actions:
		if not (action is String or action is StringName):
			return ERR_INVALID_PARAMETER
		if not _owner.get_ref()._matches("^[A-Za-z_][A-Za-z0-9_/-]{0,127}$", String(action)) or not InputMap.has_action(action) or StringName(action) in selected:
			return ERR_INVALID_PARAMETER
		selected.append(StringName(action))
	var configuration := policy()
	configuration.actions = selected.duplicate()
	configuration.interval_ms = interval_ms
	var error: Error = _owner.get_ref().append_event("input", "input_configuration", configuration)
	if error != OK:
		return error
	_actions = selected
	_interval_ms = interval_ms
	_states.clear()
	_elapsed_ms = 0.0
	_suppressed = false
	return OK


func stop() -> void:
	_actions.clear()
	_states.clear()


func sample(delta: float) -> void:
	if _actions.is_empty():
		return
	_elapsed_ms += delta * 1000.0
	var focus: Control = _owner.get_ref().get_viewport().gui_get_focus_owner()
	if focus is LineEdit or focus is TextEdit:
		_states.clear()
		_suppressed = true
		return
	if _elapsed_ms < _interval_ms:
		return
	_elapsed_ms = 0.0
	if _suppressed:
		_suppressed = false
		if _owner.get_ref().append_event("input", "input_coverage", {"state": "resumed_after_text_focus"}) != OK:
			return
	# Snapshot tolerates log-cap handling clearing the selected actions mid-batch.
	for action in _actions.duplicate():
		if not InputMap.has_action(action):
			continue
		var pressed := Input.is_action_pressed(action)
		if pressed != _states.get(action, false):
			if _owner.get_ref().append_event("input", "action_state", {"action": String(action), "pressed": pressed}) != OK:
				return
		_states[action] = pressed

extends RefCounted
## Collector-owned, explicit observations only. Targets are held weakly.

const SafeValue = preload("res://addons/postplay/safe_value.gd")
var _owner: WeakRef
var _watches: Dictionary = {}
var _sources: Array[Dictionary] = []


func _init(collector: Node) -> void:
	_owner = weakref(collector)


func watch_signal(observed: Signal, description: String, expected: String, kind: String = "signal") -> String:
	var target := observed.get_object()
	if not is_instance_valid(target) or not _valid_context(description, expected):
		return ""
	var member := String(observed.get_name())
	if member.is_empty() or member.length() > 256 or not target.has_signal(member):
		return ""
	var duplicate := _duplicate(target, kind, member)
	if not duplicate.is_empty():
		return duplicate
	var arity := -1
	for info in target.get_signal_list():
		if info.name == observed.get_name():
			arity = info.args.size()
			break
	if arity < 0 or arity > 8:
		return ""
	var registration: Dictionary = _owner.get_ref()._add_registration(kind, _source(target), description, expected)
	if registration.is_empty():
		return ""
	var id: String = registration.id
	# Defaults support the signal's declared arity without padding saved arguments.
	var callback := func(a = null, b = null, c = null, d = null, e = null, f = null, g = null, h = null):
		_record_signal(id, [a, b, c, d, e, f, g, h].slice(0, arity))
	if observed.connect(callback) != OK:
		return ""
	_watches[id] = {"target": weakref(target), "kind": kind, "member": member,
		"callback": callback, "registration": registration}
	return id


func watch_property(target: Object, member: String, description: String, interval_ms: int, expected: String, kind: String = "property", coordinate_space: String = "") -> String:
	if not is_instance_valid(target) or not _valid_context(description, expected) or interval_ms < 50 or interval_ms > 60000:
		return ""
	if member.length() > 256 or member.split(":").size() > 6:
		return ""
	for part in member.split(":"):
		if not _owner.get_ref()._matches("^[A-Za-z_][A-Za-z0-9_]{0,127}$", part):
			return ""
	var duplicate := _duplicate(target, kind, member)
	if not duplicate.is_empty():
		return duplicate
	var reading := _read(target, member)
	if not reading.valid:
		return ""
	if kind == "player" and not (reading.value is Vector2 or reading.value is Vector3):
		return ""
	var registration: Dictionary = _owner.get_ref()._add_registration(kind, _source(target), description, expected)
	if registration.is_empty():
		return ""
	var id: String = registration.id
	_watches[id] = {"target": weakref(target), "kind": kind, "member": member,
		"interval_ms": interval_ms, "elapsed_ms": 0.0, "registration": registration,
		"last": _fingerprint(reading.value), "coordinate_space": coordinate_space}
	if _emit_property(_watches[id], reading.value, "initial") != OK:
		unwatch(id)
		return ""
	return id


func unwatch(id: String) -> bool:
	if not _watches.has(id):
		return false
	var watch: Dictionary = _watches[id]
	var target: Object = watch.target.get_ref()
	if watch.kind in ["signal", "progression"] and is_instance_valid(target) and target.is_connected(watch.member, watch.callback):
		target.disconnect(watch.member, watch.callback)
	_watches.erase(id)
	return true


func stop() -> void:
	for id in _watches.keys():
		unwatch(id)


func sample(delta: float) -> void:
	# Snapshot permits callbacks/limit handling to remove watches during an append.
	for id in _watches.keys():
		if not _watches.has(id):
			continue
		var watch: Dictionary = _watches[id]
		var target: Object = watch.target.get_ref()
		if not is_instance_valid(target):
			unwatch(id)
			continue
		if watch.kind == "player" and not target.is_inside_tree():
			unwatch(id)
			continue
		if watch.kind not in ["property", "player"]:
			continue
		watch.elapsed_ms += delta * 1000.0
		if watch.elapsed_ms < watch.interval_ms:
			continue
		# No catch-up burst after a long frame.
		watch.elapsed_ms = 0.0
		var reading := _read(target, watch.member)
		if not reading.valid or (watch.kind == "player" and not (reading.value is Vector2 or reading.value is Vector3)):
			unwatch(id)
			continue
		var fingerprint := _fingerprint(reading.value)
		if watch.kind == "player" or fingerprint != watch.last:
			watch.last = fingerprint
			if _emit_property(watch, reading.value, "sample" if watch.kind == "player" else "change") != OK:
				unwatch(id)


func _emit_property(watch: Dictionary, value: Variant, phase: String) -> Error:
	if watch.kind == "player":
		return _owner.get_ref()._append_event("position", watch.member, {"property": watch.member, "phase": phase, "position": value, "coordinate_space": watch.coordinate_space}, watch.registration)
	return _owner.get_ref()._append_event("property", watch.member, {"property": watch.member, "phase": phase, "value": value}, watch.registration)


func _record_signal(id: String, arguments: Array) -> void:
	if _watches.has(id):
		var watch: Dictionary = _watches[id]
		if _owner.get_ref()._append_event(watch.kind, watch.member, {"signal": watch.member, "arguments": arguments}, watch.registration) != OK:
			unwatch(id)


func _duplicate(target: Object, kind: String, member: String) -> String:
	for id in _watches:
		var watch: Dictionary = _watches[id]
		if watch.target.get_ref() == target and watch.kind == kind and watch.member == member:
			return id
	return ""


func _source(target: Object) -> Dictionary:
	for item in _sources:
		if item.target.get_ref() == target:
			return item.source
	if _sources.size() >= 128:
		return {}
	var path: Variant = null
	var label := "Observed object"
	if target is Node:
		label = String(target.name).left(256)
		var scene: Node = _owner.get_ref().get_tree().current_scene
		if is_instance_valid(scene) and (target == scene or scene.is_ancestor_of(target)):
			var relative := String(scene.get_path_to(target))
			if relative == "." or _owner.get_ref()._portable_path(relative):
				path = relative
	var source := {"id": "src-%d" % (_sources.size() + 2), "label": label if not label.is_empty() else "Observed object", "node_path": path}
	_sources.append({"target": weakref(target), "source": source})
	return source


static func _valid_context(description: String, expected: String) -> bool:
	return description.length() <= 1024 and expected.length() <= 1024


static func _fingerprint(value: Variant) -> String:
	return JSON.stringify(SafeValue.encode_payload(value), "", true, true)


static func _read(target: Object, member: String) -> Dictionary:
	var value: Variant = target
	for part in member.split(":"):
		if typeof(value) == TYPE_OBJECT:
			if not is_instance_valid(value):
				return {"valid": false}
			var found := false
			for property in value.get_property_list():
				if property.name == StringName(part):
					found = true
					break
			if not found:
				return {"valid": false}
			value = value.get(part)
		elif value is Dictionary and value.has(part):
			value = value[part]
		elif (value is Vector2 and part in ["x", "y"]) or (value is Vector3 and part in ["x", "y", "z"]):
			value = value[part]
		else:
			return {"valid": false}
	return {"valid": true, "value": value}

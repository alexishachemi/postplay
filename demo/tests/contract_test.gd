extends SceneTree
## Deterministic serializer/contract fixtures; never records gameplay or calls a model.

const SafeValue = preload("res://addons/postplay/safe_value.gd")
var failures: Array[String] = []


func _initialize() -> void:
	call_deferred("run_tests")


func check(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)


func marker(value: Variant, reason: String) -> bool:
	return value == {"type": "unsupported", "reason": reason}


func run_tests() -> void:
	check(SafeValue.encode_payload(null) == null, "Null value")
	check(SafeValue.encode_payload([true, 2, 1.25, "fixture"]) == [true, 2, 1.25, "fixture"], "Scalar/array values")
	check(SafeValue.encode_payload(Vector2(1.5, -2)) == {"type": "Vector2", "x": 1.5, "y": -2.0}, "Vector2 type")
	check(SafeValue.encode_payload(Vector3(1, 2, 3)) == {"type": "Vector3", "x": 1.0, "y": 2.0, "z": 3.0}, "Vector3 type")
	check(SafeValue.encode_payload({"type": "Vector2"}) == {"type": "dictionary", "entries": {"type": "Vector2"}}, "Dictionary tag collision")
	check(marker(SafeValue.encode_payload(RefCounted.new()), "unsupported_type"), "Object reference")
	var freed: Variant = Node.new()
	freed.free()
	check(marker(SafeValue.encode_payload(freed), "unsupported_type"), "Freed object reference")
	check(marker(SafeValue.encode_payload(NAN), "non_finite"), "NaN")
	check(marker(SafeValue.encode_payload(INF), "non_finite"), "Infinity")
	check(marker(SafeValue.encode_payload(9223372036854775807), "number_range"), "Unsafe 64-bit integer")
	check(marker(SafeValue.encode_payload(Vector2(INF, 0)), "non_finite"), "Non-finite vector")
	check(marker(SafeValue.encode_payload("s".repeat(1025)), "string_limit"), "String bound")
	check(marker(SafeValue.encode_payload({"k".repeat(129): 1}), "key_limit"), "Key bound")
	check(marker(SafeValue.encode_payload({1: "hidden"}), "unsupported_key"), "Nonstring dictionary key")
	var many: Array = []
	many.resize(65)
	check(marker(SafeValue.encode_payload(many), "collection_limit"), "Collection bound")
	var cycle: Array = []
	cycle.append(cycle)
	check(SafeValue.encode_payload(cycle) == [{"type": "unsupported", "reason": "cycle"}], "Container cycle")
	cycle.clear()
	var deep: Array = []
	for index in range(10):
		deep = [deep]
	check(JSON.stringify(SafeValue.encode_payload(deep)).contains("depth_limit"), "Depth bound")
	var tree: Array = []
	for index in range(4):
		var leaves: Array = []
		leaves.resize(64)
		tree.append(leaves)
	check(marker(SafeValue.encode_payload(tree), "node_limit"), "Total value budget")
	var large: Array = []
	for index in range(10):
		large.append("s".repeat(1024))
	check(marker(SafeValue.encode_payload(large), "payload_limit"), "UTF-8 payload byte bound")
	var fixture_root := ProjectSettings.globalize_path("res://").path_join("../contracts/fixtures/complete")
	var manifest: Variant = JSON.parse_string(FileAccess.get_file_as_string(fixture_root.path_join("session.json")))
	check(manifest is Dictionary and manifest.schema_version == "1", "Shared manifest loads")
	var lines := FileAccess.get_file_as_string(fixture_root.path_join("events.jsonl")).strip_edges().split("\n")
	for line: String in lines:
		var parsed: Variant = JSON.parse_string(line)
		check(parsed is Dictionary and JSON.parse_string(JSON.stringify(parsed, "", true, true)) == parsed, "Shared JSONL round trip")
	var event: Dictionary = JSON.parse_string(lines[0])
	event.payload = SafeValue.encode_payload({"position": Vector2(1.5, -2), "values": [null, true, 3, 4.5, "fixture"], "unsupported": RefCounted.new()})
	print("POSTPLAY_CONTRACT_FIXTURE ", JSON.stringify(event, "", true, true))
	print("POSTPLAY_SESSION_IDS ", JSON.stringify([SafeValue.new_session_id(), SafeValue.new_session_id()]))
	print("POSTPLAY_SAFE_CASES ", JSON.stringify({"deep": SafeValue.encode_payload(deep), "nodes": SafeValue.encode_payload(tree), "bytes": SafeValue.encode_payload(large), "vector3": SafeValue.encode_payload(Vector3(1, 2, 3))}, "", true, true))
	if failures.is_empty():
		print("PASS: safe serialization, bounds, unsupported/freed objects and shared contract round trips")
		quit(0)
	else:
		for failure in failures:
			push_error(failure)
		quit(1)

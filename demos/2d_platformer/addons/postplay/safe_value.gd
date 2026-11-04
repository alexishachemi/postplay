extends RefCounted
## Raw v1 payload encoding. Never reflects objects/resources or restores native objects.
## Unsupported/oversized values become explicit markers, not misleading null values.

const MAX_DEPTH := 6
const MAX_NODES := 256
const MAX_ITEMS := 64
const MAX_STRING := 1024
const MAX_KEY := 128
const MAX_PAYLOAD_BYTES := 8192
const MAX_SAFE_NUMBER := 9007199254740991.0


static func new_session_id() -> String:
	var bytes := Crypto.new().generate_random_bytes(16)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	var hex := bytes.hex_encode()
	return "%s-%s-%s-%s-%s" % [hex.substr(0, 8), hex.substr(8, 4), hex.substr(12, 4), hex.substr(16, 4), hex.substr(20, 12)]


static func encode_payload(value: Variant) -> Variant:
	var state := {"nodes": 0, "exceeded": false}
	var encoded: Variant = _encode(value, 0, state, [])
	if state.exceeded:
		return _unsupported("node_limit")
	if JSON.stringify(encoded, "", true, true).to_utf8_buffer().size() > MAX_PAYLOAD_BYTES:
		return _unsupported("payload_limit")
	return encoded


static func _unsupported(reason: String) -> Dictionary:
	return {"type": "unsupported", "reason": reason}


static func _encode(value: Variant, depth: int, state: Dictionary, ancestors: Array) -> Variant:
	if state.exceeded:
		return _unsupported("node_limit")
	state.nodes += 1
	if state.nodes > MAX_NODES:
		state.exceeded = true
		return _unsupported("node_limit")
	if depth > MAX_DEPTH:
		return _unsupported("depth_limit")
	match typeof(value):
		TYPE_NIL, TYPE_BOOL:
			return value
		TYPE_INT, TYPE_FLOAT:
			if not is_finite(float(value)):
				return _unsupported("non_finite")
			if value < -MAX_SAFE_NUMBER or value > MAX_SAFE_NUMBER:
				return _unsupported("number_range")
			return value
		TYPE_STRING, TYPE_STRING_NAME:
			return String(value) if String(value).length() <= MAX_STRING else _unsupported("string_limit")
		TYPE_VECTOR2:
			if not _safe_number(value.x) or not _safe_number(value.y):
				return _unsupported("non_finite" if not value.is_finite() else "number_range")
			return {"type": "Vector2", "x": value.x, "y": value.y}
		TYPE_VECTOR3:
			if not _safe_number(value.x) or not _safe_number(value.y) or not _safe_number(value.z):
				return _unsupported("non_finite" if not value.is_finite() else "number_range")
			return {"type": "Vector3", "x": value.x, "y": value.y, "z": value.z}
		TYPE_ARRAY, TYPE_DICTIONARY:
			if depth == MAX_DEPTH and not value.is_empty():
				return _unsupported("depth_limit")
			for ancestor: Variant in ancestors:
				if is_same(value, ancestor):
					return _unsupported("cycle")
			if value.size() > MAX_ITEMS:
				return _unsupported("collection_limit")
			var next_ancestors := ancestors.duplicate()
			next_ancestors.append(value)
			if value is Array:
				var items: Array = []
				for item: Variant in value:
					items.append(_encode(item, depth + 1, state, next_ancestors))
					if state.exceeded:
						return _unsupported("node_limit")
				return items
			var entries := {}
			for key: Variant in value:
				if not (key is String or key is StringName):
					return _unsupported("unsupported_key")
				if String(key).length() > MAX_KEY:
					return _unsupported("key_limit")
				if entries.has(String(key)):
					return _unsupported("unsupported_key")
				entries[String(key)] = _encode(value[key], depth + 1, state, next_ancestors)
				if state.exceeded:
					return _unsupported("node_limit")
			return {"type": "dictionary", "entries": entries}
		_:
			return _unsupported("unsupported_type")


static func _safe_number(value: float) -> bool:
	return is_finite(value) and value >= -MAX_SAFE_NUMBER and value <= MAX_SAFE_NUMBER

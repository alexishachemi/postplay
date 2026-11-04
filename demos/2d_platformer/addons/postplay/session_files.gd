@tool
extends RefCounted
## Shared local capture preparation. Not an importer for untrusted session paths.

const SafeValue = preload("res://addons/postplay/safe_value.gd")
const MAX_MANIFEST_BYTES := 262144


static func manifest(project: Dictionary, capture: Dictionary, id: String) -> Dictionary:
	var format: String = capture.get("format", "avi")
	return {"schema_version": "1", "session_id": id, "project": project.duplicate(true),
		"godot_version": Engine.get_version_info()["string"], "status": "recording",
		"started_at_utc": Time.get_datetime_string_from_system(true) + "Z", "ended_at_utc": null,
		"capture": {"mode": capture.get("mode", "movie_maker"), "video_path": "recording." + format,
			"format": format, "fps": capture.get("fps", 30), "width": capture.get("width", 960),
			"height": capture.get("height", 540), "duration_ms": null,
			"collision_debug": capture.get("collision_debug", false)},
		"telemetry": {"path": "events.jsonl", "event_count": 0, "truncated": false},
		"synchronization": {"status": "unknown", "estimated_error_ms": null, "anchor": null,
			"notes": ["Unfinalized capture; video existence, duration and alignment not verified."]},
		"registrations": []}


static func write_json(path: String, value: Dictionary) -> Error:
	var bytes := (JSON.stringify(value, "\t", true, true) + "\n").to_utf8_buffer()
	if bytes.size() > MAX_MANIFEST_BYTES:
		return ERR_OUT_OF_MEMORY
	var file := FileAccess.open(path + ".pending", FileAccess.WRITE)
	if file == null:
		return FileAccess.get_open_error()
	file.store_buffer(bytes)
	file.flush()
	var error := file.get_error()
	file.close()
	return error if error != OK else DirAccess.rename_absolute(path + ".pending", path)


static func read_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null or file.get_length() > MAX_MANIFEST_BYTES:
		return {}
	var parser := JSON.new()
	if parser.parse(file.get_as_text()) != OK:
		return {}
	var value: Variant = parser.data
	return value if value is Dictionary else {}


static func process_alive(pid: int) -> bool:
	if pid <= 0:
		return false
	# OS.is_process_running only supports this Godot instance's child handles on Unix.
	# Captures may outlive an editor restart, so Linux uses conservative /proc presence.
	if OS.get_name() == "Linux":
		return DirAccess.dir_exists_absolute("/proc/%d" % pid)
	return pid == OS.get_process_id() or OS.is_process_running(pid)


static func reserve(root: String, project: Dictionary, capture: Dictionary) -> Dictionary:
	root = ProjectSettings.globalize_path(root)
	if not root.is_absolute_path():
		return {}
	if DirAccess.make_dir_recursive_absolute(root) != OK:
		return {}
	var id := SafeValue.new_session_id()
	var directory := root.path_join(id)
	if DirAccess.make_dir_absolute(directory) != OK:
		return {}
	var initial := manifest(project, capture, id)
	if write_json(directory.path_join("session.json"), initial) != OK:
		return {}
	var events := FileAccess.open(directory.path_join("events.jsonl"), FileAccess.WRITE)
	if events == null:
		return {}
	events.close()
	if write_json(directory.path_join("launch.json"), {"version": 1, "session_id": id}) != OK:
		return {}
	return {"directory": directory, "manifest": initial}

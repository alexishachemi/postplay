extends Node
## Runtime-only session writer. No editor APIs, scene scanning or remote requests.
## See docs/capture-runtime.md for lifecycle and recovery guarantees.

const SafeValue = preload("res://addons/postplay/safe_value.gd")
const Watchers = preload("res://addons/postplay/watchers.gd")
const MAX_EVENTS := 10000
const MAX_LOG_BYTES := 16777216
const MAX_EVENT_BYTES := 16384
const MAX_MANIFEST_BYTES := 262144
const EVENT_KINDS := ["lifecycle", "signal", "property", "input", "position", "annotation", "progression"]

var session_directory := ""
var last_error: Error = OK
var _manifest: Dictionary = {}
var _events: FileAccess
var _started_ticks := 0
var _simulation_ms := 0.0
var _checkpoint_elapsed := 0.0
var _active := false
var _used := false
var _watchers: RefCounted


func _init() -> void:
	_watchers = Watchers.new(self)


## Observe an existing signal (0–8 arguments). Returns reg-N, or empty on failure.
func watch_signal(observed: Signal, description: String, expected_behavior: String = "") -> String:
	return _watchers.watch_signal(observed, description, expected_behavior) if _active else ""


## Initial value + changed samples, at 50–60000 ms simulation intervals.
func watch_property(target: Variant, property_path: String, description: String, interval_ms: int = 100, expected_behavior: String = "") -> String:
	# A typed Object parameter rejects freed references before this guard can run.
	if typeof(target) != TYPE_OBJECT or not is_instance_valid(target):
		return ""
	return _watchers.watch_property(target, property_path, description, interval_ms, expected_behavior) if _active else ""


## Stop observing; historical metadata/events remain intact.
func unwatch(registration_id: String) -> bool:
	return _watchers.unwatch(registration_id)


## Must be in the scene tree. A collector owns exactly one new UUID directory.
## capture overrides: mode, format, fps, width, height, collision_debug only.
## The video path is reserved as recording.<format>; duration remains unknown.
func start_session(output_root: String, project: Dictionary, capture: Dictionary = {}, requested_id: String = "") -> Error:
	if _used or not is_inside_tree():
		return ERR_ALREADY_IN_USE if _used else ERR_UNCONFIGURED
	if not _valid_project(project) or not _valid_capture(capture):
		return ERR_INVALID_PARAMETER
	var session_id := requested_id if not requested_id.is_empty() else SafeValue.new_session_id()
	if not _matches("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", session_id):
		return ERR_INVALID_PARAMETER
	var root := ProjectSettings.globalize_path(output_root)
	if not root.is_absolute_path():
		return ERR_INVALID_PARAMETER
	last_error = DirAccess.make_dir_recursive_absolute(root)
	if last_error != OK:
		return last_error
	var target := root.path_join(session_id)
	# Exclusive leaf creation: never open an older session, even with a supplied ID.
	last_error = DirAccess.make_dir_absolute(target)
	if last_error != OK:
		return last_error
	_used = true
	session_directory = target
	_started_ticks = Time.get_ticks_msec()
	var format: String = capture.get("format", "avi")
	_manifest = {
		"schema_version": "1", "session_id": session_id,
		"project": project.duplicate(true), "godot_version": Engine.get_version_info()["string"],
		"status": "recording", "started_at_utc": _utc_now(), "ended_at_utc": null,
		"capture": {
			"mode": capture.get("mode", "movie_maker"), "video_path": "recording." + format,
			"format": format, "fps": capture.get("fps", 30),
			"width": capture.get("width", 960), "height": capture.get("height", 540),
			"duration_ms": null, "collision_debug": capture.get("collision_debug", false)
		},
		"telemetry": {"path": "events.jsonl", "event_count": 0, "truncated": false},
		"synchronization": {"status": "unknown", "estimated_error_ms": null, "anchor": null,
			"notes": ["Unfinalized capture; video existence, duration and alignment not verified."]},
		"registrations": []
	}
	# A recoverable recording manifest exists before the log is opened.
	last_error = _write_manifest()
	if last_error != OK:
		return last_error
	_events = FileAccess.open(target.path_join("events.jsonl"), FileAccess.WRITE)
	if _events == null:
		last_error = FileAccess.get_open_error()
		return last_error
	_active = true
	set_process(true)
	return append_event("lifecycle", "capture_started", {"video_finalization": "pending"})


## Append one bounded, JSON-safe observation. No raw input or object reflection.
## Rejected labels/kinds do not consume IDs; limits stop collection and flag truncation.
func append_event(kind: String, label: String, payload: Variant = null) -> Error:
	return _append_event(kind, label, payload)


func _append_event(kind: String, label: String, payload: Variant = null, registration: Dictionary = {}) -> Error:
	if not _active:
		return ERR_UNCONFIGURED
	if kind not in EVENT_KINDS or label.is_empty() or label.length() > 256:
		return ERR_INVALID_PARAMETER
	if _manifest.telemetry.truncated:
		return ERR_OUT_OF_MEMORY
	var sequence: int = _manifest.telemetry.event_count + 1
	var event := {
		"schema_version": "1", "session_id": _manifest.session_id,
		"id": "evt-%d" % sequence, "sequence": sequence, "kind": kind,
		"time": {"wall_elapsed_ms": Time.get_ticks_msec() - _started_ticks,
			"simulation_ms": _simulation_ms, "process_frame": Engine.get_process_frames(),
			"physics_frame": Engine.get_physics_frames()},
		"registration_id": registration.get("id"),
		"source": registration.get("source", {"id": "src-1", "label": "PostPlay runtime", "node_path": null}),
		"label": label, "payload": SafeValue.encode_payload(payload)
	}
	var line := JSON.stringify(event, "", true, true) + "\n"
	var bytes := line.to_utf8_buffer()
	if sequence > MAX_EVENTS or bytes.size() > MAX_EVENT_BYTES or _events.get_position() + bytes.size() > MAX_LOG_BYTES:
		_manifest.telemetry.truncated = true
		_watchers.stop()
		last_error = _write_manifest()
		return ERR_OUT_OF_MEMORY if last_error == OK else last_error
	_events.store_buffer(bytes)
	_events.flush()
	last_error = _events.get_error()
	if last_error != OK:
		# A partial final line is preserved, not silently repaired or counted.
		_active = false
		_watchers.stop()
		_events.close()
		_events = null
		return last_error
	_manifest.telemetry.event_count = sequence
	return OK


## Flush and atomically replace the manifest; a crash may leave a lagging count.
func checkpoint() -> Error:
	if not _active:
		return ERR_UNCONFIGURED
	_events.flush()
	last_error = _events.get_error()
	if last_error == OK:
		last_error = _write_manifest()
	return last_error


## Close telemetry but keep status recording, for editor-side media finalization.
## Without that later finalizer this package is explicitly unfinalized, not clean.
func seal_for_finalization() -> Error:
	return _close_capture(false)


## Explicit cancellation. Terminal incomplete packages must never become complete.
func abort_session() -> Error:
	return _close_capture(true)


func _close_capture(aborted: bool) -> Error:
	if not _active:
		return ERR_UNCONFIGURED
	_watchers.stop()
	var append_error := append_event("lifecycle", "capture_aborted" if aborted else "runtime_stopped")
	if not _active:
		return append_error
	if aborted:
		_manifest.status = "incomplete"
		# A system clock adjustment must not produce an invalid end-before-start.
		var now := _utc_now()
		_manifest.ended_at_utc = now if now >= _manifest.started_at_utc else _manifest.started_at_utc
		_manifest.synchronization.notes = ["Capture aborted; original partial media and telemetry preserved."]
	var checkpoint_error := checkpoint()
	_events.close()
	_events = null
	_active = false
	set_process(false)
	return checkpoint_error if checkpoint_error != OK else append_error


func _process(delta: float) -> void:
	if not _active:
		return
	_simulation_ms += delta * 1000.0
	_watchers.sample(delta)
	_checkpoint_elapsed += delta
	if _checkpoint_elapsed >= 1.0:
		_checkpoint_elapsed = 0.0
		checkpoint()


func _exit_tree() -> void:
	if _active:
		seal_for_finalization()
	_watchers.stop()


func _add_registration(kind: String, source: Dictionary, description: String, expected_behavior: String) -> Dictionary:
	if not _active or source.is_empty() or _manifest.telemetry.truncated or _manifest.registrations.size() >= 128:
		return {}
	var registration := {"id": "reg-%d" % (_manifest.registrations.size() + 1),
		"kind": kind, "source": source.duplicate(), "description": description,
		"expected_behavior": null if expected_behavior.is_empty() else expected_behavior}
	_manifest.registrations.append(registration)
	# Never emit references to a registration that hasn't reached disk.
	if checkpoint() != OK:
		_manifest.registrations.pop_back()
		return {}
	return registration


func _write_manifest() -> Error:
	var bytes := (JSON.stringify(_manifest, "\t", true, true) + "\n").to_utf8_buffer()
	if bytes.size() > MAX_MANIFEST_BYTES:
		return ERR_OUT_OF_MEMORY
	var temporary := session_directory.path_join("session.json.pending")
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		return FileAccess.get_open_error()
	file.store_buffer(bytes)
	file.flush()
	var error := file.get_error()
	file.close()
	if error != OK:
		return error
	# Same-directory replacement preserves the prior manifest on an interrupted write.
	return DirAccess.rename_absolute(temporary, session_directory.path_join("session.json"))


static func _utc_now() -> String:
	return Time.get_datetime_string_from_system(true) + "Z"


static func _matches(pattern: String, value: String) -> bool:
	var regex := RegEx.new()
	if regex.compile(pattern) != OK:
		return false
	var matched := regex.search(value)
	# PCRE's $ can also match before a trailing newline; require the whole value.
	return matched != null and matched.get_string() == value


static func _portable_path(path: String) -> bool:
	if path.is_empty() or path.length() > 512 or path.begins_with("/"):
		return false
	for character in path:
		if character.unicode_at(0) < 32 or character.unicode_at(0) == 127 or character in "\\:%?#":
			return false
	for part in path.split("/"):
		if part in ["", ".", ".."]:
			return false
	return true


static func _valid_project(project: Dictionary) -> bool:
	if project.size() != 3:
		return false
	for key in ["id", "name", "scene"]:
		if not project.get(key) is String:
			return false
	return _matches("^[A-Za-z0-9_-]{1,128}$", project.id) and not project.name.is_empty() and project.name.length() <= 256 and _portable_path(project.scene)


static func _valid_capture(capture: Dictionary) -> bool:
	for key in capture:
		if key not in ["mode", "format", "fps", "width", "height", "collision_debug"]:
			return false
	var mode: Variant = capture.get("mode", "movie_maker")
	var format: Variant = capture.get("format", "avi")
	if mode not in ["movie_maker", "external"] or format not in ["avi", "ogv", "mp4"] or (mode == "external" and format != "mp4"):
		return false
	var fps: Variant = capture.get("fps", 30)
	if not (fps is int or fps is float) or not is_finite(float(fps)) or fps < 1 or fps > 240:
		return false
	for dimension in ["width", "height"]:
		var value: Variant = capture.get(dimension, 960 if dimension == "width" else 540)
		if not value is int or value < 1 or value > 16384:
			return false
	return capture.get("collision_debug", false) is bool

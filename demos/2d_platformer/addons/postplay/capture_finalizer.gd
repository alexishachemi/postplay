@tool
extends RefCounted
## Finalizes this addon's own stopped captures, not general untrusted imports.

const Files = preload("res://addons/postplay/session_files.gd")


static func finalize(directory: String, failure: String = "") -> Dictionary:
	var path := directory.path_join("session.json")
	var session := Files.read_json(path)
	if session.get("schema_version") != "1" or session.get("status") != "recording" or session.get("session_id") != directory.get_file():
		return {"ok": false, "message": "Capture is not an owned, unfinalized v1 session."}
	var closed := Files.read_json(directory.path_join("runtime.closed.json"))
	var ready := Files.read_json(directory.path_join("runtime.ready.json"))
	if ready.has("pid") and Files.process_alive(int(ready.pid)):
		return {"ok": false, "message": "Capture process is still running; no files changed."}
	var log := _inspect_log(directory, session.session_id)
	if failure.is_empty() and not log.ok:
		failure = log.message
	if failure.is_empty() and (closed.get("session_id") != session.session_id or closed.get("event_count", -1) != log.count):
		failure = "Runtime did not confirm an orderly telemetry close; capture may have been interrupted."
	if failure.is_empty() and not session.telemetry.truncated and log.last_label != "runtime_stopped":
		failure = "Telemetry has no orderly runtime stop event."
	var media := {}
	if failure.is_empty():
		media = _inspect_media(directory.path_join("recording.avi"), session.capture.fps)
		if not media.ok:
			failure = media.message
	if log.ok:
		session.telemetry.event_count = log.count
	var now := Time.get_datetime_string_from_system(true) + "Z"
	session.ended_at_utc = now if now >= session.started_at_utc else session.started_at_utc
	session.status = "complete" if failure.is_empty() else "incomplete"
	if failure.is_empty():
		session.capture.duration_ms = media.duration_ms
		session.capture.width = media.width
		session.capture.height = media.height
	session.synchronization.notes = ["Media finalized and decoded; visible-event synchronization is still unmeasured." if failure.is_empty() else failure.left(1024)]
	var error := Files.write_json(path, session)
	if error != OK:
		return {"ok": false, "message": "Could not save finalization (%s); preserved prior manifest." % error_string(error)}
	return {"ok": failure.is_empty(), "message": "Capture complete; synchronization unknown." if failure.is_empty() else failure, "directory": directory}


static func _inspect_log(directory: String, id: String) -> Dictionary:
	var file := FileAccess.open(directory.path_join("events.jsonl"), FileAccess.READ)
	if file == null or file.get_length() > 16777216:
		return {"ok": false, "message": "Telemetry missing or exceeds capture byte limit."}
	var text := file.get_as_text()
	var lines := text.split("\n")
	if lines[-1].is_empty():
		lines.remove_at(lines.size() - 1)
	if lines.is_empty() or lines.size() > 10000:
		return {"ok": false, "message": "Telemetry is empty or exceeds event limit."}
	var last_label := ""
	for index in range(lines.size()):
		if lines[index].to_utf8_buffer().size() > 16384:
			return {"ok": false, "message": "Telemetry line exceeds byte limit; original preserved."}
		var parser := JSON.new()
		if parser.parse(lines[index]) != OK:
			return {"ok": false, "message": "Malformed telemetry; original preserved for inspection."}
		var event: Variant = parser.data
		if not event is Dictionary or event.get("schema_version") != "1" or event.get("session_id") != id or event.get("id") != "evt-%d" % (index + 1) or event.get("sequence") != index + 1:
			return {"ok": false, "message": "Malformed/noncontiguous telemetry; original preserved for inspection."}
		last_label = event.get("label", "")
	return {"ok": true, "count": lines.size(), "last_label": last_label}


static func _inspect_media(path: String, fps: float) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"ok": false, "message": "Movie Maker produced no recording.avi."}
	var output: Array = []
	var code := OS.execute("ffprobe", PackedStringArray(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", path]), output, true)
	if code != 0 or output.is_empty():
		return {"ok": false, "message": "FFprobe failed; install FFmpeg/FFprobe on the editor PATH and inspect original media."}
	var probe: Variant = JSON.parse_string(output[0])
	if not probe is Dictionary or not probe.get("streams") is Array or probe.streams.size() != 1 or not probe.get("format") is Dictionary:
		return {"ok": false, "message": "Movie metadata is invalid."}
	var stream: Dictionary = probe.streams[0]
	var duration := float(probe.format.get("duration", "0"))
	var rate := String(stream.get("r_frame_rate", "0/0")).split("/")
	if rate.size() != 2 or float(rate[1]) <= 0 or absf(float(rate[0]) / float(rate[1]) - fps) > 0.01 or not is_finite(duration) or duration <= 0 or duration * 1000 > 9007199254740991.0:
		return {"ok": false, "message": "Movie duration or frame rate does not match capture settings."}
	var width := int(stream.get("width", 0))
	var height := int(stream.get("height", 0))
	if width < 1 or width > 16384 or height < 1 or height > 16384:
		return {"ok": false, "message": "Movie dimensions are unsupported."}
	output.clear()
	if OS.execute("ffmpeg", PackedStringArray(["-v", "error", "-xerror", "-i", path, "-map", "0:v:0", "-an", "-f", "null", "-"]), output, true) != 0:
		return {"ok": false, "message": "Movie failed full video decode; original media preserved."}
	return {"ok": true, "duration_ms": roundi(duration * 1000.0), "width": width, "height": height}

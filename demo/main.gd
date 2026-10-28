extends Node2D
## Small human-controlled smoke scene; this probe is not the portable addon API.

signal beacon_activated(activation_count: int)

const PLAY_AREA := Rect2(40, 170, 880, 330)
const PLAYER_RADIUS := 16.0
const SPEED := 240.0
const MAX_PROBE_EVENTS := 2400

var player_position := Vector2(160, 330)
var activation_count: int = 0
var simulation_seconds: float = 0.0
var flash_seconds: float = 0.0
var sample_seconds: float = 0.0
var probe: FileAccess
var probe_event_count: int = 0


func _ready() -> void:
	var output_root := OS.get_environment("POSTPLAY_SMOKE_OUTPUT")
	if not output_root.is_empty():
		# A new child directory for every launch; never truncate an older probe.
		var output_dir := output_root.path_join(
			"smoke-%s-%s" % [Time.get_datetime_string_from_system().replace(":", "-"), Crypto.new().generate_random_bytes(8).hex_encode()]
		)
		if DirAccess.make_dir_recursive_absolute(output_dir) != OK:
			push_error("Cannot create smoke telemetry directory")
		else:
			probe = FileAccess.open(output_dir.path_join("smoke-events.jsonl"), FileAccess.WRITE)
			if probe == null:
				push_error("Cannot open smoke telemetry file")
			else:
				print("Smoke telemetry: ", output_dir)
				write_probe("start", {"synchronization": "unknown", "godot_version": Engine.get_version_info().string})
	queue_redraw()


func _process(delta: float) -> void:
	simulation_seconds += delta
	flash_seconds = maxf(0.0, flash_seconds - delta)
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	player_position += direction * SPEED * delta
	player_position = player_position.clamp(
		PLAY_AREA.position + Vector2.ONE * PLAYER_RADIUS,
		PLAY_AREA.end - Vector2.ONE * PLAYER_RADIUS
	)
	sample_seconds += delta
	if sample_seconds >= 0.1:
		sample_seconds = 0.0
		write_probe("position", {"x": player_position.x, "y": player_position.y})
	queue_redraw()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_accept") and not event.is_echo():
		activate_beacon()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("ui_cancel"):
		get_tree().quit()


func activate_beacon() -> void:
	activation_count += 1
	flash_seconds = 0.5
	$InteractionCount.text = "Beacon activations: %d" % activation_count
	beacon_activated.emit(activation_count)
	write_probe("beacon_activated", {"activation_count": activation_count})
	queue_redraw()


func _draw() -> void:
	draw_rect(PLAY_AREA, Color("172a3a"))
	draw_rect(PLAY_AREA, Color("7897ae"), false, 3.0)
	var beacon_color := Color("f2b34c") if flash_seconds <= 0.0 else Color("ff55b5")
	draw_circle(Vector2(760, 330), 42.0, beacon_color)
	if flash_seconds > 0.0:
		draw_rect(Rect2(0, 145, 960, 12), beacon_color)
	draw_circle(player_position, PLAYER_RADIUS, Color("54e6cf"))


func write_probe(kind: String, payload: Dictionary) -> void:
	if probe == null or probe_event_count >= MAX_PROBE_EVENTS:
		return
	if probe_event_count == MAX_PROBE_EVENTS - 1:
		kind = "probe_limit"
		payload = {"omitted_further_events": true}
	probe_event_count += 1
	probe.store_line(JSON.stringify({
		"probe_version": "smoke-1",
		"id": "evt-%d" % probe_event_count,
		"kind": kind,
		"simulation_ms": roundi(simulation_seconds * 1000.0),
		"process_frame": Engine.get_process_frames(),
		"physics_frame": Engine.get_physics_frames(),
		"payload": payload,
	}))
	probe.flush()


func _exit_tree() -> void:
	if probe != null:
		write_probe("end", {"event_limit_reached": probe_event_count >= MAX_PROBE_EVENTS - 1})
		probe.close()

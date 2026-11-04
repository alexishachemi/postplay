extends Node2D
## Starfall Relay: gameplay signals work independently of PostPlay.

signal cell_collected(total: int)
signal airlock_opened
signal relay_completed
signal pilot_returned
signal timing_pulse(sequence: int)

const PlayerController = preload("res://player.gd")
const PLAY_AREA := Rect2(36, 160, 1208, 480)
const CELL_POSITIONS := [Vector2(350, 480), Vector2(630, 385), Vector2(950, 290)]
const PLATFORMS := [Rect2(36, 620, 1208, 40), Rect2(250, 520, 190, 24), Rect2(530, 425, 200, 24), Rect2(850, 330, 200, 24)]
const SPAWN := Vector2(110, 620)
var player: CharacterBody2D
var cells := 0
var displayed_cells := 0
var airlock_ready := false
var completed := false
var collected: Array[bool] = [false, false, false]
var pulse_sequence := 0
var _pulse_remaining := 0.0
var _clock := 0.0
var _fault_case := ""
var _fault_enabled := false
var _tiles: Texture2D
var _hud: Label
var _status: Label
var _stripe: ColorRect
var _wall: StaticBody2D

func _ready() -> void:
	_fault_case = OS.get_environment("POSTPLAY_DEMO_CASE")
	_fault_enabled = OS.get_environment("POSTPLAY_DEMO_FAULT") == "1"
	_tiles = load("res://assets/platform-template.png")
	for platform in PLATFORMS:
		_make_solid(platform)
	_make_solid(Rect2(12, 155, 24, 510))
	_wall = _make_solid(Rect2(1244, 155, 24, 510))
	if _fault_enabled and _fault_case == "boundary":
		_wall.collision_layer = 0
	player = PlayerController.new()
	player.name = "Pilot"
	player.position = SPAWN
	add_child(player)
	_build_hud()
	_refresh_hud()
	_register_observations()

func _make_solid(rect: Rect2) -> StaticBody2D:
	var body := StaticBody2D.new()
	var shape := CollisionShape2D.new()
	var rectangle := RectangleShape2D.new()
	rectangle.size = rect.size
	shape.shape = rectangle
	body.position = rect.get_center()
	body.add_child(shape)
	add_child(body)
	return body

func _build_hud() -> void:
	var canvas := CanvasLayer.new()
	add_child(canvas)
	var panel := ColorRect.new()
	panel.position = Vector2(0, 0)
	panel.size = Vector2(1280, 148)
	panel.color = Color("101c32")
	canvas.add_child(panel)
	var title := _label(canvas, Vector2(36, 19), "STARFALL  /  RELAY", 30, Color("b9f3ff"))
	title.add_theme_constant_override("outline_size", 2)
	_label(canvas, Vector2(36, 86), "Restore 3 power cells, then reach the east airlock.", 19, Color("d3dbe8"))
	_label(canvas, Vector2(36, 115), "← → Move   Space / ↑ Jump   R Restart   Tab Timing pulse   Esc Finish", 17, Color("849ab9"))
	_hud = _label(canvas, Vector2(927, 24), "", 27, Color("ffd27b"))
	_status = _label(canvas, Vector2(927, 90), "AIRLOCK  /  OFFLINE", 16, Color("a6bad4"))
	_stripe = ColorRect.new()
	_stripe.position = Vector2(0, 76)
	_stripe.size = Vector2(1280, 8)
	_stripe.color = Color("ff55d9")
	_stripe.visible = false
	canvas.add_child(_stripe)
	var footer := ColorRect.new()
	footer.position = Vector2(0, 674)
	footer.size = Vector2(1280, 46)
	footer.color = Color("101c32")
	canvas.add_child(footer)
	_label(canvas, Vector2(36, 684), "STATION RULES  /  Cells update the counter immediately · Pilot stays inside the blue perimeter", 17, Color("a6bad4"))

func _label(parent: Node, at: Vector2, value: String, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.position = at
	label.text = value
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	parent.add_child(label)
	return label

func _physics_process(delta: float) -> void:
	_clock += delta
	_pulse_remaining = maxf(0.0, _pulse_remaining - delta)
	_stripe.visible = _pulse_remaining > 0.0
	if not completed:
		for index in range(CELL_POSITIONS.size()):
			if not collected[index] and player.position.distance_to(CELL_POSITIONS[index] + Vector2(0, 20)) < 45:
				collect_cell(index)
		if airlock_ready and player.position.x > 1150 and player.position.y > 570 and player.position.x < 1240:
			complete_relay()
	# Safety tether prevents an endless fall without masking the visible excursion.
	if player.position.y > 760 or player.position.x > 1350:
		return_pilot()
	queue_redraw()

func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_R:
			restart()
		elif event.keycode == KEY_TAB:
			trigger_timing_pulse()
		elif event.keycode == KEY_ESCAPE:
			get_tree().quit()

func collect_cell(index: int) -> void:
	if index < 0 or index >= collected.size() or collected[index] or completed:
		return
	collected[index] = true
	cells += 1
	if not (_fault_enabled and _fault_case == "hud"):
		displayed_cells = cells
	_refresh_hud()
	cell_collected.emit(cells)
	if cells == 3:
		airlock_ready = true
		_refresh_hud()
		airlock_opened.emit()

func complete_relay() -> void:
	if completed or not airlock_ready:
		return
	completed = true
	player.enabled = false
	_refresh_hud()
	relay_completed.emit()

func return_pilot() -> void:
	player.position = SPAWN
	player.velocity = Vector2.ZERO
	pilot_returned.emit()

func restart() -> void:
	cells = 0
	displayed_cells = 0
	airlock_ready = false
	completed = false
	collected = [false, false, false]
	player.enabled = true
	return_pilot()
	_refresh_hud()

func trigger_timing_pulse() -> void:
	pulse_sequence += 1
	_pulse_remaining = 0.4
	_stripe.visible = true
	timing_pulse.emit(pulse_sequence)

func _refresh_hud() -> void:
	_hud.text = "POWER CELLS   %d / 3" % displayed_cells
	_status.text = "RELAY RESTORED  /  R REPLAY" if completed else ("AIRLOCK  /  READY →" if airlock_ready else "AIRLOCK  /  OFFLINE")
	_status.modulate = Color("86f7bb") if airlock_ready else Color.WHITE

func _register_observations() -> void:
	var recorder := get_node_or_null("/root/PostPlay")
	if recorder == null:
		return
	recorder.watch_signal(cell_collected, "Power cell collected", "Each collected cell increments authoritative cells and the visible power counter immediately.")
	recorder.watch_property(self, "cells", "Authoritative collected power cells", 100)
	recorder.watch_property(self, "displayed_cells", "Visible power counter", 100, "The visible counter should equal the authoritative collected power cells.")
	recorder.watch_property(self, "airlock_ready", "Airlock power available", 100, "Three collected cells make the airlock available.")
	recorder.watch_property(player, "position", "Pilot position", 100, "Pilot feet remain within x=36..1244, y=160..640 station perimeter.")
	recorder.set_player(player, 100)
	recorder.set_playable_bounds(PLAY_AREA, "Blue station perimeter", "world")
	recorder.watch_signal(player.jumped, "Pilot jumped")
	recorder.watch_signal(pilot_returned, "Pilot returned to the entrance")
	recorder.watch_progression(airlock_opened, "Airlock powered", "After three cells, the east airlock permits exit.")
	recorder.watch_progression(relay_completed, "Pilot reached the powered airlock")
	recorder.watch_signal(timing_pulse, "Visible magenta timing stripe", "A timing pulse lights the horizontal magenta stripe at y=76 for 0.4 simulation seconds.")

func _draw() -> void:
	# Pixel-art station panels, starfield and illuminated flight deck.
	draw_rect(Rect2(0, 148, 1280, 526), Color("0b1225"))
	for index in range(70):
		var point := Vector2(44 + (index * 137) % 1190, 170 + (index * 83) % 440)
		draw_circle(point, 1.0 if index % 3 else 1.7, Color("314867"))
	for x in range(60, 1230, 96):
		draw_rect(Rect2(x, 177, 74, 84), Color("111e32"))
		draw_line(Vector2(x, 262), Vector2(x + 74, 262), Color("223650"), 2)
	draw_arc(Vector2(1100, 230), 86, 0, TAU, 64, Color("1c3251"), 12)
	draw_arc(Vector2(1100, 230), 65, 0, TAU, 64, Color("243b5e"), 2)
	for platform in PLATFORMS:
		draw_rect(platform, Color("273650"))
		for x in range(int(platform.position.x), int(platform.end.x), 48):
			var width := minf(48, platform.end.x - x)
			# The blue floor strip is 16×8px, displayed at a uniform 3× scale.
			draw_texture_rect_region(_tiles, Rect2(x, platform.position.y, width, 24), Rect2(0, 48, width / 3.0, 8))
		draw_line(platform.position, Vector2(platform.end.x, platform.position.y), Color("9ab6ff"), 3)
		draw_rect(Rect2(platform.position + Vector2(0, platform.size.y), Vector2(platform.size.x, 6)), Color("0a111f"))
	draw_rect(PLAY_AREA, Color("4a7b9a"), false, 2)
	for index in range(CELL_POSITIONS.size()):
		var at: Vector2 = CELL_POSITIONS[index]
		if not collected[index]:
			at.y += sin(_clock * 3 + index) * 4
			draw_circle(at, 22, Color(0.13, 0.85, 0.85, 0.10))
			draw_rect(Rect2(at - Vector2(8, 13), Vector2(16, 26)), Color("273952"))
			draw_rect(Rect2(at - Vector2(5, 9), Vector2(10, 18)), Color("7cf5c4"))
			draw_line(at + Vector2(-3, -5), at + Vector2(3, -5), Color.WHITE, 2)
		else:
			draw_arc(at, 12, 0, TAU, 12, Color("3a6c6d"), 2)
	var gate := Rect2(1140, 520, 82, 100)
	draw_rect(gate.grow(7), Color("253b52"))
	draw_rect(gate, Color("163f43") if airlock_ready else Color("182337"))
	if not airlock_ready:
		for x in range(1151, 1220, 16):
			draw_line(Vector2(x, 528), Vector2(x, 612), Color("526078"), 6)
	draw_rect(Rect2(1140, 514, 82, 5), Color("7cf5c4") if airlock_ready else Color("ebac6a"))
	for index in range(3):
		draw_circle(Vector2(1161 + index * 20, 539), 4, Color("7cf5c4") if cells > index else Color("45516d"))
	if completed:
		draw_rect(Rect2(370, 238, 540, 124), Color("101c32"))
		draw_rect(Rect2(370, 238, 540, 124), Color("7cf5c4"), false, 2)
		draw_string(ThemeDB.fallback_font, Vector2(438, 291), "STATION RELAY RESTORED", HORIZONTAL_ALIGNMENT_LEFT, -1, 28, Color("a1f9d0"))
		draw_string(ThemeDB.fallback_font, Vector2(439, 330), "Safe travels, pilot.  R to run again.", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color("c6d6e8"))

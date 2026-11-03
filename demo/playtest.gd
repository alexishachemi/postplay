extends Node2D
## Small game, not a detector. Local developer selectors are never observations.

signal energy_spent(remaining: int)
signal interaction_attempted(action: String, result: String)
signal transfer_changed(state: String)
signal marker_changed(sequence: int)

const PLAY_AREA := Rect2(60, 190, 840, 280)
const SPEED := 220.0
const RADIUS := 16.0
var player_position := Vector2(160, 330)
var energy := 100
var displayed_energy := 100
var transferring := false
var gate_open := false
var completed := false
var transfer_seconds := 0.0
var marker_seconds := 0.0
var marker_sequence := 0
var status_text := "Collect energy at the console, dispatch at the gate."
# Configuration is deliberately absent from UI, signal arguments and watches.
var _fault := ""


func _ready() -> void:
	if OS.get_environment("POSTPLAY_DEMO_FAULT") == "1":
		_fault = OS.get_environment("POSTPLAY_DEMO_CASE")
	if not InputMap.has_action("depot_reset"):
		InputMap.add_action("depot_reset")
		var key := InputEventKey.new()
		key.physical_keycode = KEY_R
		InputMap.action_add_event("depot_reset", key)
	var capture = get_node_or_null("/root/PostPlay")
	if capture != null:
		capture.set_input_actions(["ui_left", "ui_right", "ui_up", "ui_down", "ui_accept", "depot_reset", "ui_focus_next"])
		capture.set_player(self, 500, "player_position", "scene_local")
		capture.set_playable_bounds(PLAY_AREA, "Player must remain in the outlined arena", "scene_local")
		capture.watch_property(self, "energy", "Authoritative energy", 200)
		capture.watch_property(self, "displayed_energy", "HUD energy", 200, "HUD energy must match authoritative energy immediately after a console interaction.")
		capture.watch_property(self, "transferring", "Transfer in progress", 200)
		capture.watch_property(self, "gate_open", "Gate open", 200)
		capture.watch_signal(energy_spent, "Console energy transaction", "Each console interaction spends 20 energy and updates the HUD immediately.")
		capture.watch_signal(interaction_attempted, "Player interaction and actual result")
		capture.watch_progression(transfer_changed, "Transfer progression", "Dispatch opens the gate within one second; reset cancels a pending transfer so dispatch can be attempted again.")
		capture.watch_signal(marker_changed, "Visible timing stripe changes to magenta; sequence shown in HUD")
	queue_redraw()


func _process(delta: float) -> void:
	move_player(Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down"), delta)
	marker_seconds = maxf(0.0, marker_seconds - delta)
	if transferring:
		transfer_seconds += delta
		if transfer_seconds >= 1.0 and _fault != "progress":
			transferring = false
			gate_open = true
			status_text = "Gate ready. Walk to the delivery pad."
			transfer_changed.emit("gate_open")
	if gate_open and player_position.distance_to(Vector2(830, 330)) < 35.0 and not completed:
		completed = true
		status_text = "Delivery complete! Continue exploring or Escape to finish."
		transfer_changed.emit("delivered")
	queue_redraw()


func move_player(direction: Vector2, delta: float) -> void:
	player_position += direction * SPEED * delta
	player_position.y = clampf(player_position.y, PLAY_AREA.position.y + RADIUS, PLAY_AREA.end.y - RADIUS)
	# A missing right-hand collision segment, not a teleport or model-side label.
	var right := 940.0 if _fault == "boundary" and player_position.y < 290.0 else PLAY_AREA.end.x - RADIUS
	player_position.x = clampf(player_position.x, PLAY_AREA.position.x + RADIUS, right)
	if not gate_open and player_position.y >= 290.0:
		player_position.x = minf(player_position.x, 720.0 - RADIUS)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_echo():
		return
	if event.is_action_pressed("ui_accept"):
		interact()
	elif event.is_action_pressed("depot_reset"):
		reset_transfer()
	elif event.is_action_pressed("ui_focus_next"):
		marker_sequence += 1
		marker_seconds = 0.3
		marker_changed.emit(marker_sequence)
	elif event.is_action_pressed("ui_cancel"):
		get_tree().quit()


func interact() -> void:
	if player_position.distance_to(Vector2(260, 330)) < 65.0:
		if energy >= 20:
			energy -= 20
			if _fault != "ui":
				displayed_energy = energy
			status_text = "Console spent 20 energy."
			energy_spent.emit(energy)
			interaction_attempted.emit("console", "spent")
		else:
			interaction_attempted.emit("console", "insufficient_energy")
	elif player_position.distance_to(Vector2(650, 330)) < 65.0:
		if transferring:
			status_text = "Transfer still busy. R cancels a pending transfer."
			interaction_attempted.emit("dispatch", "busy")
		elif gate_open:
			interaction_attempted.emit("dispatch", "gate_already_open")
		else:
			transferring = true
			transfer_seconds = 0.0
			status_text = "Transferring... gate should open within one second."
			transfer_changed.emit("dispatch_started")
			interaction_attempted.emit("dispatch", "started")
	else:
		status_text = "Move near a console or dispatch station to interact."
		interaction_attempted.emit("interact", "no_station_in_range")


func reset_transfer() -> void:
	if transferring and _fault == "progress":
		status_text = "Reset requested: transfer remains busy."
		interaction_attempted.emit("reset", "busy")
	else:
		transferring = false
		transfer_seconds = 0.0
		status_text = "Transfer cancelled; dispatch is available."
		transfer_changed.emit("reset")
		interaction_attempted.emit("reset", "cancelled")


func _draw() -> void:
	var font := ThemeDB.fallback_font
	draw_string(font, Vector2(40, 40), "RELAY DEPOT", HORIZONTAL_ALIGNMENT_LEFT, -1, 25, Color("dce9f5"))
	draw_string(font, Vector2(40, 72), "Arrows: move   Space/Enter: interact   R: cancel transfer   Tab: timing marker   Esc: finish", HORIZONTAL_ALIGNMENT_LEFT, -1, 17)
	draw_string(font, Vector2(40, 103), "ENERGY: %d / 100     GATE: %s     MARKER: %d" % [displayed_energy, "OPEN" if gate_open else "CLOSED", marker_sequence], HORIZONTAL_ALIGNMENT_LEFT, -1, 23, Color("5ce1ce"))
	draw_string(font, Vector2(40, 132), status_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 17)
	if marker_seconds > 0.0:
		draw_rect(Rect2(0, 145, 960, 12), Color("ff55b5"))
	draw_rect(PLAY_AREA, Color("172a3a"))
	draw_rect(PLAY_AREA, Color("91abc1"), false, 3)
	draw_rect(Rect2(237, 307, 46, 46), Color("e4b65c"))
	draw_string(font, Vector2(204, 390), "CONSOLE (-20)", HORIZONTAL_ALIGNMENT_LEFT, -1, 16)
	draw_circle(Vector2(650, 330), 26, Color("e4b65c"))
	draw_string(font, Vector2(598, 390), "DISPATCH", HORIZONTAL_ALIGNMENT_LEFT, -1, 16)
	draw_line(Vector2(720, 290), Vector2(720, 420), Color("5ce1ce") if gate_open else Color("ed7b85"), 6)
	draw_circle(Vector2(830, 330), 28, Color("285c57"))
	draw_string(font, Vector2(785, 390), "DELIVERY", HORIZONTAL_ALIGNMENT_LEFT, -1, 16)
	draw_circle(player_position, RADIUS, Color("5ce1ce"))
	draw_string(font, Vector2(40, 500), "Rules: HUD mirrors energy immediately. Stay inside the outlined arena.", HORIZONTAL_ALIGNMENT_LEFT, -1, 16)
	draw_string(font, Vector2(40, 525), "Dispatch opens gate within 1 second. R cancels a pending transfer; try dispatch again.", HORIZONTAL_ALIGNMENT_LEFT, -1, 16)

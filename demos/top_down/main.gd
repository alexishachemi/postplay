extends Node2D
## A small supply-and-repair quest; observation is optional and never drives play.

signal supplies_changed(count: int)
signal repair_requested(state: String)
signal repair_cancelled(state: String)
signal gate_opened
signal arrived
signal restarted
signal timing_pulse(sequence: int)

const ART := "res://assets/Tiny Swords (Free Pack)/"
const PLAY_AREA := Rect2(62, 178, 836, 286)
const SUPPLY_POINTS := [Vector2(210, 420), Vector2(400, 260), Vector2(555, 430)]
const GATE_POINT := Vector2(704, 330)
const ARRIVAL_POINT := Vector2(818, 330)
const REPAIR_SECONDS := 4.0
const SPEED := 150.0

var player_position := Vector2(120, 330)
var inventory := 0
var displayed_inventory := 0
var gate_state := "closed"
var quest_complete := false
var collected: Array[bool] = [false, false, false]
var _fault := false
var _case := ""
var _repair_elapsed := 0.0
var _elapsed := 0.0
var _pulse_remaining := 0.0
var _pulse_sequence := 0
var _moving := false
var _facing_left := false
var _status := "Gather three timber bundles, then repair the harbor gate."
var _hud: Label
var _objective: Label
var _prompt: Label
var _player: Sprite2D
var _keeper: Sprite2D
var _bundles: Array[Sprite2D] = []
var _idle: Texture2D
var _run: Texture2D


func _ready() -> void:
	_fault = OS.get_environment("POSTPLAY_DEMO_FAULT") == "1"
	_case = OS.get_environment("POSTPLAY_DEMO_CASE")
	_configure_controls()
	_build_world()
	_build_hud()
	_observe_game()
	_update_display()


func _configure_controls() -> void:
	var bindings := {"move_left": [KEY_A, KEY_LEFT], "move_right": [KEY_D, KEY_RIGHT],
		"move_up": [KEY_W, KEY_UP], "move_down": [KEY_S, KEY_DOWN],
		"interact": [KEY_E, KEY_SPACE, KEY_ENTER], "cancel_repair": [KEY_C],
		"restart": [KEY_R], "timing_marker": [KEY_TAB]}
	for action: String in bindings:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for code: int in bindings[action]:
			var key := InputEventKey.new()
			key.physical_keycode = code
			InputMap.action_add_event(action, key)


func _observe_game() -> void:
	var observer := get_node_or_null("/root/PostPlay")
	if observer == null:
		return
	observer.watch_signal(timing_pulse, "Visible magenta timing stripe")
	observer.watch_signal(supplies_changed, "Supply inventory changed",
		"The timber counter should match inventory immediately after collection and consumption.")
	observer.watch_signal(repair_requested, "Player requested gate repair")
	observer.watch_signal(repair_cancelled, "Player attempted to cancel repair",
		"C cancels an active repair and restores the three timber bundles.")
	observer.watch_signal(restarted, "Player restarted the quest")
	observer.watch_property(self, "inventory", "Authoritative timber inventory", 100)
	observer.watch_property(self, "displayed_inventory", "Timber count displayed by HUD", 100,
		"The displayed timber count equals authoritative inventory.")
	observer.watch_property(self, "gate_state", "Harbor gate state", 100,
		"With three timber bundles, repair completes in four simulation seconds and opens the gate. C cancels while repairing; R restarts the whole quest.")
	observer.watch_progression(gate_opened, "Harbor gate opened")
	observer.watch_progression(arrived, "Warden reached harbor castle")
	observer.set_player(self, 200, "player_position", "scene_local")
	observer.set_playable_bounds(PLAY_AREA, "Walkable island, excluding the closed harbor gate", "scene_local")
	observer.set_input_actions(["move_left", "move_right", "move_up", "move_down", "interact", "cancel_repair", "restart", "timing_marker"], 50)


func _physics_process(delta: float) -> void:
	var movement := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	move_player(movement * SPEED * delta)
	advance_game(delta)
	if Input.is_action_just_pressed("interact"):
		interact()
	if Input.is_action_just_pressed("cancel_repair"):
		cancel_repair()
	if Input.is_action_just_pressed("restart"):
		reset_game()
	if Input.is_action_just_pressed("timing_marker"):
		trigger_timing_pulse()
	if Input.is_action_just_pressed("ui_cancel"):
		get_tree().quit()
	_update_display()


func move_player(displacement: Vector2) -> void:
	_moving = displacement.length_squared() > 0.001
	if absf(displacement.x) > 0.001:
		_facing_left = displacement.x < 0
	var target := player_position + displacement
	target.x = clampf(target.x, PLAY_AREA.position.x, PLAY_AREA.end.x)
	target.y = clampf(target.y, PLAY_AREA.position.y, PLAY_AREA.end.y)
	# The gate spans the island. No route around its closed barrier is allowed.
	if gate_state != "open":
		target.x = minf(target.x, 680.0)
	player_position = target
	if gate_state == "open" and player_position.distance_to(ARRIVAL_POINT) < 36 and not quest_complete:
		quest_complete = true
		_status = "Harbor restored! The warden is home. R starts a fresh journey."
		arrived.emit()


func advance_game(delta: float) -> void:
	_elapsed += delta
	_pulse_remaining = maxf(0.0, _pulse_remaining - delta)
	if gate_state == "repairing":
		_repair_elapsed += delta
		if _repair_elapsed >= REPAIR_SECONDS and not (_fault and _case == "progress"):
			gate_state = "open"
			_status = "Gate repaired. Follow the path east to the harbor castle!"
			gate_opened.emit()
	queue_redraw()


func interact() -> void:
	for index in range(SUPPLY_POINTS.size()):
		if not collected[index] and player_position.distance_to(SUPPLY_POINTS[index]) < 44:
			collected[index] = true
			inventory += 1
			_update_inventory()
			supplies_changed.emit(inventory)
			_status = "Timber secured. Collect all three bundles and repair the eastern gate."
			return
	if player_position.distance_to(GATE_POINT) < 66:
		repair_requested.emit(gate_state)
		if gate_state == "repairing":
			_status = "Repair already in progress. C cancels; R restarts the quest."
		elif gate_state == "closed" and inventory == 3:
			inventory = 0
			_update_inventory()
			supplies_changed.emit(inventory)
			gate_state = "repairing"
			_repair_elapsed = 0.0
			_status = "Repairing: four seconds. C cancels and refunds timber."
		elif gate_state == "closed":
			_status = "The harbor gate needs three timber bundles."
		_update_display()


func cancel_repair() -> void:
	repair_cancelled.emit(gate_state)
	if gate_state != "repairing":
		return
	if _fault and _case == "progress":
		_status = "Repair is busy. Try interacting again, or R to restart."
		return
	gate_state = "closed"
	inventory = 3
	_update_inventory()
	supplies_changed.emit(inventory)
	_status = "Repair cancelled. Timber returned; E starts repair again."


func _update_inventory() -> void:
	if not (_fault and _case == "hud"):
		displayed_inventory = inventory
	_update_display()


func reset_game() -> void:
	player_position = Vector2(120, 330)
	inventory = 0
	displayed_inventory = 0
	gate_state = "closed"
	quest_complete = false
	collected = [false, false, false]
	_repair_elapsed = 0
	_status = "Gather three timber bundles, then repair the harbor gate."
	restarted.emit()
	supplies_changed.emit(inventory)
	_update_display()


func trigger_timing_pulse() -> void:
	_pulse_sequence += 1
	_pulse_remaining = 0.4
	timing_pulse.emit(_pulse_sequence)
	queue_redraw()


func _sprite(path: String, point: Vector2, frame_size := Vector2.ZERO, size := 1.0) -> Sprite2D:
	var sprite := Sprite2D.new()
	sprite.texture = load(ART + path)
	sprite.position = point
	sprite.scale = Vector2.ONE * size
	if frame_size != Vector2.ZERO:
		sprite.region_enabled = true
		sprite.region_rect = Rect2(Vector2.ZERO, frame_size)
	add_child(sprite)
	return sprite


func _build_world() -> void:
	# Grass atlas uses 64px tiles, keeping original edge/corner artwork intact.
	var atlas: Texture2D = load(ART + "Terrain/Tileset/Tilemap_color1.png")
	for row in range(5):
		for column in range(14):
			var tile := Sprite2D.new()
			tile.texture = atlas
			tile.region_enabled = true
			var source_x := 0 if column == 0 else (128 if column == 13 else 64)
			var source_y := 0 if row == 0 else (128 if row == 4 else 64)
			tile.region_rect = Rect2(source_x, source_y, 64, 64)
			tile.position = Vector2(64 + column * 64, 176 + row * 64)
			tile.z_index = -10
			add_child(tile)
	_sprite("Buildings/Blue Buildings/House1.png", Vector2(180, 213), Vector2.ZERO, 0.75)
	_sprite("Buildings/Blue Buildings/Castle.png", Vector2(810, 230), Vector2.ZERO, 0.72)
	for point: Vector2 in [Vector2(90, 170), Vector2(320, 185), Vector2(560, 180), Vector2(865, 430), Vector2(345, 445)]:
		_sprite("Terrain/Resources/Wood/Trees/Tree1.png", point, Vector2(192, 256), 0.6)
	for point: Vector2 in SUPPLY_POINTS:
		var bundle := _sprite("Terrain/Resources/Wood/Wood Resource/Wood Resource.png", point, Vector2.ZERO, 1.25)
		_bundles.append(bundle)
	_idle = load(ART + "Units/Blue Units/Pawn/Pawn_Idle.png")
	_run = load(ART + "Units/Blue Units/Pawn/Pawn_Run.png")
	_player = _sprite("Units/Blue Units/Pawn/Pawn_Idle.png", player_position - Vector2(0, 20), Vector2(192, 192), 0.7)
	_player.z_index = 5
	_keeper = _sprite("Units/Blue Units/Warrior/Warrior_Idle.png", Vector2(790, 300), Vector2(192, 192), 0.65)
	_keeper.z_index = 4


func _label(point: Vector2, size: Vector2, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.position = point
	label.size = size
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	add_child(label)
	label.z_index = 20
	return label


func _build_hud() -> void:
	var title := _label(Vector2(26, 9), Vector2(370, 32), 25, Color("f4e7b4"))
	title.text = "HARBOR WARDEN"
	var subtitle := _label(Vector2(28, 43), Vector2(580, 24), 15, Color("a5c9c2"))
	subtitle.text = "A quiet island. Three supplies. One way home."
	_hud = _label(Vector2(650, 17), Vector2(290, 40), 23, Color("ffe1a0"))
	_objective = _label(Vector2(28, 87), Vector2(910, 28), 17, Color("fff0cd"))
	_prompt = _label(Vector2(28, 114), Vector2(910, 24), 15, Color("b1d7d7"))
	var help := _label(Vector2(28, 498), Vector2(920, 32), 15, Color("c9dddf"))
	help.text = "WASD / arrows: move    E / Space: interact    C: cancel repair    R: restart    Tab: sync pulse    Esc: finish"


func _update_display() -> void:
	if not is_instance_valid(_hud):
		return
	_hud.text = "TIMBER   %d / 3" % displayed_inventory
	_objective.text = _status
	var near_bundle := false
	for index in range(_bundles.size()):
		_bundles[index].visible = not collected[index]
		near_bundle = near_bundle or (not collected[index] and player_position.distance_to(SUPPLY_POINTS[index]) < 44)
	_prompt.text = "E: collect timber" if near_bundle else "Gather timber marked by golden rings. The eastern gate opens after a four-second repair."
	if player_position.distance_to(GATE_POINT) < 66:
		_prompt.text = "E: repair gate (3 timber)    C: cancel / return timber    R: restart"
	_player.position = player_position - Vector2(0, 20)
	_player.texture = _run if _moving else _idle
	var frames := 6 if _moving else 8
	_player.region_rect.position.x = (int(_elapsed * 8) % frames) * 192
	_player.flip_h = _facing_left
	_keeper.region_rect.position.x = (int(_elapsed * 6) % 8) * 192
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(0, 0, 960, 76), Color("142a35"))
	draw_rect(Rect2(0, 486, 960, 54), Color("142a35"))
	# Gentle sea glints surround, rather than replace, the supplied island art.
	for index in range(19):
		var x := float((index * 137) % 960)
		var y := 470.0 + sin(_elapsed + index) * 5
		draw_line(Vector2(x, y), Vector2(x + 22, y), Color("427a87"), 2)
	# The main dirt lane is always below environment sprites.
	draw_line(Vector2(80, 330), Vector2(875, 330), Color("b6aa70"), 34)
	draw_line(Vector2(210, 330), Vector2(210, 420), Color("b6aa70"), 24)
	draw_line(Vector2(400, 330), Vector2(400, 260), Color("b6aa70"), 24)
	draw_line(Vector2(555, 330), Vector2(555, 430), Color("b6aa70"), 24)
	for index in range(collected.size()):
		if not collected[index]:
			draw_arc(SUPPLY_POINTS[index], 28 + sin(_elapsed * 3) * 2, 0, TAU, 32, Color("ffe198"), 2)
	if gate_state != "open":
		for y in range(183, 464, 18):
			draw_rect(Rect2(696, y, 13, 15), Color("73502d"))
		draw_line(Vector2(702, 180), Vector2(702, 463), Color("d4b577"), 4)
		if gate_state == "repairing":
			draw_rect(Rect2(648, 280, 110, 12), Color("263944"))
			draw_rect(Rect2(650, 282, minf(_repair_elapsed / REPAIR_SECONDS, 1) * 106, 8), Color("ffcf73"))
	if quest_complete:
		draw_arc(ARRIVAL_POINT, 42, 0, TAU, 40, Color("ffe198"), 4)
	if _pulse_remaining > 0:
		draw_rect(Rect2(0, 76, 960, 8), Color("ff55d9"))

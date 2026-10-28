extends SceneTree
## Synthetic game object has no PostPlay dependency or special emitters.

const Collector = preload("res://addons/postplay/collector.gd")

class GameObject extends Node2D:
	signal damaged(amount, details)
	signal ping
	signal eight(a, b, c, d, e, f, g, h)
	signal nine(a, b, c, d, e, f, g, h, i)
	var health := 100
	var inventory := {"count": 1}
	var unsupported: Variant = null
	var normal_callbacks := 0


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var mode := args[1]
	var game := GameObject.new()
	game.name = "Player"
	root.add_child(game)
	current_scene = game
	game.damaged.connect(func(_amount, _details): game.normal_callbacks += 1)
	var capture := Collector.new()
	root.add_child(capture)
	assert(capture.watch_signal(game.ping, "before start").is_empty())
	assert(capture.start_session(args[0], {"id": "fixture", "name": "Watch fixture", "scene": "main.tscn"}) == OK)
	capture.set_process(false)
	var ids := {}
	if mode == "basic":
		ids.signal = capture.watch_signal(game.damaged, "Damage amount and game context", "HUD should reflect current health")
		ids.health = capture.watch_property(game, "health", "Authoritative health", 50)
		ids.inventory = capture.watch_property(game, "inventory", "Inventory", 50)
		ids.x = capture.watch_property(game, "position:x", "Horizontal position", 50)
		var hud := ProgressBar.new()
		hud.name = "HUD"
		game.add_child(hud)
		ids.hud = capture.watch_property(hud, "value", "Displayed health", 100)
		for id in ids.values():
			assert(not id.is_empty())
		assert(capture.watch_signal(game.damaged, "Duplicate ignored") == ids.signal)
		assert(capture.watch_property(game, "health", "Duplicate ignored", 500) == ids.health)
		game.health = 80
		game.inventory.count = 2
		game.position.x = 12
		hud.value = 80
		game.damaged.emit(20, {"remaining": 80})
		assert(game.normal_callbacks == 1)
		capture._process(0.025)
		capture._process(0.025)
		capture._process(0.050)
		capture._process(0.500) # Unchanged values produce no repeated observation.
		game.name = "Renamed"
		var holder := Node.new()
		game.add_child(holder)
		hud.reparent(holder)
		hud.value = 70
		capture._process(0.1)
		game.damaged.emit(0, "still the same source")
		assert(capture.unwatch(ids.signal))
		assert(not capture.unwatch(ids.signal))
		game.damaged.emit(0, null)
		assert(game.normal_callbacks == 3)
		assert(game.damaged.get_connections().size() == 1)
	elif mode == "lifetime":
		var object := RefCounted.new()
		game.unsupported = object
		ids.object = capture.watch_property(game, "unsupported", "Unsupported object", 50)
		ids.nested = capture.watch_property(game, "inventory:count", "Nested count", 50)
		ids.signal = capture.watch_signal(game.damaged, "Existing signal")
		game.damaged.emit(object, INF)
		game.unsupported = null
		object = null
		capture._process(0.05)
		var dead := Node.new()
		game.unsupported = dead
		dead.free()
		capture._process(0.05)
		game.inventory.erase("count") # Invalidated path is removed safely.
		capture._process(0.05)
		assert(not capture.unwatch(ids.nested))
		game.free()
		capture._process(0.1)
		assert(not capture.unwatch(ids.signal))
	elif mode == "arity":
		ids.zero = capture.watch_signal(game.ping, "Zero arguments")
		ids.eight = capture.watch_signal(game.eight, "Eight arguments")
		assert(not ids.zero.is_empty() and not ids.eight.is_empty())
		assert(capture.watch_signal(game.nine, "Too many arguments").is_empty())
		game.ping.emit()
		game.eight.emit(0, 1, 2, 3, 4, 5, 6, 7)
	elif mode in ["abort", "free"]:
		assert(not capture.watch_signal(game.ping, "Cleanup").is_empty())
		game.ping.emit()
	elif mode == "invalid":
		assert(capture.watch_signal(Signal(), "Missing").is_empty())
		assert(capture.watch_signal(game.ping, "x".repeat(1025)).is_empty())
		for path in ["missing", "../health", "health/secret", "position:nope", "health:x", "inventory:missing", "", ":health"]:
			assert(capture.watch_property(game, path, "Invalid path").is_empty())
		assert(capture.watch_property(game, "health", "Too frequent", 49).is_empty())
		assert(capture.watch_property(game, "health", "Too slow", 60001).is_empty())
		var freed := GameObject.new()
		var freed_signal := freed.ping
		freed.free()
		assert(capture.watch_property(freed, "health", "Freed").is_empty())
		assert(capture.watch_signal(freed_signal, "Freed signal").is_empty())
		assert(capture.watch_property(42, "health", "Not an object").is_empty())
	elif mode == "cap":
		for index in range(128):
			var transient := GameObject.new()
			transient.name = "Transient"
			assert(not capture.watch_property(transient, "health", "Health", 50).is_empty())
			assert(capture.unwatch("reg-%d" % (index + 1)))
			transient.free()
		assert(capture.watch_signal(game.ping, "Over cap").is_empty())
	elif mode == "log_cap":
		assert(not capture.watch_signal(game.ping, "Signal cap cleanup").is_empty())
		for index in range(capture.MAX_EVENTS - 1):
			game.ping.emit()
		game.ping.emit()
		assert(game.ping.get_connections().is_empty())
		assert(capture.watch_signal(game.ping, "After truncation").is_empty())
		assert(capture.seal_for_finalization() == ERR_OUT_OF_MEMORY)
	elif mode == "io":
		assert(DirAccess.make_dir_absolute(capture.session_directory.path_join("session.json.pending")) == OK)
		assert(capture.watch_signal(game.ping, "Cannot persist").is_empty())
		assert(game.ping.get_connections().is_empty())
		assert(capture.watch_property(game, "health", "Cannot persist").is_empty())
		game.ping.emit()
		assert(capture.seal_for_finalization() != OK)
	else:
		assert(false, "Unknown mode")
	var directory: String = capture.session_directory
	if mode == "free":
		capture.free()
	elif mode == "abort":
		assert(capture.abort_session() == OK)
	elif mode not in ["io", "log_cap"]:
		assert(capture.seal_for_finalization() == OK)
	if is_instance_valid(game):
		assert(game.ping.get_connections().is_empty())
		assert(game.eight.get_connections().is_empty())
		assert(game.damaged.get_connections().size() == 1)
		if mode != "free":
			assert(capture.watch_signal(game.ping, "After close").is_empty())
		game.free()
	print("POSTPLAY_WATCHER_RESULT " + JSON.stringify({"directory": directory, "ids": ids}))
	if mode != "free":
		capture.free()
	quit(0)

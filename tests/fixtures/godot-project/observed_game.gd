extends "res://game.gd"
## Optional integration only; emitters and gameplay logic remain unchanged.


func _ready() -> void:
	var postplay := get_node_or_null("/root/PostPlay")
	if postplay != null:
		postplay.watch_signal(health_changed, "Remaining health after a change")
		postplay.watch_property(self, "health", "Authoritative health", 100)

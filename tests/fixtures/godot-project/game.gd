extends Node2D
## Deterministic integration fixture, not a playtest or gameplay agent.
## Existing gameplay state/signal have no dependency on the addon.

signal health_changed(remaining: int)

var health: int = 10
var _elapsed := 0.0


func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed >= 0.5 and health == 10:
		health = 9
		health_changed.emit(health)
		queue_redraw()
	if _elapsed >= 3.0:
		get_tree().quit()


func _draw() -> void:
	draw_rect(Rect2(40, 90, health * 35, 80), Color("54e6cf"))

extends CharacterBody2D
## Ordinary platformer controller; no recorder dependencies.

signal jumped

const SPEED := 255.0
const GRAVITY := 1250.0
const JUMP_SPEED := -555.0
var sprite: AnimatedSprite2D
var enabled := true
var _coyote := 0.0
var _jump_buffer := 0.0

func _ready() -> void:
	var shape := CollisionShape2D.new()
	var capsule := CapsuleShape2D.new()
	capsule.radius = 12.0
	capsule.height = 38.0
	shape.shape = capsule
	shape.position.y = -19.0
	add_child(shape)
	sprite = AnimatedSprite2D.new()
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	# The rogue occupies a transparent 32px cell; align its boots to body feet.
	sprite.position = Vector2(0, -24)
	sprite.scale = Vector2(3, 3)
	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	var sheet: Texture2D = load("res://assets/character-rogue.png")
	for animation in ["idle", "run"]:
		frames.add_animation(animation)
		frames.set_animation_speed(animation, 9.0)
		var row := 32 if animation == "run" else 0
		var count := 4 if animation == "run" else 3
		for index in range(count):
			var texture := AtlasTexture.new()
			texture.atlas = sheet
			texture.region = Rect2(index * 32, row, 32, 32)
			frames.add_frame(animation, texture)
	sprite.sprite_frames = frames
	add_child(sprite)
	sprite.play("idle")
	add_to_group("player")

func _physics_process(delta: float) -> void:
	if not enabled:
		velocity = Vector2.ZERO
		return
	_coyote = 0.10 if is_on_floor() else maxf(0.0, _coyote - delta)
	_jump_buffer = maxf(0.0, _jump_buffer - delta)
	if Input.is_action_just_pressed("ui_accept") or Input.is_action_just_pressed("ui_up"):
		_jump_buffer = 0.12
	if _jump_buffer > 0.0 and _coyote > 0.0:
		velocity.y = JUMP_SPEED
		_jump_buffer = 0.0
		_coyote = 0.0
		jumped.emit()
	velocity.x = Input.get_axis("ui_left", "ui_right") * SPEED
	velocity.y = minf(velocity.y + GRAVITY * delta, 800.0)
	move_and_slide()
	if absf(velocity.x) > 1.0:
		sprite.flip_h = velocity.x < 0.0
		sprite.play("run")
	else:
		sprite.play("idle")

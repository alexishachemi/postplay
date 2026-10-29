# Runtime capture lifecycle

M1.2 provides `demo/addons/postplay/collector.gd`, a runtime-only Node. It does
not scan the scene, collect keyboard text, start Movie Maker or call a model.
M1.3 adds existing-signal and property watches through `watchers.gd`.
M1.4 adds selected action states and optional player/bounds/progression context.
M1.5 installs the public PostPlay autoload and [editor capture workflow](editor-capture.md).
`just record` still uses the separate M0 smoke probe, not this writer.

## Minimal usage

Run this from a Node already in the scene tree:

```gdscript
const Collector = preload("res://addons/postplay/collector.gd")
var capture := Collector.new()

func _ready() -> void:
    add_child(capture)
    var error := capture.start_session("user://postplay/sessions", {
        "id": "my-game", "name": "My Game", "scene": "main.tscn"
    }, {"fps": 30, "width": 960, "height": 540, "collision_debug": false})
    if error != OK:
        push_error("Capture could not start: " + error_string(error))
        return
    capture.append_event("annotation", "checkpoint_reached", {"checkpoint": 2})
    # When runtime observation ends, leave the recording for a media finalizer:
    error = capture.seal_for_finalization()
    # Alternatively, abort_session() explicitly cancels with status incomplete.
```

`start_session(root, project, capture = {}, requested_id = "")` returns a Godot
`Error`. Root must resolve to an absolute writable directory (`user://` is fine).
Project requires exactly `id`, `name`, and a relative `scene` without `res://`.
Optional capture keys are `mode` (default `movie_maker`), `format` (`avi`), `fps`
(30), `width` (960), `height` (540), `collision_debug` (current SceneTree debug
collision hint). An explicit collision flag still overrides this default for the
launch orchestrator; it must describe the actual run. Supply actual
recording settings; these defaults are not engine auto-detection. External mode
requires MP4. Invalid configuration is rejected before creating a session.

A requested ID must be a canonical UUID v4; otherwise a cryptographic random UUID
is generated. The UUID leaf directory must be newly created; collisions fail and
older files are never opened. Each collector owns only one session. Inspect
`session_directory` for its path. Only a trusted local caller chooses the output
root; this is not an ingestion API for untrusted paths.

`append_event(kind, label, payload = null)` returns an `Error`. It writes an
unregistered observation from `src-1` (PostPlay runtime) using the bounded
[safe-value encoder](../contracts/README.md). Labels must contain 1–256 characters;
kinds are those in the raw event schema. The watch APIs below attach game
sources/registrations rather than pretending runtime observations came from them.
Successful appends consume contiguous IDs and flush immediately. Invalid calls
consume no ID. Stop appending on any non-OK result. `last_error` retains the most
recent filesystem result; methods also return their own state/argument errors.

## Existing signals and selected properties

After a successful start, register the game's existing signal/property directly:

```gdscript
var damage_watch := capture.watch_signal(
    player.damaged, "Damage amount and remaining health",
    "Displayed health should reflect authoritative health after damage")
var health_watch := capture.watch_property(
    player, "health", "Authoritative health", 100)
var hud_watch := capture.watch_property(
    health_bar, "value", "Displayed health", 100)
# Later, optionally stop one observer (its historical evidence is retained):
capture.unwatch(health_watch)
```

No emitter changes or PostPlay-specific gameplay signals are needed. These are
methods on the collector instance, also exposed by the installed `PostPlay` autoload.

- `watch_signal(existing_signal, description, expected_behavior = "")` returns
  a `reg-N` ID, or `""` on failure. Supports declared signatures of 0–8 arguments,
  preserving order and actual null values without padding. Larger signatures
  are rejected, never silently cut down. It observes every emission until removed
  or a global capture limit/error stops observation.
- `watch_property(object, property_path, description, interval_ms = 100,
  expected_behavior = "")` returns an ID, or `""` on failure. It records an initial
  value, then only changed safe-value snapshots at the requested simulation-time
  interval. Allowed intervals are 50–60,000 ms, at most one poll per process frame;
  long frames do not trigger catch-up bursts. Normal pause behavior applies.
- `unwatch(registration_id)` returns true if a live watch was removed, false if
  absent. Historical manifest registrations and events are never deleted/reused.

Repeated live watches of the same object/signal or object/property return the
original ID, without a second callback, initial event or configuration change.
The first description/interval/expectation wins. Unwatch and register anew to
change configuration (consumes another historical registration slot).

Descriptions and expectations are bounded to 1,024 characters each; empty
expectation is stored as null. Expectations are **developer-provided context**,
not proof that a bug happened. There are at most 128 historical registrations
and 128 allocated observed-object identities per session; all raw event/log
budgets still apply. Failed persistence never connects a new signal or emits
an event referencing an unsaved registration.

Property paths are explicit colon-separated identifiers, e.g. `health`,
`position:x`, `inventory:count`, `material:roughness`. Maximum 256 characters,
six segments, ASCII identifier segments of 1–128 characters. Object properties,
dictionary keys and Vector2/Vector3 components are supported; scene-tree paths,
array indices, arbitrary expressions and other indexed value types are rejected.
Paths are checked before reading, not guessed by treating null as missing. A
freed object or invalidated intermediate path removes the watch safely. Selected
object getters execute normally: watch inexpensive, side-effect-free properties.
Do not register credentials, text-entry fields or other secret-bearing values.

Each event references a saved registration and a frozen session-local source
snapshot. Objects are weakly referenced, never kept alive by observation. Node
name and scene-relative path (when safely available) are captured once; rename,
reparent or later freeing does not rewrite prior identity. Other objects use a
generic label and null path. Internal instance IDs are not serialized or reused
as evidence identity. No scene scan is performed. Call these APIs and emit watched
signals on the main thread; the file writer is not a threaded telemetry service.

Signal payloads are safe dictionaries with `signal` and ordered `arguments`;
property payloads have `property`, `phase` (`initial`/`change`) and `value`.
Unsupported values become explicit markers using the existing safe serializer.
Comparison uses bounded encoded snapshots, so in-place dictionary/array mutation
is observable; two unsupported/oversized raw values with the same marker are
indistinguishable. Transitions between polls may be missed. A registration does
not promise exhaustive state history or frame-perfect timing.

Stopping, aborting, leaving the tree, hitting capture limits or an event write
failure disconnects owned signal callbacks and clears live watches. Existing
game callbacks are left untouched. Metadata remains for offline evidence.

## Selected actions and input privacy

Without annotations, a session polls the existing `ui_left`, `ui_right`, `ui_up`,
`ui_down`, `ui_accept`, `ui_cancel` actions every 50 simulation ms. Missing default
actions are skipped. `capture_started.payload.input_policy` records the actual
selected names, interval and best-effort limitations. No player discovery or
scene scan is performed.

`set_input_actions(actions, interval_ms = 50)` selects up to 32 unique, existing
InputMap action names (ASCII identifiers/slashes/hyphens, 1–128 characters), at
50–60,000-ms intervals. Returns a Godot Error; invalid configuration leaves the
old selection intact. Successful configuration emits `input_configuration`.
Pass `[]` to disable input observation. At most one polling batch runs per process
frame, without catch-up bursts. Only changed boolean states are saved as `input`
events labeled `action_state`, payload `{action, pressed}`, registration null.
An action held when capture begins may first appear as pressed; this is not a
claim that its press occurred at that instant.

The observer never reads raw key codes, Unicode, text contents, mouse coordinates
or event-object dumps. While a built-in LineEdit/TextEdit (including subclasses)
owns focus in the collector's viewport, **all** selected action polling is
suppressed and cached states are discarded. The next eligible poll records
`input_coverage` with `resumed_after_text_focus`, then resumes state observation.
Do not treat missing releases during the gap as held gameplay inputs. Other
viewports/custom text widgets need explicit disabling via `set_input_actions([])`;
do not configure actions whose names or meaning encode secret input.

Polling sees Godot's global action state, not proof that the game handled an
input. It does not consume events or interfere with existing gameplay handlers.
Fast press/release pairs between polls, final quit inputs and keyboard ghosting
may be missed. A sample after text focus is not a reconstruction of the omitted
interval. No analog strength, typing history or exhaustive input replay is claimed.

## Optional player, bounds and progression context

```gdscript
var player_watch := capture.set_player(player, 100) # global_position, world space
var bounds_ref := capture.set_playable_bounds(
    Rect2(0, 0, 960, 540), "Declared playable rectangle", "world")
var progress_watch := capture.watch_progression(
    door.opened, "Door opening observed", "Opening the door should permit progress")
```

- `set_player(target, interval_ms = 100, property_path = "global_position",
  coordinate_space = "world")` returns a player registration ID or `""`. It
  requires an in-tree Node with an existing Vector2/Vector3 property, using the
  same explicit paths, intervals, weak identity and cleanup as property watches. Emits an initial
  `position` event and periodic samples **including unchanged positions**. Payload:
  `property`, `phase` (`initial`/`sample`), `position`, `coordinate_space`.
  Existing live target/path registrations are reused; the first configuration
  wins. Use `unwatch` to stop. Invalidated, detached or freed targets are removed
  safely rather than querying an invalid world transform.
- `set_playable_bounds(rect_or_aabb, description = "Declared playable region",
  coordinate_space = "world")` returns a bounds registration ID or `""`. Accepts
  positive-size finite Rect2/AABB within safe numeric bounds, normalizes position
  and size to Vector2/Vector3, and emits `annotation` / `playable_bounds`. Each
  successful declaration is a new historical registration, allowing later bounds
  updates without rewriting evidence. It does not scan colliders or infer a region.
- `watch_progression(existing_signal, description, expected_behavior = "")`
  returns a progression registration ID or `""`. It preserves the existing signal
  and ordered arguments, subject to the same 0–8-argument/duplicate/unwatch rules
  as `watch_signal`. Events have kind `progression`, not an inferred success/failure.

Coordinate-space labels are `world`, `local` or `scene_local`. The caller must
declare the correct frame and use comparable player/bounds coordinates; no camera
or transform conversion is guessed. For this demo's custom drawn player, use
`set_player(scene, 100, "player_position", "scene_local")` and the scene's PLAY_AREA
with `scene_local` bounds. No gameplay changes or PostPlay-specific emitters are
needed. Stationary samples provide context but **never prove a softlock**.
Non-finite/unsupported sampled position values retain safe-value markers, not
fabricated coordinates.

Semantic context is developer-supplied, not ground truth or findings. Never pass
bug-mode flags, evaluation answers or hidden scenario labels into these APIs.
No automatic out-of-bounds/softlock classification is implemented. All registrations
share the existing 128-entry history and global telemetry budgets; metadata is
persisted before referenced events. Default action capture works with none of
these optional annotations.

## Lifecycle and clocks

Initial `session.json` is written before the event log is opened. It declares
`recording`, UTC start, configured capture/debug metadata, reserved relative media
path `recording.<format>`, and unknown duration/synchronization. No video file is
created or its existence claimed by the collector.

- `checkpoint()` flushes events and replaces the manifest with the current count.
  Automatic checkpoints run after each accumulated second of process delta.
- `seal_for_finalization()` appends `runtime_stopped`, checkpoints and closes the
  log. Status stays `recording`, awaiting the editor finalizer that checks the
  finished media and measured duration before declaring `complete`.
- `abort_session()` appends `capture_aborted`, writes terminal `incomplete` and
  UTC end, and closes the log. It preserves all original media/telemetry. If UTC
  moved backwards, end is clamped to start to preserve contract ordering.
- Leaving the tree seals automatically. A SIGKILL cannot execute that hook; the
  flushed log survives where possible and the manifest remains unfinalized.
- Further appends/close calls return `ERR_UNCONFIGURED`. Reusing a collector to
  start another session returns `ERR_ALREADY_IN_USE`.

Wall elapsed time uses monotonic ticks; simulation time accumulates `_process`
delta while this Node processes (inherits normal pause behavior). Process and
physics fields use their independent engine counters, not counters reset at
capture start. An event can precede the first process tick and have simulation
time zero. None of these fields is an encoded video time; visual alignment is
still M1.6. Keep the collector alive/in-tree for the observation duration.

## Limits, errors and recovery

Logs stop at 10,000 events or 16 MiB, with 16 KiB lines and bounded safe payloads.
Reaching a limit marks `telemetry.truncated`, returns `ERR_OUT_OF_MEMORY`, and
prevents later appends (including a stop event). Closing still checkpoints and
preserves the capture's actual status; a missing stop event is not fabricated.

Manifests use a flushed `session.json.pending` followed by same-directory rename.
On Linux, readers see the previous or new complete manifest, not a partially
overwritten one. File flushing uses Godot's [FileAccess API](https://docs.godotengine.org/en/4.7/classes/class_fileaccess.html#class-fileaccess-method-flush);
this is best-effort crash recovery, not a power-loss/fsync guarantee. Disk-full,
permissions or process termination during a write may still leave a broken tail,
a pending manifest, an empty directory or a missing log. Methods return filesystem
errors; automatic checkpoint errors remain available through `last_error`.

Never interpret `recording` as a successful clean capture. A count lag is a
diagnostic accepted only for unfinished packages; malformed/truncated JSONL is a
validation error, not a clean result. Preserve originals and pending files when
recovering; inspect and validate copies rather than silently dropping tails or
promoting status. A failed abort checkpoint may leave disk status `recording`;
the non-OK return means finalization failed even if the abort event was flushed.

## Verification

`nix develop -c just capture-test` launches actual headless Godot subprocesses and
validates their packages in Node. It tests distinct runs/UUIDs, non-overwrite,
safe values and clocks, tree exit, explicit abort, count/byte limits, blocked
manifest replacement and SIGKILL. Synthetic outputs remain under
`/tmp/postplay-collector-fixture-*` for inspection; these contain no real video
and demonstrate neither synchronization nor live model inference.

`nix develop -c just watch-test` runs actual Godot emissions and property reads,
validated as portable packages by Node. It covers duplicate/unwatch behavior,
unchanged/change sampling, null/unsupported values, weak targets, invalidated paths,
source identity after rename/reparent, 0/8-argument signals, registration/log caps,
and failed manifest writes. Synthetic outputs use `postplay-watch-fixture-*` in
the process temporary directory (which may be Nix's temporary shell directory).

`nix develop -c just observation-test` runs the actual smoke scene's controls and
movement in deterministic fixtures, validates its input/position/bounds/progression
records, and checks the no-annotation path, text-focus suppression, custom action
rates/disable, 3D positions, freed players, invalid context, metadata failure and
global cap cleanup. Fixtures are not real human recordings, timing measurements
or model evaluation. Outputs use `postplay-observation-fixture-*` under the
process temporary directory.

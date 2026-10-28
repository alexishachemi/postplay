# Runtime capture lifecycle

M1.2 provides `demo/addons/postplay/collector.gd`, a runtime-only Node. It does
not scan the scene, collect keyboard text, start Movie Maker or call a model.
Editor/autoload installation and media finalization remain M1.5; watches and
input/position observation remain M1.3–M1.4. `just record` still uses the separate
M0 smoke probe, not this writer.

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
(30), `width` (960), `height` (540), `collision_debug` (false). Supply actual
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
kinds are those in the raw event schema. Future watch APIs will attach game
sources/registrations rather than pretending runtime observations came from them.
Successful appends consume contiguous IDs and flush immediately. Invalid calls
consume no ID. Stop appending on any non-OK result. `last_error` retains the most
recent filesystem result; methods also return their own state/argument errors.

## Lifecycle and clocks

Initial `session.json` is written before the event log is opened. It declares
`recording`, UTC start, configured capture/debug metadata, reserved relative media
path `recording.<format>`, and unknown duration/synchronization. No video file is
created or its existence claimed by the collector.

- `checkpoint()` flushes events and replaces the manifest with the current count.
  Automatic checkpoints run after each accumulated second of process delta.
- `seal_for_finalization()` appends `runtime_stopped`, checkpoints and closes the
  log. Status stays `recording`, awaiting an editor finalizer that checks the
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

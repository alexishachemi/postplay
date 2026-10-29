# Record a portable session from Godot

For a different game, first follow the [copy/enable installation guide](addon-integration.md).
The instructions below start with the already-enabled repository demo.

Use the pinned development shell so the editor inherits Godot, FFmpeg and FFprobe:

```sh
nix develop -c just editor
```

The demo enables PostPlay and its public `PostPlay` autoload. The toolbar contains
**Record Session** and **Stop PostPlay**. Save/configure a main scene, stop any
existing run, then click Record Session. Recording currently supports one local
run at a time, 30 fps AVI through Godot Movie Maker. Multiple Run Instances must
be disabled. No analysis or remote request occurs during recording.

The absolute output path appears in the editor Output panel and the status tooltip.
Default storage is `user://postplay/sessions` in Godot's writable application data
directory. To choose another root, add a String project setting
`postplay/output_directory` using Project Settings (Advanced); for this demo,
`res://../recordings` puts UUID-named packages in the repository's ignored
`recordings/` directory. Each capture reserves a fresh directory before launching
Movie Maker. Existing sessions are never chosen as a new output destination.

## Stop and inspect

Play the demo normally, then use Stop PostPlay. It requests runtime shutdown and
lets the engine finish Movie Maker before checking the video. The demo's Escape
action also quits normally. Wait for the editor status to report complete or an
explicit failure before starting another session.

An original `recording.avi`, `session.json` and `events.jsonl` form the portable
capture. Finalization requires an orderly runtime close, coherent event IDs/count,
a positive probed video duration, expected frame rate and a full video decode.
The manifest records measured dimensions/duration. FFmpeg/FFprobe errors, missing
media, malformed telemetry or interrupted runtime closure are not clean successes.
Original media/telemetry are preserved even on failure; a malformed tail remains
an error, not an automatically repaired log. Finalization runs in a background
thread, with capture controls unavailable until it finishes.

Movie filename, Movie Writer fps and additional launch arguments are **not rewritten**:
per-run launch arguments select the unique AVI and fixed fps. The previous Movie
Maker toggle is restored after the run, including failure paths. If Movie Maker
was already enabled beforehand, it will still be enabled afterwards; normal Godot
runs will retain that owner's original behavior. PostPlay's runtime autoload is
inactive on ordinary runs and creates no session files.

Native Godot Stop/F8 may kill a game before its movie/telemetry are finalized. Use
Stop PostPlay for normal completion. If the graceful stop has not finished after
five seconds, its button offers **Force Stop (incomplete)**. A failed stop-request
write is shown explicitly; a force/native stop preserves partial output and does
not fabricate an orderly-close marker. A paused game can still receive the stop
request because the runtime stop poll uses always-process mode; its simulation
clock does not advance while paused.

## Annotations are optional

Basic sessions record selected action states without scene scanning or custom
hooks. The installed `PostPlay` autoload exposes the existing
[runtime API](capture-runtime.md), for example in this demo's `_ready()`:

```gdscript
PostPlay.watch_signal(beacon_activated, "Beacon activation count")
PostPlay.set_player(self, 100, "player_position", "scene_local")
PostPlay.set_playable_bounds(PLAY_AREA, "Declared playable rectangle", "scene_local")
```

These are optional public observations, not a dependency on addon internals.
Calls on ordinary non-recording runs return inactive/failure results. Do not log
secret fields, ground-truth bug toggles or evaluation answers. The current demo
does not install these annotations automatically; its original M0 smoke probe is
unchanged. `just record` still invokes that explicitly separate legacy smoke
workflow; use the editor toolbar for portable v1 packages.

## Lifecycle and recovery boundaries

The plugin adds its own autoload when enabled and removes it when disabled. A
different existing autoload called PostPlay is never replaced; recording is
disabled until that naming conflict is resolved. Godot may store autoload/main
scene paths as UIDs; the plugin resolves those without serializing URI paths into
the portable manifest.

Each launch has local-only coordination files: `launch.json`, `runtime.claim/`,
`runtime.ready.json`, `runtime.closed.json`, and optionally `stop.request.json`.
They coordinate single-use runtime startup, process lifetime and orderly stopping;
they are not model context. Do not invoke the internal `--postplay-session` option
manually or reuse it to resume old movies. Normal `start_session` still refuses
an existing UUID directory, and a reserved session can be claimed only once.

Before altering the editor toggle, `.godot/postplay-editor.json` checkpoints its
previous state. On startup, an interrupted journal restores that state and points
to the preserved capture for inspection; it does not guess that an orphaned movie
completed. Closing/disabling the plugin during recording requests stop and restores
the toggle, but leaves the package unfinalized if the editor cannot observe its
completion. Do not promote it manually just because a file exists. Linux process
presence checks are conservative (PID reuse can delay finalization rather than
declare success for a still-running process). Recovery is not a power-loss guarantee.

The finalizer handles this addon's own local capture packages. Safe general import
and full untrusted runtime-data validation remain M2.1; a complete status does not
replace import validation. Synchronization remains **unknown** until a visible
event is measured in that specific recording. Follow the
[measurement guide](synchronization.md) to preview/apply an anchor and error
estimate. Clocks must not be equated just because the movie is fixed-fps.

## Verification and remaining human check

`nix develop -c just workflow-test` runs headless deterministic reservation/claim,
fixture-media completion, missing/bad media, fps mismatch, corrupt telemetry,
terminal-state preservation and still-running-process guards. Those media fixtures
are generated by FFmpeg, not human gameplay.

`nix develop -c just editor-capture-test` explicitly opens temporary editor/game
windows in a disposable project copy under ignored `artifacts/editor capture-*`.
It exercises two real Movie Maker captures, graceful stopping, nondefault-setting
preservation, normal run, failed stop/launch, forced interruption, plugin disable/
enable and journal recovery. Native output and packages are checked by Node's v1
validators and FFprobe. This is separate from `just check`; it requires a display.

The supplied Godot FHS package can emit missing-libdecor and Wayland protocol
warnings on this host; observed clips still decoded correctly. The original
package has not been rewritten. Human input responsiveness, editor appearance
and M1's full capture/synchronization exit gate still require owner verification.

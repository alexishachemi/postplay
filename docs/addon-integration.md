# Install PostPlay in your Godot project

## Prerequisites

- Linux and the Godot **editor**. Verified with the repository's pinned Godot
  **4.7.2**; compatibility with other Godot 4.x versions is not yet tested.
- `ffmpeg` and `ffprobe` available on the editor's inherited `PATH`. Finalization
  uses both; launching Godot from a desktop shortcut may have a different PATH.
- A writable project, a saved main scene, a display for Movie Maker, and enough
  writable storage for the original AVI plus telemetry. Close any running game
  and disable Godot's Multiple Run Instances for PostPlay capture.

The addon itself does not require Node, npm, the dashboard, an API key or network
access. Nix is a reproducible way to supply the tools, not a runtime requirement
inside your game. A separately installed Godot/FFmpeg setup is possible but has
not been independently verified here.

## Copy and enable

1. Copy the **entire** repository directory `demo/addons/postplay/`, including
   its `.gd`, `.gd.uid` and `plugin.cfg` files, into your game's
   `addons/postplay/`. Keep that exact directory name; the addon uses conventional
   `res://addons/postplay/` resource paths. Do not copy the demo project, test
   drivers, `.godot/`, recordings, `ai/` or the web application. If that destination
   already contains another version, back it up before deliberately replacing
   it; do not accidentally nest/merge addon directories.
2. Open your own project with the required tools on PATH. From this repository:

   ```sh
   nix develop -c godot --editor --path '/absolute/path/to/your-game'
   ```

3. In **Project → Project Settings → Plugins**, enable **PostPlay**. It installs
   the `PostPlay` autoload and shows **Record Session** / **Stop PostPlay** in the
   toolbar. No manual autoload setup is needed. A pre-existing, unrelated autoload
   named PostPlay is a conflict: it is never overwritten. Resolve that name
   conflict before recording.
4. Set/save your game's main scene. Optionally add the String project setting
   `postplay/output_directory` in Project Settings (Advanced), pointing to a
   writable absolute directory or `user://` / `res://` directory. Default:
   `user://postplay/sessions`. The editor prints the resolved session directory.

No packaging archive is needed. The optional addon ZIP/Nix package is not
implemented; copying the source folder is the tested installation method.

## First capture: no annotations

Click **Record Session**, play, then **Stop PostPlay**. A normal game-controlled
`get_tree().quit()` also closes gracefully. Wait for finalization before starting
another capture. Native Stop/F8 can forcibly terminate the game and leave an
incomplete session; it is not the normal finalization path.

The addon launches one **30 fps AVI** Movie Maker recording and writes a unique
UUID session containing `session.json`, `events.jsonl` and `recording.avi`.
FFprobe metadata and full video decode must pass before the editor reports
complete. A second recording gets a different directory. Prior movie path/fps
and launch arguments are not rewritten; the previous Movie Maker toggle is
restored. If that toggle was originally enabled, it remains enabled afterward.
See [recording and recovery](editor-capture.md) for forced-stop/error behavior.

Without hooks you get lifecycle events and **best-effort changed action states**
for `ui_left`, `ui_right`, `ui_up`, `ui_down`, `ui_accept`, `ui_cancel`. They are
polled at 50 ms simulation intervals; short taps can be missed. Built-in text
entry focus suppresses this observation. Raw keys and typed text are not recorded.
Custom action names require explicit `set_input_actions(...)`; for sensitive
custom UI/viewports, disable action capture with `set_input_actions([])`.
Nothing scans your scene, automatically identifies a player or infers game state.
A quiet no-hook session may have only lifecycle/policy events and **zero
registrations**. That is a valid basic capture, not proof of adequate bug evidence.

New sessions stay **synchronization unknown** until a visible interaction is
measured in that exact recording. Follow [the timing guide](synchronization.md);
`complete` means media finalized, not synchronized or analyzed. Check your own
camera/framing in the movie. For fixed logical 2D layouts, a configured viewport
size with stretch mode `viewport` and aspect `keep` avoided the smoke scene's
earlier crop; PostPlay does not change your game's viewport or camera settings.

## Then add optional existing-signal/property watches

Leave your game's signal declaration and emitters unchanged. In the Node that
already owns an existing `health_changed(remaining)` signal and `health` property:

```gdscript
func _ready() -> void:
    var postplay := get_node_or_null("/root/PostPlay")
    if postplay != null:
        postplay.watch_signal(health_changed, "Remaining health after a change")
        postplay.watch_property(self, "health", "Authoritative health", 100)
```

This exact optional integration is exercised in the independent fixture. The
node lookup makes the game safe to run even if you later disable/remove PostPlay;
direct `PostPlay.watch_signal(...)` also works while its autoload is installed.
Do not add a second collector or call `start_session`/finalization yourself when
using editor recording: the autoload already owns that lifecycle. Ordinary F6/F5
runs leave it inactive; watch calls return `""`, not an active registration.

Signal watches preserve up to eight declared arguments, without modifying the
emitter. Property watches capture an initial value then changed snapshots at
the interval (50–60,000 ms, no catch-up bursts). Successful calls return a
`reg-N` ID; `""` means inactive or rejected. Use `unwatch(id)` to stop a watch.
Freed sources are handled safely. Weak source snapshots, value/size limits and
unsupported-value markers are explained in the [runtime API](capture-runtime.md).
No typed/private data, bug toggles or hidden evaluation answers belong in watches.
Developer expectation text is optional context, not an automatic finding.

Record again, change the property/emit the existing signal, stop and inspect:
the manifest now has registrations, the log has `signal` events with original
arguments and `property` events with initial/changed values. Other observations
such as player/bounds/progression remain optional; see the API guide.

Disabling the plugin removes only its own autoload. Keep your optional integration
guarded as above; an unguarded reference to the `PostPlay` global will not parse
once that global is removed. Do not disable while recording; preserve any
unfinished output if you do.

## Reproduce the fresh-project check

```sh
nix develop -c just fresh-project-test
```

This explicit GUI check creates a fresh project from
`tests/fixtures/godot-project/`, copies **only** `demo/addons/postplay/`, imports
with no enabled PostPlay plugin/autoload, then enables it through the editor.
It records an independent scene without hooks and then the same gameplay with
one existing signal/property watch. It validates portable contracts and real AVI
metadata, checks exact signal/property values, different IDs, settings restoration,
an ordinary inactive run and plugin disable/autoload removal. Neither the original
demo settings nor its gameplay/scripts are copied. Outputs and `verification.json`
remain in ignored `artifacts/fresh project-*` directories.

These short timer-driven fixture scenes test installation, not human interaction,
synchronization, AI performance or the six-session evaluation. The command is
separate from headless `just check`, requires a display, and never calls Meta.
The M1 owner exit gate remains a separate confirmation.

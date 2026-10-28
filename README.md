# PostPlay

Local, post-session AI playtesting for Godot: record gameplay and telemetry,
analyze with Meta Muse Spark, and inspect the evidence in a local dashboard.
Implementation is starting; see [TASKS.md](TASKS.md) for verified progress and
[PROJECT.md](PROJECT.md) for the approved specification.

## Development environment

The Nix development shell targets **x86_64 Linux**, matching the owner-supplied
Godot package in `nix/godot.nix`. With Nix flakes enabled:

```sh
nix develop
godot --version
node --version
npm --version
ffmpeg -version
ffprobe -version
```

The flake provides the custom Godot editor, Node.js 24 with npm, FFmpeg/FFprobe,
Git, and nixfmt. `flake.lock` pins nixpkgs; the supplied Godot derivation pins
its upstream binary and hash. npm is the selected JavaScript package manager;
`app/package-lock.json` pins the application dependencies.

The custom Godot launcher uses an FHS environment and needs a host that permits
its sandbox/user-namespace setup. A headless version check does not demonstrate
interactive recording; Movie Maker feasibility is a separate M0 check.

Without Nix, the intended prerequisites are a compatible Godot 4.x editor,
Node.js 24 with npm, and FFmpeg/FFprobe on PATH. This path has not yet been
verified. Application launch instructions will follow implementation.

Keep `MODEL_API_KEY` in the local environment only. Never put credentials in
Nix expressions or Git. No model requests are made by entering the shell.
Dashboard packaging (`nix build` / `nix run`) and addon archives are not yet
implemented.

## Initial application skeletons

Inside `nix develop`, from the repository root:

```sh
npm --prefix app ci --ignore-scripts
npm --prefix app run check
npm --prefix app run build
npm --prefix app run dev
godot --editor --path demo
```

Open <http://127.0.0.1:4321>. The page describes the current implementation
status; session ingestion and analysis are not implemented yet. Astro 7 starts
its development server in the background; stop it from `app/` with
`npx astro dev stop`. The production server starts after a build with
`npm --prefix app start`, also bound to loopback by default.

The demo has arrow-key movement and a beacon activated with Space/Enter. Each
activation increments the visible counter, changes the beacon color, and flashes
a stripe for half a simulation second. Escape finishes the run. The enabled
addon remains a skeleton; the smoke telemetry probe is separate from its API.
For a noninteractive parse/load check:

```sh
godot --headless --path demo --editor --import --quit
godot --headless --path demo --quit-after 2
godot --headless --path demo --script res://tests/smoke_scene_test.gd
```

Godot's `.godot/` cache, Node dependencies/build output, local sessions,
recordings and `.env` files are ignored. Keep generated GDScript `.uid` files
in Git to preserve resource identity. There is no model upload action yet.

## Human recording feasibility check (M0.3–M0.4 pending)

From the repository root inside `nix develop`:

```sh
mkdir -p recordings
POSTPLAY_SMOKE_OUTPUT="$PWD/recordings" godot --path demo \
  --write-movie "$PWD/recordings/smoke-01.avi" --fixed-fps 30
```

Use a **new movie filename each time**: direct Godot Movie Maker invocation can
overwrite that path. Play for 30–120 seconds, move with the arrows, and activate
the beacon several times. Note whether controls remain responsive, then press
Escape to finalize. Movie Maker may be slower than real time and may not play
audible sound during capture. This scene intentionally has no audio content.

The optional probe creates a fresh `recordings/smoke-<date>-<random>/` directory
with `smoke-events.jsonl`. It records simulation milliseconds, process/physics
frames, interaction counts and position samples (at most 10 Hz), capped at 2,400
events with a `probe_limit` marker. It does not collect typed text. These are
**smoke probe data**, not the future portable session format. An absent `end`
event or a present `probe_limit` marker means coverage is incomplete.
Synchronization is explicitly unknown until a visible beacon activation is
measured against the video.

Inspect and convert the completed recording, preserving the original:

```sh
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json recordings/smoke-01.avi
ffmpeg -n -i recordings/smoke-01.avi -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart recordings/smoke-01.mp4
```

Open the MP4 in a local player/browser. Record capture responsiveness, duration,
whether the flash/counter are visible, and the first flash's video time against
the matching `beacon_activated` telemetry. The target alignment is about 0.5 s;
do not assume `simulation_ms` already equals encoded video time. No real human
recording, playback, editor Movie Maker restoration, or Meta call has yet been
verified. See [Godot's Movie Maker documentation](https://docs.godotengine.org/en/stable/tutorials/animation/creating_movies.html)
for the upstream recording controls and limitations.

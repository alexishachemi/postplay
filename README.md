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
Git, just, and nixfmt. `flake.lock` pins nixpkgs; the supplied Godot derivation pins
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

## Common development commands

Enter `nix develop`, then run `just` to list recipes. You can also use
`nix develop -c just RECIPE` directly. The recipes use the repository root even
when invoked from a subdirectory. Without Nix, install `just` alongside the
Godot/Node/FFmpeg prerequisites.

| Command | Purpose |
| --- | --- |
| `just install` | Install locked npm dependencies |
| `just demo` / `just editor` | Launch the demo / Godot editor |
| `just app` / `just app-stop` | Start / stop the background Astro dev server |
| `just build` / `just app-start` | Build / run the foreground production server |
| `just record` | Legacy M0 smoke recording; use editor Record Session for portable v1 capture |
| `just check` | Node tests, Godot smoke test, TypeScript checks and build; no API calls |
| `just test` / `just smoke-test` | Run Node tests / deterministic Godot smoke test |
| `just contract-test` | Raw session/event contracts, fixtures and Godot-to-Node serialization checks |
| `just ingestion-test` | Safe library loading, media probes, malformed/partial/path fixtures |
| `just sessions` / `just session-inspect UUID` | List/inspect POSTPLAY_SESSION_ROOT (or XDG default); no upload |
| `just capture-test` | Godot runtime lifecycle, limits and forced-exit recovery; synthetic data only |
| `just watch-test` | Existing signals/properties, safe sampling and cleanup in Godot |
| `just observation-test` | Demo input/movement, text-focus privacy and optional semantic context |
| `just workflow-test` | Reserved-session lifecycle, media finalization and failure fixtures |
| `just editor-capture-test` | Explicit GUI editor recording/restoration check in a disposable project |
| `just fresh-project-test` | GUI: copy/enable the addon in an independent project; capture without/with watches |
| `just sync-test` / `just sync-capture-test` | Deterministic mappings / real GUI visible-event calibration |
| `just sync-measure SESSION OBSERVATIONS [CLOCK] [--apply]` | Preview a measured anchor; opt in to backed-up metadata update |
| `just nix-check` | Evaluate the flake outputs |
| `just probe VIDEO` | Inspect media metadata |
| `just convert VIDEO OUTPUT.mp4` | Convert without overwriting an existing output |
| `just timing VIDEO PROBE_JSONL [X Y]` | Measure this smoke scene's beacon timing |
| `just smoke-prepare VIDEO PROBE_JSONL NEW_DIRECTORY` | Prepare the measured M0 capture locally |
| `just smoke-analyze DIRECTORY` | **Paid:** explicitly upload prepared media/context and call Meta once |

`just record` creates `recording.avi` plus a fresh `smoke-*` telemetry child
directory. Quote paths containing spaces. `smoke-prepare` remains specific to
the measured M0 capture, as described below. `smoke-analyze` requires the key in
the environment and retains the CLI's replay guard. Default listing, tests and
preparation do not upload anything.

To use PostPlay in another game, follow the [copy/enable integration guide](docs/addon-integration.md).
The addon alone requires Godot and FFmpeg, not the dashboard or an API key.

M0 is approved by the owner. M1's [portable raw capture contracts](contracts/README.md)
now define `session.json`/`events.jsonl` and bounded safe values. The reusable
[runtime collector](docs/capture-runtime.md) writes these packages and watches
existing signals/properties, polls selected action states, and supports optional
player/bounds/progression context. [Editor recording](docs/editor-capture.md)
adds Record Session / Stop PostPlay controls and media finalization.
[Synchronization measurement](docs/synchronization.md) maps explicitly observed
anchors, exposes uncertainty and preserves originals. Unmeasured sessions stay
unknown. The M0 smoke telemetry
keeps its separate format.

M1 is owner-approved. [Local session ingestion](docs/session-ingestion.md) now
loads and probes saved packages from a configured library, with explicit errors
for damaged/partial captures. Conversion, general analysis and dashboard review
remain subsequent M2/M3 work; successful inspection is not a clean model report.

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
addon provides editor recording and the public PostPlay runtime API; the old smoke
telemetry probe remains separate.
For a noninteractive parse/load check:

```sh
godot --headless --path demo --editor --import --quit
godot --headless --path demo --quit-after 2
godot --headless --path demo --script res://tests/smoke_scene_test.gd
```

Godot's `.godot/` cache, Node dependencies/build output, local sessions,
recordings and `.env` files are ignored. Keep generated GDScript `.uid` files
in Git to preserve resource identity. Dashboard analysis is not implemented yet;
the explicit server-side smoke command below is available.

## Real Muse compatibility smoke

M0.5 produced a real schema-valid Muse Spark response from a human gameplay
excerpt plus telemetry. It returned no supported findings, with coverage limits;
the remote upload was deleted. See the [verification record](docs/verification/m0-meta-smoke.md)
for inputs, usage, limitations, saved artifacts and reproduction commands.

`node app/scripts/meta-smoke.ts prepare VIDEO SMOKE_JSONL NEW_DIRECTORY` prepares
the measured smoke capture's seconds 30–60 locally. Only
`node --use-env-proxy app/scripts/meta-smoke.ts analyze DIRECTORY --upload-to-meta`
uploads the prepared clip and context to Meta and makes one Standard-mode
`muse-spark-1.3` request. It needs `MODEL_API_KEY` in that process's environment.
Never place the key in command arguments, browser code, Git or chat. Existing
run directories cannot be analyzed again; inspect prior results before creating
another paid run. Limits are 30 seconds, 20 MB video, 96 KB context and 4,096
output tokens, with no automatic retries. Model proposals remain separate from
final validated M2 reports. Cleanup failures are saved separately from inference
outcomes and must be inspected.

Run deterministic server tests with `npm --prefix app test`. They make no API
calls. The smoke CLI is a development tool for this specific measured capture;
general ingestion, budget UX and final report storage remain M1/M2 work.
Development scripts disable Astro's optional framework telemetry.

## Recording smoke check

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
do not assume `simulation_ms` already equals encoded video time.

The first owner-recorded clip passed responsiveness/playback checks, but had an
unintended vertical crop already present in the AVI, hiding the HUD. The demo
now uses a fixed 960×540 viewport with preserved aspect ratio. Two-frame rendered
checks at 960×540 and 1920×1080 window sizes produced identical, correctly framed
video frames. The precise cause of the earlier capture's crop is not established;
disabled stretching did make recorded layout depend on window size. Keep the
original files, and use a new filename for future recordings after this fix.

For this specific old clip, the beacon center is (760, 64) in encoded pixels.
Its nine flashes matched their logged process frames, with a maximum observed
simulation/video timestamp difference of 8.7 ms at 33.3 ms frame resolution:

```sh
node scripts/check-smoke-timing.mjs recordings/smoke-01.mp4 \
  recordings/smoke-2026-10-28T22-04-14-ccf9e88303d7cf49/smoke-events.jsonl 760 64
```

For new, correctly framed 30 fps clips, omit the last two arguments to use the
intended beacon center (760, 330). The script measures only this smoke scene's
magenta transitions; it is not a bug detector or a universal synchronization map.

The pinned editor's Movie Maker toggle and restoration can be probed with:

```sh
godot --headless --editor --path demo --script res://tests/movie_maker_api_probe.gd
```

The API probe verifies toggle restoration and launch/stop method availability;
it does not launch a recording through the addon. On Godot 4.7.2, this headless
editor-script probe exits 0 after its assertions but emits resource-leak diagnostics
at shutdown. Full addon launch/restore remains M1.5 work. The real Meta smoke
is recorded separately above. See [Godot's Movie Maker documentation](https://docs.godotengine.org/en/stable/tutorials/animation/creating_movies.html)
and [viewport scaling documentation](https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html)
for upstream recording controls and stretch modes.

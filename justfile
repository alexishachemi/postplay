# Run inside `nix develop`, or use `nix develop -c just RECIPE`.
set positional-arguments

# List available commands. Never starts recording or uploads data.
default:
    @just --list

# Install the locked application dependencies.
install:
    npm --prefix app ci --ignore-scripts

# Start the local application at http://127.0.0.1:4321 (Astro runs in background).
app:
    npm --prefix app run dev

# Stop the Astro development server.
app-stop:
    ASTRO_TELEMETRY_DISABLED=1 npm --prefix app exec -- astro dev stop --root app

# Run the built local server in the foreground (run `just build` first).
app-start:
    npm --prefix app start

# Launch the demo; optional Godot arguments are forwarded literally.
demo *args:
    godot --path demo "$@"

# Open the Godot demo editor.
editor:
    godot --editor --path demo

# Legacy M0 smoke only; portable v1 capture uses the editor's Record Session button.
record:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p recordings
    capture_dir=$(mktemp -d "$PWD/recordings/capture-XXXXXXXX")
    printf 'Recording directory: %s\n' "$capture_dir"
    POSTPLAY_SMOKE_OUTPUT="$capture_dir" godot --path demo --write-movie "$capture_dir/recording.avi" --fixed-fps 30

# Run deterministic Node/API tests; no remote requests.
test:
    npm --prefix app test

# Safe local package loading/probing and malformed/path/partial-session fixtures.
ingestion-test:
    node --test app/tests/session-library.test.ts

# List UUID packages in POSTPLAY_SESSION_ROOT (or XDG default); no upload.
sessions:
    node app/scripts/sessions.ts list

# Validate/probe one library session; prints diagnostics, not raw event payloads.
session-inspect id:
    node app/scripts/sessions.ts inspect "$1"

# Prepare a measured session locally; optionally append START_MS DURATION_MS. No upload.
session-prepare id *args:
    node app/scripts/prepare-session.ts "$@"

# Deterministic context/clip/provenance/conversion-failure checks; no API requests.
preparation-test:
    node --test app/tests/preparation.test.ts

# Run the deterministic Godot smoke scene test; no recording or remote requests.
smoke-test:
    godot --headless --path demo --script res://tests/smoke_scene_test.gd

# Validate raw session/event contracts, including a real Godot serializer round trip.
contract-test:
    node --test app/tests/session-contract.test.ts

# Exercise actual Godot session lifecycle, bounded logs and forced-exit recovery.
capture-test:
    node --test app/tests/collector.test.ts

# Exercise existing signal/property watches in actual Godot; no remote requests.
watch-test:
    node --test app/tests/watchers.test.ts

# Verify selected action states, text-focus privacy, player/bounds/progression context.
observation-test:
    node --test app/tests/observations.test.ts

# GUI: two short editor recordings in a disposable project; no API requests.
editor-capture-test:
    node app/scripts/editor-capture-check.ts

# GUI: install only the addon in an independent project, then record without/with hooks.
fresh-project-test:
    node app/scripts/fresh-project-check.ts

# GUI: measure three visible beacon flashes in a disposable calibration recording.
sync-capture-test:
    node app/scripts/editor-capture-check.ts --timing

# Deterministic anchor, drift, missing-anchor and conversion-offset checks.
sync-test:
    node --test app/tests/synchronization.test.ts app/tests/synchronization-command.test.ts

# Read-only visible-event measurement; append --apply to save metadata + original backup.
sync-measure session observations clock='process_frame' *args:
    node app/scripts/measure-synchronization.ts "$@"

# Headless reservation/claim/finalization fixtures and media/error checks.
workflow-test:
    node --test app/tests/capture-workflow.test.ts

# Check strict TypeScript and Astro types.
typecheck:
    npm --prefix app run check

# Build the local application.
build:
    npm --prefix app run build

# Run local tests, type checks and app build; never calls Meta.
check: test smoke-test typecheck build

# Validate Nix outputs without building optional distribution packages.
nix-check:
    nix flake check --no-build

# Inspect a recording's duration, format and dimensions.
probe video:
    ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json "$1"

# Convert to browser-compatible MP4 while refusing to overwrite output.
convert video output:
    @test ! -e "$2" || { printf 'Refusing to overwrite existing output: %s\n' "$2" >&2; exit 1; }
    ffmpeg -v error -n -i "$1" -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$2"

# Measure smoke beacon timing; use x=760 y=64 for the original cropped clip.
timing video telemetry x='760' y='330':
    node scripts/check-smoke-timing.mjs "$1" "$2" "$3" "$4"

# Prepare original smoke recording seconds 30–60 locally; output must be new.
smoke-prepare video telemetry output:
    node app/scripts/meta-smoke.ts prepare "$1" "$2" "$3"

# PAID: upload a prepared run to Meta and make one inference call; requires MODEL_API_KEY.
smoke-analyze directory:
    node --use-env-proxy app/scripts/meta-smoke.ts analyze "$1" --upload-to-meta

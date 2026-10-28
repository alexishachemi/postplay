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

# Record gameplay and smoke telemetry into a fresh recordings/capture-* directory.
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

# Run the deterministic Godot smoke scene test; no recording or remote requests.
smoke-test:
    godot --headless --path demo --script res://tests/smoke_scene_test.gd

# Validate raw session/event contracts, including a real Godot serializer round trip.
contract-test:
    node --test app/tests/session-contract.test.ts

# Exercise actual Godot session lifecycle, bounded logs and forced-exit recovery.
capture-test:
    node --test app/tests/collector.test.ts

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

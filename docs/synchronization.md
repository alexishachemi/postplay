# Measure video/telemetry synchronization

A finalized movie is **not** automatically synchronized. New captures retain
`synchronization.status: "unknown"` until a visible event is measured in that
particular recording. Never reuse an offset from another session, or equate wall
time with fixed-fps Movie Maker time. The [dashboard](dashboard.md) provides a local
event/video alignment form; the command below is an optional developer alternative. See the
[complete walkthrough](dashboard-journey.md) for the order of operations.

## Measure in the app (normal user workflow)

Create a local preview, then use **Align video and telemetry locally** below the
player. Filter/select two recorded signal events with recognizable visible changes.
Pause at each change, click **Use paused video time**, and allow honest uncertainty
(initially ±100 ms; increase for ambiguous onsets). Choose events at least one second
apart. Frame-sized seek buttons help inspection but do not guarantee exact frame
selection. Confirm the matches, review the measured status/error/span/residuals,
then explicitly save. No terminal, observations file, upload or API key is required.

Editing a match invalidates its review. The save binds the exact matches to source
and preview hashes, creates the original-manifest/measurement backup, and updates
only alignment metadata. Original video and events are unchanged. Existing
measurements or preparation history are never overwritten. The app refreshes the
local preview after saving, then you can prepare/analyze normally. If preview
refresh fails, reload and use Create local preview; alignment remains saved. Large uncertainty
remains approximate, not silently verified. If the connection drops during save,
refresh and inspect the current alignment before repeating anything.

The UI offers watched signals (including the showcases' Tab pulses or pickups),
not lifecycle timestamps. It displays at most 200 matching choices at once; filtering
searches the whole bounded signal list, so later events are still accessible.
Without any observed interaction with a visible counterpart, record again with
appropriate instrumentation; the app does not invent synchronization.

## Measure with the optional developer CLI

1. Register an existing signal that accompanies a distinctive visible change.
   For the demo, add `PostPlay.watch_signal(beacon_activated, "Visible beacon")`
   inside `_ready()`; no change to the signal emitter is needed. Record using
   [Record Session](editor-capture.md), activate the beacon several times well
   apart, then stop gracefully. Without this optional observation there is no
   beacon signal to correlate; do not substitute an unrelated lifecycle event.
2. Find the matching signal event IDs in `events.jsonl`. Inspect the original
   recording frame-by-frame and note the first changed frame for each event.
   At 30 fps, zero-based frame `n` starts at `n * 1000 / 30` milliseconds.
   Round to integer milliseconds. Include the observer's uncertainty; the
   measurement additionally budgets a full encoded frame for quantization.
3. Save an observations JSON array, using **actual IDs and observed times**:

```json
[
  { "event_id": "evt-2", "video_ms": 967, "uncertainty_ms": 1 },
  { "event_id": "evt-3", "video_ms": 2967, "uncertainty_ms": 1 }
]
```

These numbers are an example from the calibration below, not universal offsets.
Preview the measurement without changing any file:

```sh
nix develop -c just sync-measure '/path/to/session' '/path/to/observations.json'
```

To persist it, explicitly select the clock and opt in:

```sh
nix develop -c just sync-measure '/path/to/session' '/path/to/observations.json' process_frame --apply
```

The command requires a complete v1 package. It checks observation IDs, clock
availability, ordering, ranges and uncertainty. It hashes the original manifest,
log and video, but does **not** decode media or independently verify a person's
observations. Media finalization is a separate prerequisite. This is a local
measurement tool, not M2's general untrusted-session importer.

`--apply` saves an exclusive `synchronization-UUID/` directory containing
`session.before.json` and `measurement.json`, then atomically replaces only the
manifest with updated synchronization metadata. Video and events are untouched.
Existing measurements are not overwritten. If interrupted before replacement,
the original manifest remains usable; retain any diagnostic/backup directory.
Keep the backup/report alongside the portable package. No network request occurs.

## Mapping and qualifications

`app/src/server/synchronization.ts` uses:

```text
video_ms = anchor.video_ms + (event_clock - anchor.recorded_value) * scale
scale = 1000 / fps for Movie Maker process frames; 1 for simulation/wall ms
```

The anchor references an actual event with a matching clock value. Missing
anchors/clocks return `unknown`; invalid anchors are validation errors. Events
outside media return `outside`, never a silently clamped timestamp. Wall-clock
mapping is rejected for Movie Maker. Simulation mapping is available explicitly,
but pauses/time scaling can invalidate it; check separated visible events.

The first observation supplies the anchor; later observations measure residual
error, rather than fitting drift away. The conservative error is the largest
absolute residual plus uncertainty at both ends and one encoded frame. At least
two observations spanning 1,000 ms with error at most 500 ms are needed for
`verified`; otherwise the result is explicitly `approximate`. This verifies the
sampled span, not every frame or unobserved interval of a recording. Large drift
remains visible in the report. It must not be displayed as precise alignment.

For a derived MP4, `mapToDerivedVideo` subtracts its explicit **actual** source
trim start; timestamps outside the derived interval stay outside. Transcoding
without trimming uses a zero offset. A requested FFmpeg seek is not evidence of
the actual first encoded timestamp. The [preparation workflow](session-preparation.md)
measures retained frame PTS, verifies derived timestamps and records the actual offset.
Original event clocks are never rewritten. External MP4 wall/simulation mappings
are supported mathematically, but the conditional external-recording import
fallback has not been triggered or claimed tested: Movie Maker works here.

## Reproduce the calibration

```sh
nix develop -c just sync-test          # deterministic tests, no display
nix develop -c just sync-capture-test  # real GUI editor + Movie Maker, needs a display
```

The GUI check copies the demo into an ignored disposable artifact directory,
enables a test-only calibration autoload, watches the existing beacon signal,
triggers three flashes and quits normally after six encoded seconds. A bounded
scene-specific pixel detector finds magenta onsets at the beacon. The production
demo is unchanged. This is deterministic timing calibration, **not autonomous
gameplay, a human session or model-quality evaluation**. It does not apply its
mapping to other captures. Its `observations.json` can be passed to `sync-measure`.

Observed on 2026-10-29 with the pinned Godot 4.7.2: 960×540, 30 fps, visible
onsets at frames 29/89/149 matching the recorded process-frame values. Anchor:
`evt-2`, process frame 29, video 967 ms. Three observations span 4,000 ms;
maximum residual 0 ms, estimated error **36 ms** (not frame-perfect certainty).
The extracted frame 29 was viewed and showed the magenta beacon/stripe, count 1
and complete, correctly framed HUD/play area. The real package, measurement
application backup and timing diagnostics are retained locally in ignored
`artifacts/editor capture-mAGzwr/`; no generated movie is committed. No paid API
call was made. Owner M1 milestone verification remains separate.

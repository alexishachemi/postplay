# Prepare a recorded session for analysis

Preparation is **local only**: it creates an MP4 and a validated AI context, not a
model response, a clean report or a remote upload. No API key is needed. Use the
[session library](session-ingestion.md) and pinned FFmpeg/FFprobe from `nix develop`.

```sh
nix develop
export POSTPLAY_SESSION_ROOT='/absolute/path/to/addon/session-root'
just sessions
just session-inspect SESSION_UUID
just session-prepare SESSION_UUID
# Or deliberately select a source-video interval (integer milliseconds):
just session-prepare SESSION_UUID 723 3200
```

Replace the UUID with a listed ID. The default is the entire recording, **only if
it fits the caps**; a longer recording requires an explicit bounded interval.
Preparation does not silently choose a shorter interval or downsample telemetry.
The older `just smoke-prepare` is still M0-specific, not this portable v1 workflow.

## Prerequisites and limits

- A complete, safely validated raw v1 package. Original manifest/log/video are
  never rewritten. Missing/corrupt media, partial captures and unsafe paths fail.
- A measured frame/simulation anchor (or external-video wall anchor). Unknown
  synchronization is valid for inspection but cannot supply honest video-local
  event timestamps; preparation returns `synchronization_unknown`. Follow the
  [measurement guide](synchronization.md), rather than inventing an offset.
- At least one aligned gameplay observation in the chosen clip. An interval with
  only lifecycle records returns `insufficient_telemetry`, not an apparently clean
  analyzed result. Optional watches or recorded action transitions supply context.
- Current safety caps: **120 seconds** per clip, **1 GiB** original media,
  **20 MiB** prepared MP4, **96,000 bytes** context file and **2,000** included
  events. Server options can lower caps, not increase them. Narrow the clip if
  required; instrumentation descriptions can also consume context budget.
- The original first decoded video PTS must be zero. Nonzero container origins
  need a separately specified source-origin mapping and are explicitly rejected,
  not silently shifted. The pinned Movie Maker captures satisfy this constraint.

Each subprocess has a 180-second timeout and an 8 MiB combined output/log budget;
timestamp verification is bounded to 30,000 decoded frames per stage. High-frame-
rate or very long inputs can hit these resource limits even for a selected clip.
This is the tested Linux-first path, not exhaustive support for arbitrary media.

## Outputs and readiness

The command prints a relative directory, e.g. `preparations/UUID`, inside the
chosen source session. Each explicit invocation reserves a different directory:

```text
source-session-uuid/
  session.json                 original, unchanged
  events.jsonl                 original, unchanged
  recording.avi                original, unchanged
  preparations/preparation-uuid/
    started.json               durable intent before conversion
    clip.mp4                   H.264 / TV-range yuv420p, no audio
    context.json               analysis-input.v1, compact UTF-8 JSON + LF
    preparation.json           successful completion marker, written LAST
```

`preparation.json` records source manifest/events/video and output file SHA-256s,
the measured source offset, requested interval, actual clip duration/frame count,
conversion residual/error, FFmpeg version, encoding settings, byte budgets and
coverage. The context hash covers the **actual file bytes**, not an alternate
pretty-printing. Event IDs in context resolve directly in the unchanged raw log.
Source hashes identify the exact evidence snapshot; they are local provenance,
not extra model instructions. Retain source packages alongside derived inputs.

On failure, a best-effort `failure.json` is saved if a run directory exists.
Partial clips/started markers are preserved for diagnosis and are **not ready**.
An interruption before the final marker likewise does not count as success.
Consumers must require/validate the completion marker and hashes, never infer
readiness from `clip.mp4` or `context.json` alone. There are no automatic retries,
deletions, overwrites or API calls; explicit reruns get new IDs.

## Timing and conversion

Original AVI/OGV/MP4 are read through pinned regular-file descriptors. FFmpeg's
input protocol/demuxer are restricted, its environment excludes credentials, and
arguments are passed without a shell. Outputs live in a newly created, private
directory under the pinned session; output symlinks are rejected. This remains a
local same-user workflow, not a codec/OS sandbox.

Conversion preserves presentation timestamps with `-copyts`, measures the
original zero origin, then trims decoded frames, measures the first retained PTS
and rebases the clip to zero. A requested 723 ms start at 30 fps can therefore
produce an actual 733.333 ms start. The latter is recorded/used for telemetry.
Dimensions shrink to at most 960×540, maintaining aspect/even sizes without
upscaling; no camera crop is introduced. Audio, chapters and container metadata
are omitted. H.264 uses single-threaded libx264, veryfast/CRF 23 and faststart.
Full-range MJPEG is explicitly scaled/tagged to TV range, avoiding unintended
`yuvj420p` output. No frame-rate conversion or guessed wall-clock map is used.

The complete derived MP4 is decoded again. Each decoded frame PTS must match its
retained source PTS minus the measured offset within 1 ms; lost/duplicated frames,
wrong duration or unsupported output codec/pixel format fail. Media byte caps
cannot turn a truncated encode into successful preparation. Original media hashes
are checked again and metadata changes detected before completion.

## Context and evidence

The existing v1 [AI input contract](../ai/README.md) is unchanged. Context includes
original IDs, ordered clip-local integer times, source labels, all declared
registrations/descriptions/expectations, and each raw safe payload unchanged under
`payload.value` plus its original `payload.label`. Typed vectors, dictionary tags,
nulls and unsupported markers are not guessed/decoded into invented values.

Lifecycle records are omitted. Observations outside the actual encoded interval
or lacking the anchor clock are omitted **with counts/reasons**. Coverage reports
the original event total, included count, raw capture truncation and excerpt
limits. Every eligible event is otherwise retained; event/byte overflow stops
preparation rather than selecting events by suspected bugs or hidden answers.

Integer flooring adds up to 1 ms of timing uncertainty. Conversion error is added
to the source estimate; status becomes approximate if the combined estimate
exceeds 500 ms. A measured source anchor still verifies only its sampled span,
not all unobserved portions of the recording.

Project names, source filenames/paths, arbitrary manifest/synchronization notes,
capture-start payloads and evaluation metadata are not copied into model context.
Explicit watched values, source labels and developer expectations are still
untrusted game data: review them for private information/hidden scenario labels
before any later user-triggered upload. No generic keyword filter can establish
that a developer-provided annotation is free of evaluation answers. M4 still
requires an honest audit of the real AI-bound inputs.

## Verification

`nix develop -c just preparation-test` covers safe-value/ID preservation, actual
off-frame offsets, deterministic repeated fixture hashes, AVI/OGV/MP4 conversion,
original-file preservation, error/budget paths, missing tools, source changes,
output symlink rejection and nonzero-origin rejection. Fixture media are generated
test patterns, not playtests or model-performance results.

On 2026-10-30 the actual M1 calibration was also prepared and fully decoded. The
final 3,200 ms clip requested at 723 ms starts at measured source time 733.333 ms;
96 decoded frame timestamps match to floating-point precision. Its two retained
beacon events resolve to the original log; the first is at clip time 233 ms with
a conservative combined error of **39 ms**. Frame 7 was viewed: beacon/stripe,
count 1, HUD and full play area are correctly framed. Source/output hashes and
context schema/evidence references were checked. Local ignored evidence:
`artifacts/editor capture-mAGzwr/sessions/aa2e6b72-7387-4a75-88f8-c8789f9051dd/preparations/274c9745-c863-483c-89c5-90470b7feff8/`.
Earlier failed/intermediate development runs remain preserved and are not model
evaluation. General Muse submission/persistence and dashboard remain later tasks.

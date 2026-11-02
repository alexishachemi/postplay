# Local session dashboard

The dashboard provides a session library, selectable metadata overview and local
video playback. Analysis buttons and finding navigation remain later M3 tasks;
the existing CLI workflow still handles submission/report steps. Loading or
refreshing this page **never uploads to Meta or starts a conversion/analysis job**.

## Start from the checkout

```sh
nix develop
export POSTPLAY_SESSION_ROOT='/absolute/path/to/addon/session-root'
just app
# Open http://127.0.0.1:4321
# Stop the development server when finished:
just app-stop
```

Configure the root **before** starting the server. It must contain canonical
session-UUID directories, not a single session's files. If unset, the same
XDG-compatible library described in [ingestion](session-ingestion.md) is used.
An empty root has recording/setup instructions; missing permissions, invalid
storage or an out-of-range page produces an explicit error rather than fake data.
The writable root may be created by the shared library initialization.

For the production server:

```sh
just build
just app-start
```

The default binding is `127.0.0.1`; stop the foreground production server with
Ctrl-C. `PORT` can select another local port. Keep this local developer tool off
the public network; it has no accounts or hosted-service security model.

Choose a session card to show its project/scene, UUID, recorded UTC date, session
duration, synchronization label and saved report status. Refresh explicitly after
capture or CLI analysis; this view does not poll or make paid calls. A validated
empty report is not evidence of a bug-free game. `needs_review` and quarantine
counts remain distinguishable from a clean/no-findings result.

## Status rules

| Status | Meaning |
| --- | --- |
| Recorded | Complete original recording/telemetry validated; no completed report for the selected preparation |
| Processing | Capture/preparation/analysis is unfinalized; it may still run **or may have been interrupted** |
| Analyzed | Saved report reopened through full M2 provenance/schema/evidence validation, not just a marker's presence |
| Failed | Incomplete/invalid capture, saved preparation/analysis failure, unsafe files or a report that cannot validate |

For multiple preparations, the overview uses the **most recently modified**
preparation/analysis directory, with UUID tie-breaking. This is local filesystem
ordering, not proof of a running job or an inference timestamp. A newer failed or
unfinished attempt is not hidden by an older successful report. Explicit attempt
selection is not implemented in this first view. A completed model response
without a completed offline report remains unfinished here; use `just session-report`
to finish that CLI step without another model call.

At most ten sessions are loaded per page, in stable UUID order. Root discovery
retains the 1,000-entry cap; preparation discovery stops with a diagnostic beyond
100 entries instead of silently hiding excess attempts. Media probing/report
hash validation can take time on large packages. There is deliberately no stale
cache, automatic background verification, arbitrary filesystem browser or recursive
directory scan. Unknown synchronization remains unknown.

## Video playback and timing

Choose a session, then scroll to **Recorded video**. A validated prepared analysis
excerpt is used when available. Its actual duration and source-video start offset
are shown separately from full session duration. Otherwise click **Create local
preview** (requires JavaScript): this only runs FFmpeg locally, then reloads the
page. It does not require an API key, upload anything, or create analysis inputs.
Already saved videos play with native browser controls; numeric seek uses JavaScript.

Play/pause or use the native scrubber. Enter a video-local time in seconds and
press **Seek** for an exact requested time. The live clock also shows source-video
time: `source = player time + actual source_start_ms / 1000`. These are encoded
video clocks, not wall time, simulation time or frame numbers. For the calibration
session the 3.200-second excerpt begins at source 0.733333 seconds; seeking to
0.250 seconds shows source 0.983333 seconds, near the measured first beacon flash.
Browser decoding/seek precision depends on the browser; no frame-perfect claim.

Unknown or approximate synchronization, unavailable uncertainty, or combined
alignment/conversion uncertainty above 500 ms gets a text warning. Verified sync
still describes sampled visible events, not proof about all intervening frames.
Local preview conversion works without measured telemetry alignment and never
changes the session's synchronization status. Audio is omitted.

Full previews support up to **120 seconds**, **1 GiB source**, **20 MiB MP4**, at
most 960×540 H.264/yuv420p. Original AVI/OGV/MP4 files are preserved. Conversion
keeps every decoded frame and verifies timestamps (≤1 ms conversion residual),
frame count, duration and source hashes. Nonzero source PTS, excess size/duration,
or conversion/tool failures are explicit errors, not silently trimmed success.
For longer/larger captures, use an explicitly prepared excerpt via the documented
CLI. No automatic retry or hidden preparation/upload is performed.

Preview-only derived files are stored under `SESSION_UUID/playback/PREVIEW_UUID/`:
`clip.mp4` and an internal `preview.json` v1 completion/provenance marker written
last. This is separate from analysis preparations and does not modify raw session
or AI/report contracts. Marker records source/clip hashes, measured duration,
source offset, conversion uncertainty, frame count and encoder settings. Valid
previews are reused; invalid/partial attempts remain on disk and an explicit retry
gets a new UUID. The latest local preview is selected by directory mtime with UUID
tie-break, bounded to 100 entries. Archive attempts outside the package if that
limit is reached. Interrupted attempts have no success marker.

Missing original/video, unsafe files, stale/corrupt hashes or unsupported browser
codecs produce actionable text. Restore missing originals, ensure FFmpeg/FFprobe
are on PATH, and refresh/retry; do not edit hashes to bypass validation. H.264
browser support is required. Corrupt model analysis need not prevent an independent
local preview from playing and never becomes a clean report through playback.

## Local API

- `GET /api/sessions?page=1`: selected public summaries, page/pages/total and ignored-entry count.
- `GET /api/sessions/SESSION_UUID`: one existing session summary; 404 if absent.
- `/?page=1&session=SESSION_UUID`: server-rendered list/selection; works without JavaScript.
- `GET`/`HEAD /api/sessions/SESSION_UUID/video?preparation=PREPARATION_UUID` (or `?preview=PREVIEW_UUID`): validated MP4 snapshot. Exactly one selector, no paths. Single byte ranges support native seeking (206); unsatisfiable/malformed/multiple ranges get 416. With `If-Range` and no stored validator the entire snapshot is returned.
- `POST /api/sessions/SESSION_UUID/preview`: explicit full-source local conversion/reuse; empty body, `Content-Type: application/json`, valid same-origin `Origin` required. Returns public video metadata and `remote_upload: false`; 409 for duplicate active conversion, 422 for invalid capture/conversion failure. No remote upload or analysis endpoint yet.

The API never returns raw logs, raw model/proposal/request bodies, credentials,
server directory paths or borrowed file descriptors. Names/scene labels are
developer-provided metadata; Astro renders them as escaped text. UUID/path and
page validation precede file access. Symlinks/shared/special files are rejected
by the pinned-descriptor library. Nonlocal Host names and cross-origin requests
are rejected; responses use no-store, nosniff, no-referrer and frame-denial headers.
Preview creation is the only write action so far. Astro origin protections remain
enabled, with an additional original-Host/origin check on the endpoint; cross-site
and form-like requests are rejected. The in-process duplicate guard is not a
cross-process queue/lock: run one local server per library. Separate processes
would still get distinct UUID directories, never overwrite prior attempts.

Each video response revalidates provenance and reads a bounded immutable byte
snapshot (≤20 MiB, including for ranges/HEAD), then closes all descriptors before
responding. There is no unbounded streaming, pathname exposure or stale media
cache; re-hashing/probing on seeks can take time for larger originals. This is a
deliberately bounded hackathon implementation, not a high-throughput media server.

Schemas/prompts load relative to the checked-in app package, independent of the
working directory and Astro's server-chunk depth. Keep `app/`, `contracts/` and
`ai/` together; copying `app/dist` alone is not packaged distribution support.
The Nix package/app remains deferred rather than claimed working.

## Verification

`just dashboard-test` exercises source/stage statuses, report corruption, partial
captures, pagination/path/origin guards, then builds and starts the actual Node
server on temporary loopback ports. Ten tests cover metadata APIs, selection,
escaped script-like labels, helpful empty/error states, no leaked key/path,
range/HEAD/416 handling, local conversion/reopen with unknown sync, excerpts with
nonzero offsets, unsafe/corrupt/missing media, a missing-FFmpeg failure, duplicate
concurrent conversions (200/409), and the 100-attempt history limit.
The server is deliberately started from another CWD to cover bundled asset paths.
`just check` includes these tests. No tests call Meta; fixtures are synthetic.

Observed browser checks use ephemeral Chromium from the locked nixpkgs, not an
added runtime/dependency requirement. The actual local calibration package was
listed/selected and its recorded date, six-second duration and validated report
displayed. M3.2 additionally observed native keyboard play, pause, numeric seek
to 0.250 seconds and the real pink beacon frame in its 3.200-second excerpt;
source offset displayed correctly. On an unknown-sync synthetic capture, the actual
preview button converted/reloaded, warning remained visible, and seek to 1.250
seconds succeeded. Desktop/mobile screenshots were inspected and the 390-pixel
viewport had no horizontal overflow. First programmatic play without a user
gesture was correctly blocked by Chromium; verification then used a real CDP
keyboard Space interaction, without disabling autoplay/browser sandbox protections.
These checks are development artifacts, not empirical model-detection or complete
M3 journey evidence. No new paid call was made.

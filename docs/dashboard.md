# Local session dashboard

The dashboard provides a session library, selectable metadata overview and local
video playback and explicit analysis controls. Finding/evidence navigation remains
the next M3 task. The CLI remains available for preparation/submission/report steps. Loading or
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

## Analysis controls and consent

With a session selected, scroll to **Analyze with Muse Spark**:

1. Choose source start and duration in seconds, then **Prepare locally — no upload**.
   The displayed initial range is explicit (at most the first 30 seconds by default);
   change it if needed. The server does not silently trim to fit a request. Measured
   synchronization and nonempty aligned telemetry are required; unknown-sync video
   can still be previewed without analysis. Preparation validates originals, converts
   the selected clip and saves its context. No key/network is needed for this step.
2. Review **Prepared upload**: actual source start, duration, video/context byte sizes,
   aligned observation count and preparation UUID. The player shows this excerpt.
   Source offsets can differ slightly from the requested trim due to real frame PTS.
3. Check **I consent to uploading…**, then **Analyze session — upload to Meta**.
   Only this action authorizes one paid `muse-spark-1.3` Standard-mode submission of
   the selected clip and correlated telemetry. Developer labels/observations can be
   sensitive: inspect your instrumentation before consent. Do not put a key in the
   page; load `MODEL_API_KEY` into the server environment before launch. A missing
   key disables Analyze but still allows local preparation/offline report recovery.
4. Wait for saved-stage status. After schema/evidence validation and upload cleanup,
   the server builds the offline report automatically, then the page reloads. A
   successful empty report, quarantine/review outcome and a failure remain distinct.
   A valid report is not proof that the game is bug-free. Finding details/navigation
   are still the next task.

Analysis caps are server-configured with `POSTPLAY_ANALYSIS_MAX_DURATION_MS`
(default 30,000, hard cap 120,000), video 20,000,000 bytes, context 96,000 bytes,
2,000 aligned observations and 4,096 output tokens. These are not a hard dollar
budget. Actual usage is saved in the analysis/report; monetary cost stays unknown
unless reported. Check Meta billing against the $150 project credit budget.
Requests use approved versioned prompts/schemas, `store: false`, no automatic
retries, requested one-hour upload expiry and attempted deletion. Cleanup is shown
separately; deletion/expiry is not guaranteed. See [submission/cleanup](session-analysis.md).

Actions use a synchronous HTTP request, **not a background queue**. While it is
pending, status polls every two seconds and only reads fixed saved-stage metadata:
upload intent → inference intent → saved response/validation → local reporting.
No made-up percentages or claims of internal model progress. One server-wide
in-process guard blocks simultaneous prepare/analyze/report operations for the same
session. The adapter's exclusive on-disk `analysis/` reservation blocks a second
submission to the same preparation across page reloads or server restarts. Run
one local server per library; different preparations in separate server processes
are not coordinated by a cross-process queue.

If the browser disconnects, **refresh status before doing anything else**. Closing
a tab does not cancel server work or remote spending. On restart, unfinished saved
attempts are labeled interrupted/unknown, not running/successful/clean. Failed and
reserved preparations are not resubmittable. Errors distinguish missing credentials,
Meta authentication, credits/quota, rate limits, transport uncertainty, bad model
output, media/telemetry validation and conversion. They contain fixed diagnostic
text, not raw provider bodies or model prose. Live invalid-key/offline tests are
not necessary for ordinary development; deterministic fixtures exercise them.

For a completed proposal without a final report, **Build saved report offline — no
upload** reuses its saved response; it never requests inference. Corrupt/partial
report files are preserved, not overwritten to force success. If deliberately
preparing another clip after a reserved latest attempt, explicitly acknowledge
that you inspected the previous outcome first, then separately consent before any
new paid action. Never delete a reservation to retry. No automatic paid retry or
reanalysis occurs when you refresh or reopen a report. Each new preparation remains
inspectable on disk, with dashboard creation capped at 100 preparation entries.

Production start uses Node's `--use-env-proxy`; development adds that flag to
inherited `NODE_OPTIONS` without discarding existing options. This honors the
server's standard proxy environment when needed for Meta. The key/proxy values are
never sent to browser code. Loopback binding and Astro origin protections remain
enabled; nothing should be exposed as a hosted service.

## Local API

- `GET /api/sessions?page=1`: selected public summaries, page/pages/total and ignored-entry count.
- `GET /api/sessions/SESSION_UUID`: one existing session summary; 404 if absent.
- `/?page=1&session=SESSION_UUID`: server-rendered list/selection; works without JavaScript.
- `GET`/`HEAD /api/sessions/SESSION_UUID/video?preparation=PREPARATION_UUID` (or `?preview=PREVIEW_UUID`): validated MP4 snapshot. Exactly one selector, no paths. Single byte ranges support native seeking (206); unsatisfiable/malformed/multiple ranges get 416. With `If-Range` and no stored validator the entire snapshot is returned.
- `POST /api/sessions/SESSION_UUID/preview`: explicit full-source local conversion/reuse; empty body, `Content-Type: application/json`, valid same-origin `Origin` required. Returns public video metadata and `remote_upload: false`; 409 for duplicate active conversion, 422 for invalid capture/conversion failure.
- `GET /api/sessions/SESSION_UUID/analysis[?preparation=PREPARATION_UUID]`: public state, exact prepared sizes/counts, credential-present boolean (never key), reservation/active flags, safe diagnostic and cleanup status. Read-only, no model call.
- `POST /api/sessions/SESSION_UUID/analysis`: same-origin JSON only, ≤1,024 bytes (including streamed body), exact validated fields. Actions below; no paths, provider URLs, key or model overrides accepted. Returns preparation UUID and whether this action uploaded, never raw model text. Errors use `{error: {code, message}}`, 400/413/415 invalid input, 409 active/reserved/review-required, 422 validation/provider/report failure.

```json
{"action":"prepare","start_ms":700,"duration_ms":3200,"reviewed_previous_attempt":false}
{"action":"analyze","preparation_id":"PREPARATION_UUID","upload_to_meta":true}
{"action":"report","preparation_id":"PREPARATION_UUID"}
```

These are illustrative request shapes; substitute a real canonical UUID. Preparation
and report actions are local-only; `upload_to_meta: true` is mandatory for Analyze.

The API never returns raw logs, raw model/proposal/request bodies, credentials,
server directory paths or borrowed file descriptors. Names/scene labels are
developer-provided metadata; Astro renders them as escaped text. UUID/path and
page validation precede file access. Symlinks/shared/special files are rejected
by the pinned-descriptor library. Nonlocal Host names and cross-origin requests
are rejected; responses use no-store, nosniff, no-referrer and frame-denial headers.
Preview, preparation, explicit analysis and offline report creation are write actions. Astro origin protections remain
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
server on temporary loopback ports. Seventeen dashboard/control tests cover metadata APIs, selection,
escaped script-like labels, helpful empty/error states, no leaked key/path,
range/HEAD/416 handling, local conversion/reopen with unknown sync, excerpts with
nonzero offsets, unsafe/corrupt/missing media, a missing-FFmpeg failure, duplicate
concurrent conversions (200/409), history limits, consent/body/origin/key guards,
mock paid action/report creation, concurrent session protection, actual persisted
progress, authentication/offline/invalid-output failures, interrupted reservations
and offline report recovery. Provider error bodies/credentials are not exposed.
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
M3 journey evidence. The M3.2 checks made no paid call.

### M3.3 real browser submission check (2026-11-02)

One separately planned real check used the existing measured calibration session
`aa2e6b72-7387-4a75-88f8-c8789f9051dd`. Historical preparations/stages were inspected
first; the earlier completed analysis was not repeated. Through the actual
production page, a new local preparation `271f5289-9b66-4258-b882-d4b277c09af4`
selected source 0.700–3.900 seconds (actual 3.200s, 19,381 video bytes, 1,738 context
bytes, two aligned observations of five raw records). Unchecked consent produced
zero Analyze requests; mobile width remained 390 pixels with no overflow.

After explicit checkbox consent, a double click produced **one** browser submission.
Observed saved-stage states were uploading → reasoning → validating → reporting →
finished. The real Muse response and offline report were saved: `analyzed_no_findings`,
zero accepted/quarantined findings. Meta reported 2,634 input + 552 output = 3,186
total tokens (430 reasoning tokens included in output). Monetary cost was not
returned (`null`), not estimated; upload deletion was confirmed (`deleted`). There
were no retries or additional live invalid-key/offline calls. Those error paths
are mocked in deterministic tests, including actual HTTP-rendered failure text.

The result page and consent screenshots were inspected. New and original reports
revalidated offline against source/stage provenance. Both analysis directories
still contain exactly 12 files; repeated submission is rejected with 409 and no
file/network changes. New report SHA-256:
`271bbf51d5139a2cdfecd721bbafcf1c33c711175762110430688a1ad4aa87de`.
This is a button-to-real-report compatibility check, **not** the six-session
bug-detection evaluation or the full finding-navigation M3 exit gate.

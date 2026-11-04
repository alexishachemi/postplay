# Local session dashboard

The dashboard provides a session library, selectable metadata overview and local
video playback, explicit analysis controls and finding/evidence inspection, with
distinct empty/review/error states and offline reopening. The complete journey
check remains the next M3 task. The CLI remains
available for preparation/submission/report steps. Loading or
refreshing this page **never uploads to Meta or starts a conversion/analysis job**.

Follow the [complete M3 walkthrough](dashboard-journey.md) for recording, matching
the two tools' library roots, measuring new captures, consent and owner review.

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
   A valid report is not proof that the game is bug-free. Open a finding below the
   player to inspect its evidence; see the next section.

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

A confirmed local preparation rejection (for example unknown synchronization or
an invalid clip range) focuses the error message above the form and restores the
previously enabled inputs/buttons. Correct the cause before explicitly retrying;
there is no automatic retry. For unknown synchronization, follow
[the measurement guide](synchronization.md), apply the measured alignment, then
refresh. A playable preview alone does not establish telemetry alignment.
Connection failures, concurrent-operation responses and remote analysis errors
keep the controls locked: use **Refresh status (no retry)** and inspect the saved
outcome before considering another action.

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

## Finding and telemetry inspection

The **Findings and evidence** section loads only an offline, fully revalidated
report. Original session/telemetry/media, preparation, model stages and saved report
must still agree. Missing, incomplete, unsafe or tampered evidence produces an
explicit unavailable/validation message, never synthesized findings or a clean
result. Loading this view makes no model request and writes no report/stage files.

Open a finding's native disclosure using click or keyboard (Space was observed in
Chromium). Its summary includes category, clip time/range, severity and model
certainty **as text**. Low/medium hypotheses are not demonstrated facts. Quarantined
claims remain visible but explicitly marked for human review, retaining their
original certainty/severity. In particular, a high-certainty model statement is not
promoted to a confirmed finding, and softlocks remain **suspected**.

Expanded details separate model claims (observed/expected behavior, explanation,
alternatives, proposed reproduction and limitations) from the original recorded
values. Expected behavior is qualified as a developer-provided expectation,
unverified observed precedent, or model inference. A referenced developer expectation
is displayed verbatim from its original registration; it is not proof of a defect.
Empty alternatives/steps/limitations are explicitly missing, not filled in.

Opening a finding pauses and seeks the **matching prepared clip** to its clip-local
start. The native player and numeric seek field update. Source-video time is
displayed separately as `source_start_ms + clip_ms`; that offset must **not** be
added when seeking the excerpt itself. An evidence video button seeks its own
timestamp. A telemetry anchor opens/focuses the exact referenced recorded event and
seeks its normalized clip time. The raw-event area filters/opens only the selected
finding's referenced events; video-only claims explicitly have no telemetry snapshots.
This is evidence navigation, not automatic verification of what a frame depicts.

The player must have this report's generated session/preparation URL. If it differs,
navigation refuses to guess another clip mapping. Before metadata arrives, only
the latest requested seek is held pending. There is no autoplay. Out-of-range
times are refused, not clamped; the v1 contract permits a reference at the exact
end boundary, where no decoded frame exists, so the UI explicitly discloses a
seek **1 ms earlier**. Browser/frame precision and synchronization uncertainty still
apply; no frame-perfect claim.

Referenced raw event JSON is rendered once per event, even across multiple claims.
Its original event ID, source/label, typed payload, wall elapsed time, simulation
time and process/physics frames are preserved. Clip/source video clocks are shown
separately. Scroll the bounded JSON panel to inspect all fields; unsupported-value
markers remain visible rather than being guessed into values. No arbitrary scene
tree or entire raw log is exposed. Report coverage/limitations remain inspectable.

All model/telemetry prose is escaped text. URLs/commands/HTML in it are not turned
into links, scripts or actions. DOM IDs/selectors and telemetry anchors use generated
numeric indices, not untrusted claim IDs. Video URLs are generated from validated
UUIDs, never a path supplied by the model. The current server key is also checked
against report content before this view renders. No public raw-stage or filesystem
endpoint was added. Without JavaScript, native details and event anchors remain
readable; automatic seek/filtering needs JavaScript, with displayed clip times as
the manual fallback.

### Try populated findings without paying for inference

The saved real calibration reports currently contain no supported findings. To
exercise populated/quarantined navigation without a new paid request:

```sh
nix develop
just inspection-fixture
# Read the generated session_root and session_id from its JSON output.
export POSTPLAY_SESSION_ROOT='/absolute/generated/session_root'
just app
# Open http://127.0.0.1:4321 and select the SYNTHETIC INSPECTION FIXTURE session.
```

The recipe creates a **new uniquely suffixed** library under `artifacts/` by
default; it does not overwrite a real recording or any earlier fixture. An optional
argument changes the output prefix; missing parent directories are created. FFmpeg creates a tiny
test pattern, and a mock fetcher creates explicitly synthetic proposal/report stages.
**No Meta calls occur and no API key is needed.** These are UI fixtures, not real
model responses, real bugs or empirical evaluation sessions. Do not click Prepare
and Analyze on this fixture to claim model performance. It is permanently labeled
synthetic in project metadata and model coverage text.

Its 1.200-second clip starts at source 0.500 seconds. The first finding seeks clip
0.300/source 0.800; its raw position event seeks clip 0.000/source 0.500 and records
Vector2 x=160/y=330, independently of the intentionally wrong unverified model prose
x=999. Video evidence seeks clip 0.600/source 1.100. A high-certainty low-severity
suspected-softlock claim is quarantined and references an unsupported-value payload.
The end-boundary example seeks 1.199 seconds with an explicit warning. Malicious-looking
strings in IDs/titles are deliberate safe-rendering fixtures, never executable HTML.

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
server on temporary loopback ports. Twenty-five dashboard/control/inspection tests cover metadata APIs, selection,
escaped script-like labels, helpful empty/error states, no leaked key/path,
range/HEAD/416 handling, local conversion/reopen with unknown sync, excerpts with
nonzero offsets, unsafe/corrupt/missing media, a missing-FFmpeg failure, duplicate
concurrent conversions (200/409), history limits, consent/body/origin/key guards,
mock paid action/report creation, concurrent session protection, actual persisted
progress, authentication/offline/invalid-output failures, interrupted reservations
and offline report recovery. Inspection tests cover raw snapshot/clock preservation,
nonzero offsets/end boundaries, missing/corrupt/symlink reports, key-echo refusal,
quarantine/independent severity-certainty and actual HTTP escaping of malicious claim
IDs/prose. Provider error bodies/credentials are not exposed.
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

M3.4 browser verification used the synthetic library without a key and observed
Space selection seek 0.300 (not source 0.800), telemetry anchor 0.000, video evidence
0.600, specific raw values/clocks, quarantine filtering, end 1.199, paused playback,
wrong-video refusal and inert malicious strings. A 487px mobile overflow was found
and fixed with a minimum-width constraint; 390px rerun passed. Desktop/mobile
screenshots were inspected. The initial Enter-only CDP sequence did not activate
the native summary; Space with a character event did. This is not a claim of
exhaustive keyboard/browser compatibility. Browser inspection sent zero POSTs and
made no paid request. Both genuine saved reports remain unchanged.

### Saved outcomes and disconnected reopening

The report heading distinguishes evidence-backed **hypotheses**, **No supported
findings**, and **Review required — no accepted findings**. All-quarantined reports
are not clean. Empty reports show model coverage and limitations expanded by
default, plus the exact analyzed clip duration/source offset. An empty result says
nothing definitive about the rest of a recording or game. Coverage prose is also
unverified model output, not a claim that all frames/events were understood.

**Report unavailable or validation failed — not a clean result** is separate from
an empty valid report. Analysis controls retain the saved failure stage and safe
error explanation; malformed/missing files are not silently repaired. A missing
report alone does not establish why an attempt failed. Do not delete reservations
or repeat paid inference to repair local report storage.

To exercise the states without Meta, select any outcome below. Each command creates
a separate uniquely suffixed library and prints its root and session UUID:

```sh
nix develop -c just inspection-fixture artifacts/ui-populated populated
nix develop -c just inspection-fixture artifacts/ui-empty empty
nix develop -c just inspection-fixture artifacts/ui-review quarantined
nix develop -c just inspection-fixture artifacts/ui-failed failed
nix develop -c just inspection-fixture artifacts/ui-malformed malformed
```

Set `POSTPLAY_SESSION_ROOT` to the printed root before starting `just app`. These
are explicitly synthetic mocked responses and generated test video, not real
analysis or evaluation results. The malformed mode intentionally corrupts only
its new synthetic report. Unknown mode names fail before creating a library.

For offline use, keep the original session package, prepared media, analysis stages
and findings together. Start the app while setup dependencies are available, stop
it, disconnect external networking, restart and reopen the same session URL. No
key, Godot editor or model service is required to read saved results. The local
Node server, FFprobe, original media and browser codec support are still required.
Loopback must remain usable; browser developer-tools “Offline” can block even
localhost and is not an appropriate whole-machine offline test for this local app.

Deterministic HTTP verification starts the built server twice in fresh processes
with no credential and a test-only preload denying all outbound Node fetch/TCP
connections (the hooks self-test before server startup). Populated, empty,
quarantine-only, failed and malformed reports remain distinct, saved video ranges
work, and hashes of every source/preparation/stage/report remain unchanged. This
isolates the app process; it does not disable the operating system's network or
claim a live Meta outage was tested.

Observed Chromium verification (2026-11-03) also reopened a synthetic empty report
and the genuine saved Muse report, then restarted the server and reopened the real
report again. Server fetch/TCP remained denied, no key was set, browser cache was
disabled, and CDP failed all non-loopback page requests. An explicit external fetch
probe failed on each page; local report rendering and video seek to 0.250 seconds
still worked. Expanded coverage was visible, screenshots inspected, zero POSTs
were sent, and all 12 stage/report files in each of the two genuine analyses kept
their original hashes. No paid calls were made. Screenshots are local ignored
artifacts under `artifacts/dashboard-check/outcome-{empty,real,real-restarted}.png`.
The first disposable browser harness passed assertions but hung in cleanup while
awaiting an already-signalled process; its process-state guard was corrected and
the complete run repeated successfully with exit 0 and its children stopped.

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

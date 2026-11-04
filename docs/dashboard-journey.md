# Record → analyze → inspect: M3 walkthrough

This is the supported checkout workflow for the current smoke demo. It uses the
editor toolbar, documented Just commands and dashboard controls—not internal
launch flags, test drivers or hand-edited session/report files. The smoke demo
is separate from [Relay Depot's three bug/clean pairs](demo.md). A valid empty result is expected
to be possible; do not manufacture a finding to complete this check.

**Owner update (2026-11-03):** M3 was approved after the owner's synchronization
and app checks, including one successful paid call. The preparation-time notes
below distinguish earlier separate automated checks from that owner confirmation.
M4 results are recorded separately in [the evaluation](evaluation.md).

**Earlier verification status:** the real capture, real browser submission and saved-report
review have been observed in separate checks, linked below. A fresh human run of
this entire walkthrough remains pending. This document does not approve the M3
owner gate or claim those separate checks were one uninterrupted human session.

## 1. Start with the same library on both sides

From the repository root:

```sh
nix develop
just install
export POSTPLAY_SESSION_ROOT="$PWD/recordings"
just editor
```

In Godot Project Settings, enable Advanced, add the String setting
`postplay/output_directory` with value `res://../recordings`, and save. This is
normal project configuration, not an edit to a captured package. PostPlay is
already enabled in this demo; for another game follow [installation](addon-integration.md).
Without this setting Godot writes under `user://`, which is **not** automatically
the dashboard's XDG default. Use the output root shown by the editor in both tools.

For visible-event timing in this smoke demo, add this public API call at the
start of the existing `_ready()` in `demo/main.gd`, then save:

```gdscript
PostPlay.watch_signal(beacon_activated, "Visible beacon activation")
```

This is optional game instrumentation, not a modification to the addon or signal
emitter. The stock M0 smoke scene does not install it automatically. Basic capture
works without it, but you need an observed event accompanying a visible change to
measure alignment reliably. Do not start another collector or use the legacy
`just record` path for this v1 walkthrough. No bug labels or answers are added.

## 2. Record and stop normally

Stop any existing game run, disable Multiple Run Instances, then click **Record
Session** in the editor toolbar. Use arrows to move, Space/Enter to activate the
beacon. Activate it at least three times, several seconds apart, during roughly
30–60 seconds of encoded gameplay. Watch its color flash and activation counter.
Movie Maker can run slower than wall time; judge the saved video, not a stopwatch.

Click **Stop PostPlay** (or Escape in this demo) and wait for completion. Avoid
native Stop/F8 or Force Stop for this normal-path check. Record the fresh UUID
and absolute output directory shown in the editor. Confirm the previous Movie
Maker toggle is restored. An incomplete capture is a failure to investigate, not
something to fix by changing its manifest status.

In a second terminal, use the same repository and root:

```sh
nix develop
export POSTPLAY_SESSION_ROOT="$PWD/recordings"
just sessions
just session-inspect YOUR_SESSION_UUID
just app
```

Replace `YOUR_SESSION_UUID` with the actual new UUID. Open the loopback URL printed
by Astro (normally `http://127.0.0.1:4321`). Refresh the library and select the
matching UUID; legacy `smoke-*` folders are not portable sessions. Choose **Create
local preview**, then play/pause/seek. Check HUD/framing and input responsiveness.
No key or upload is required for this step. Complete capture and unknown alignment
are different states; an unknown-sync warning here is correct.

## 3. Measure the visible-event alignment once, before preparation

Follow the [timing guide](synchronization.md). Read (do not edit) this session's
`events.jsonl` in a text viewer to find the watched beacon signal IDs and activation
counts. In the preview, find each corresponding first flash/counter change using
video-local time. Numeric Seek uses seconds; observations use milliseconds. Record
at least two well-separated matching events and an honest observer uncertainty.
Do not use elapsed wall time or reuse another capture's calibration numbers.

Create your own observations JSON file outside the package, for example
`recordings/beacon-observations.json`, containing the actual event IDs,
`video_ms` and `uncertainty_ms` described in the timing guide. This is a new
measurement input, not a hand edit to internal session metadata. Use a proper
frame viewer if you cannot bound onset uncertainty with the preview; do not claim
frame precision from a browser's approximate seek.

In the devShell, preview the measurement, then explicitly apply if correct:

```sh
just sync-measure "$POSTPLAY_SESSION_ROOT/YOUR_SESSION_UUID" "$PWD/recordings/beacon-observations.json"
just sync-measure "$POSTPLAY_SESSION_ROOT/YOUR_SESSION_UUID" "$PWD/recordings/beacon-observations.json" process_frame --apply
just session-inspect YOUR_SESSION_UUID
```

The supported command validates the mapping, saves the previous manifest and
measurement in an exclusive backup directory, and updates only synchronization
metadata. Never change `unknown` to `verified` yourself. Approximate/excessive
error must remain visible; investigate discrepancies rather than adjusting
measurements to force acceptance. Apply before creating analysis preparations,
because subsequent metadata changes invalidate their provenance. The existing
dashboard has no timing-measurement form; this supported CLI step is required.

## 4. Prepare locally, then separately consent to one paid request

Load `MODEL_API_KEY` into the **server's environment**, using your existing secret
mechanism. Never paste it into a browser or repository file. If it was not loaded
before starting Astro, stop/restart the app with the same session root and the
credential available. For the background development server use `just app-stop`;
run `just app` again. Refresh/reselect your session.

Under **Analyze with Muse Spark**, choose a bounded source start and duration
(seconds), covering several beacon activations. The default maximum is 30 seconds;
the recording may be longer, but only the chosen excerpt is analyzed. Click
**Prepare locally — no upload**. Check the resulting player clip, source offset,
actual duration, aligned-event count and video/telemetry upload sizes. Unknown
synchronization, empty aligned telemetry or invalid media must fail locally.

Only when satisfied, check upload consent and click **Analyze session — upload
to Meta** **once**. This is a paid remote request. Standard data-use mode is used;
one-hour expiry is requested and deletion attempted. Watch saved-stage status;
wait for the report or explicit failure. Do not refresh into another submission,
delete an attempt reservation, or create another preparation just to retry an
unknown remote outcome. Refreshing saved status is safe. A completed proposal
without a report can use **Build saved report offline — no upload**.

## 5. Inspect the actual outcome and reopen it

- **No supported findings:** read the expanded coverage/limitations and verify the
  exact analyzed window. It does not prove the game is bug-free.
- **Hypotheses:** open a finding; the matching clip seeks without autoplay. Check
  the claimed time, original referenced telemetry JSON/clocks, expected-behavior
  source, independent severity/certainty, alternatives and reproduction caveats.
- **Quarantined:** review separately; all-quarantined is not a clean result.
- **Error/invalid:** keep the failure distinct from a valid empty report. Preserve
  files and inspect status; do not spend again to repair local storage.

Check remote cleanup status; a failed/unknown deletion is not confirmed cleanup.
Usage is retained with the report; dollar cost may be unknown—check Meta billing.
Close Godot, restart the local app and reopen the same URL. With external network
disconnected (loopback still usable), video and saved report should remain usable
without a key. Do not enable browser “Offline” if it also blocks localhost.

## No-spend owner review of existing evidence

The retained calibration library is local/ignored and absent from fresh checkouts:

```sh
nix develop
export POSTPLAY_SESSION_ROOT="$PWD/artifacts/editor capture-mAGzwr/sessions"
MODEL_API_KEY= just session-inspect aa2e6b72-7387-4a75-88f8-c8789f9051dd
MODEL_API_KEY= just session-report-read aa2e6b72-7387-4a75-88f8-c8789f9051dd 271f5289-9b66-4258-b882-d4b277c09af4
MODEL_API_KEY= just app
```

Stop any earlier app before switching its root. Select the session and inspect
its real empty report/video. **Do not prepare or submit it again.** This confirms
saved-result inspection, not a fresh recording or empirical bug detection.

For finding navigation and nonempty/error states without paying, use the
[five synthetic fixture modes](dashboard.md#saved-outcomes-and-disconnected-reopening).
Open each fixture's printed library in a separately configured app. Label these
as fixtures; they are not findings from the genuine calibration video.

## Recorded evidence and remaining confirmation

| Check | Observed evidence | What it does not establish |
| --- | --- | --- |
| Editor capture and visible timing | M1.5/M1.6: actual Movie Maker captures/restoration and three calibrated beacon events; [timing audit](synchronization.md#reproduce-the-calibration) | A new human run of this walkthrough; calibration came from a test driver |
| Real dashboard analysis | M3.3: browser-selected source0.700s/duration3.200s, explicit consent, one real Muse response, saved empty report and confirmed deletion; [submission audit](dashboard.md#m33-real-browser-submission-check-2026-11-02) | A real detected bug or the M4 evaluation |
| Findings/evidence interaction | M3.4: observed browser click/Space seeking, exact raw-event snapshots, quarantine and escaping | Real inference; these populated candidates are synthetic |
| Empty/errors/offline | M3.5: five outcome fixtures and genuine saved-report/video reopening under application/browser outbound denial, including server restart; [offline audit](dashboard.md#saved-outcomes-and-disconnected-reopening) | An OS-wide unplug test or a live API outage |

The M3.6 owner confirmation should identify the session UUID, preparation UUID,
steps followed, actual outcome, playback/evidence-link behavior, any confusing
setup or manual edits needed, cleanup status and any untested step. If reviewing
existing evidence instead of making a new paid call, say so explicitly. The M3
exit gate remains the owner's decision; neither a mock nor a collection of older
checks is silently promoted to a new human end-to-end run.

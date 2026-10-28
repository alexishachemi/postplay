# PostPlay — Implementation Tasks & Progress

> **Source of truth:** [`PROJECT.md`](./PROJECT.md)  
> **Engineering instructions:** [`AGENTS.md`](./AGENTS.md)  
> **Owner:** Solo developer; implementation carried out by Codex

This document is the **human-readable record of what has been built, what has been verified, and what remains**. It translates the approved M0–M5 milestones in `PROJECT.md` into actionable tasks. It does not replace product requirements or authorize changing scope.

## 1. How to maintain this file

### Completion policy

1. **Before work or on resume:** Read the approved instructions and **Active Work** below first. If it names a resumable task, reconcile its checkpoint with Git changes and tests and continue that task; do not blindly select the next unchecked task. Choose new work only when no active task can proceed or the owner directs a change.
2. **Start checkpoint:** Before substantive code changes, populate **Active Work** with the task ID, status, objective, and exact next action. Do not mark the checklist item complete merely because work has started.
3. **During work:** Keep tasks unchecked while incomplete. Update **Active Work** after meaningful implementation or verification steps, new blockers, and before planned pauses; keep task-local notes for durable findings. An abrupt stop must not depend on a final-session update.
4. **After work:** Mark `[x]` only when its stated acceptance check has actually passed. Under the checked task, add concise, factual notes about **what was implemented**, **where**, **how it was verified** (command/result or observed behavior), and **how the owner can try it** if applicable. Include known limitations. Do not invent command output, API responses, or manual test results.
5. **Manual checks:** When an acceptance check requires a person to interact with Godot or the dashboard and Codex cannot perform that check, leave the relevant task/gate unchecked with `Awaiting owner verification` and exact reproduction steps. An implementation can be recorded as ready without marking its acceptance complete.
6. **Milestone status:** Update the summary table below to `Not started`, `In progress`, `Awaiting verification`, `Verified`, `Blocked`, or `Deferred`. `Verified` requires its milestone exit gate, not merely all code being written. Clearly labeled **optional** tasks do not prevent milestone verification when deliberately deferred.
7. **Problems and changes:** Record deviations, failed tests, unexpected costs, and fallback decisions in the decision log. Never silently lower an acceptance target, conceal a model miss/false positive, or edit `PROJECT.md` to match an implementation shortcut. Escalate changes to approved scope/architecture to the owner.
8. **Session handoff:** Before a planned stop, update the checkpoint and latest handoff with the exact next action, pending owner steps, and known limitations. If stopped unexpectedly, recover by comparing the checkpoint with Git and available test artifacts. Never assume unfinished edits were saved or that an interrupted API call failed.

### Example of a *completed* task entry (illustrative only)

```md
- [x] **M1.3 — Watch existing signals**
  - **Implemented:** Added signal subscriptions and JSON-safe argument serialization
    in `addons/postplay/...`.
  - **Verified:** Godot test run emitted a watched signal; event `evt-...` appeared
    once in `events.jsonl`. No duplicate event on a second scene launch.
  - **Try it:** Open the demo, start a session, trigger damage, then inspect
    the session's `events.jsonl` for the `damaged` event.
  - **Limitations:** Object-valued signal arguments are represented by safe labels.
```

Do not insert example results like these until they have actually occurred. The `Done when` and `Try` lines below describe **future tests**, not completed work. Replace or supplement them with actual outcome notes upon completion.

### Active Work — resumable checkpoint

**This is the first place Codex checks when asked to resume.** Maintain **one active task at a time**. Write the task ID and next action **before making substantive code changes**; update this short record at meaningful boundaries. The checklist below remains the source of **verified completion**, not this checkpoint.

- **Task:** None — M1.1 verified; next is M1.2 runtime collection lifecycle.
- **Status:** Ready for M1.2.
- **Last checkpoint:** 2026-10-28 — raw v1 contracts and cross-engine checks verified; final commit being prepared.
- **Objective:** Versioned manifest/event schemas, bounded Godot safe-value serializer, strict Node contract validation, documented clocks/status/IDs and deterministic cross-engine fixtures/tests.
- **Progress actually saved:** Three schemas and synthetic complete/incomplete packages under `contracts/`; bounded native Godot encoder/UUID helper; pure Node schema/JSONL/package/status validation; cross-engine tests; `just contract-test`; README and detailed raw contract guide. Existing M0/AI formats preserved.
- **Verification performed:** `nix develop -c just contract-test` passed six contract tests; `nix develop -c just check` passed 14 Node tests (including actual Godot encoder run), gameplay smoke, zero TypeScript diagnostics and build. Godot headless editor import exited 0. Initial vector test int/float expectations and async-capable AJV getSchema typings were corrected; tests rerun successfully. No API calls.
- **Files changed / artifacts to inspect:** `contracts/`, `demo/addons/postplay/safe_value.gd` and UID, `demo/tests/contract_test.gd` and UID, `app/src/server/session-contract.ts`, `app/tests/session-contract.test.ts`, `justfile`, README, TASKS.md. Planning files are now tracked in Git; earlier M0.1 local-exclusion note describes the historical state.
- **Next exact action:** Start M1.2 checkpoint, inspect committed contracts/serializer and implement unique session creation, append-only logging, flush/finalization and explicit interrupted-state handling. No runtime collector integration or real v1 capture is claimed yet.
- **Blockers / owner action:** None identified. M0 is owner-approved; M1 exit gate remains pending implementation and owner verification. No paid call needed.

When in progress, replace the placeholders with concise facts. **Do not put speculative claims here.** Distinguish completed implementation, tests actually run, and pending tests. A checkpoint may lag behind abrupt changes: on resume inspect staged/unstaged/untracked files, relevant commits, and test artifacts, then reconcile and update this section before continuing. Check for an existing output before repeating paid Meta API operations.

Once the task is verified, preserve its implementation/verification notes under its checklist entry, clear this active record to `None`, and update **Latest handoff**. If blocked or awaiting owner verification and work legitimately switches elsewhere, first preserve the pending state with the relevant task and handoff.

## 2. Current status and critical path

| Milestone | Priority | Status | Exit evidence |
| --- | --- | --- | --- |
| **M0 — Prove dependencies** | Critical | Verified | M0.1–M0.6 verified; owner explicitly approved exit gate on 2026-10-28 |
| **M1 — Capture a portable session** | Critical | In progress | M1.1 contracts verified; real capture/time-alignment exit evidence still pending |
| **M2 — Analyze end-to-end** | Critical | Not started | Actual model-backed validated report or explicit analysis failure, saved locally |
| **M3 — Review locally** | Critical | Not started | User can select a finding and inspect synchronized video + telemetry |
| **M4 — Controlled demo and evaluation** | Essential | Not started | Three buggy/clean pairs captured, analyzed, and honestly evaluated |
| **M5 — Polish and submission** | Essential; packaging optional | Not started | Reproducible setup, credible demo, submission assets; packaging status documented |

**Delivery strategy:** Build the smallest record → analyze → review vertical slice before elaborating the demo or dashboard. Start a **minimal test scene in M0** so video and the real model can be exercised immediately; expand it into the three-scenario game in M4. Do not wait until M4 to collect the first real clip. Reserve the final development margin for fixes and submission rather than optional features.

**Next task (only if no active work):** `M1.2` — implement runtime collection lifecycle using the verified v1 contracts. M0 exit gate is approved.

## 3. M0 — Prove dependencies and integration feasibility

**Goal:** Resolve the riskiest assumptions with minimal code and real tools/API calls. Do not build a polished UI first.

- [x] **M0.1 — Bootstrap the repository and mandatory Nix development shell**
  - **Deliver:** Root `flake.nix`/`flake.lock`; supporting expressions under `nix/`; devShell using the owner-supplied `nix/godot.nix` (inspect the actual function interface, don't replace it); pinned Godot, Node.js, JavaScript package manager, FFmpeg/FFprobe and necessary development tools. Select and lock a supported Godot 4.x version.
  - **Done when:** `nix develop` enters successfully and the actual Godot executable, Node, package manager, FFmpeg and FFprobe are available and report versions. No absolute machine-specific Nix paths or secrets in the store.
  - **Try:** From a fresh checkout with `nix/godot.nix` present, run `nix develop` and inspect tool versions.
  - **Dependency/blocker:** The owner must provide the real `nix/godot.nix` file; do not invent its contents or silently substitute `pkgs.godot`.
  - **Implemented:** `flake.nix`, `flake.lock`, initial `README.md`; preserved supplied Godot function unchanged. Selected npm bundled with Node 24. nixpkgs locked to `31ecbaca1bdefa45dffc409f0250bd8039ea0010`.
  - **Verified (2026-10-28):** `nix flake check --no-build` passed. `nix develop -c sh -c 'set -eu; command -v godot node npm ffmpeg ffprobe; godot --headless --version; node --version; npm --version; ffmpeg -version; ffprobe -version'` exited 0: Godot `4.7.2.stable.official.ed1daf0bf`, Node `v24.21.0`, npm `11.19.0`, FFmpeg/FFprobe `9.0.2`. Git and nixfmt included. Initial lock resolution needed narrowly escalated GitHub access; subsequent shell build succeeded.
  - **Limitations:** x86_64 Linux only, as supplied by the owner. Interactive Godot and recording remain separate checks. Planning files are locally excluded by `.git/info/exclude`; preserve that setting and keep this audit trail on disk.
- [x] **M0.2 — Establish minimal project structure and repository checks**
  - **Deliver:** Minimal Godot demo/addon folders and Astro/Node TypeScript app structure, JavaScript lockfile, ignored session/output/secret files, and runnable build/test scripts where applicable. Keep scaffolding small.
  - **Done when:** Godot project opens, the web app starts locally, initial TypeScript checks pass, and generated media/credentials are ignored by Git.
  - **Try:** Launch both skeleton applications from the devShell; inspect the web page and Godot project.
  - **Implemented:** `app/` strict Astro 7 + Node adapter + Tailwind 4 skeleton, exact dependencies and npm lock; loopback dev/production scripts; `demo/` Godot project with enabled loadable addon skeleton; `.gitignore` and initial run instructions.
  - **Verified (2026-10-28):** Inside `nix develop`: `npm --prefix app install --ignore-scripts --no-audit --no-fund` succeeded; `npm --prefix app run check` returned 0 errors/warnings/hints; `npm --prefix app run build` succeeded. `godot --headless --path demo --editor --import --quit` and `godot --headless --path demo --quit-after 2` exited 0. `npm --prefix app run dev` bound `127.0.0.1:4321`; Node fetch returned HTTP 200 and expected page text. `git check-ignore -v` confirmed caches/dependencies/secrets/session/media paths are ignored; npm lock is not ignored.
  - **Limitations / failures:** First install rejected TypeScript 7 (checker supports 5/6); pinned 6.0.3 and reran successfully. Some Nix invocations hit sandbox Unix-socket denial and were rerun with narrow escalation. Headless Godot and HTTP observed; interactive editor/browser appearance not manually observed. Scene and addon are placeholders, not capture functionality.
  - **Additional verification:** `npm --prefix app ci --ignore-scripts --no-audit --no-fund` passed from the committed lock. `npm --prefix app start` bound `127.0.0.1:4321`; Node fetch confirmed production HTTP 200 and expected content. Both test servers stopped. M0.3 subsequently replaces the scene placeholder; addon capture remains unimplemented.
  - **Owner-requested tooling follow-up (2026-10-28):** Added root `justfile`, `pkgs.just` in the existing devShell (lock and supplied Godot unchanged), and README command reference. Recipes cover app/demo/editor, unique recording directories, tests/check/build, Nix evaluation, media conversion/probing/timing, local smoke preparation and separately labeled paid analysis. Positional arguments are quoted; no shell interpolation of user-supplied paths.
  - **Follow-up verified:** `nix develop -c just --list` loads Just 1.58.0; `just --fmt --check`, `just check` (eight Node tests, Godot smoke test, zero TypeScript diagnostics, build), `just nix-check`, and `just demo --headless --quit-after 2` passed. `just app` produced expected HTTP 200, then `just app-stop` stopped that test server. Probe worked from the repo root and `app/`; timing recipe confirmed nine old-clip flashes. `just smoke-prepare ... 'artifacts/just-smoke local'` prepared 304 observations and 82,876 bytes with no upload; conversion succeeded on spaced paths. Explicit existing-output guard exits 1; added because this FFmpeg build's own refusal returned 0. Some Nix commands needed narrow escalation after socket denial. Editor, record, app-start and paid analysis recipes were dry-run only; no new interactive recording or paid call claimed. Outputs remain ignored under `artifacts/just-smoke local/`.
  - **Follow-up commit:** `dd8fb1f` (`justfile`, `flake.nix`, README); staged diff reviewed, working tree clean. No generated media or credentials committed.
- [x] **M0.3 — Create a tiny gameplay recording smoke scene**
  - **Deliver:** A minimal 2D scene with visible player input and an observable event; a small accompanying telemetry sample or probe. This becomes the seed for the demo, not a separate permanent product.
  - **Done when:** The scene can be played, the event can be triggered predictably, and a 30–120-second clip can be captured for testing.
  - **Try:** Move/interact in the scene and confirm the visible event is repeatable.
  - **Awaiting owner verification:** Implemented `demo/main.gd` with arrow movement, bounds, Space/Enter beacon activation and counter/0.5-s flash; optional smoke-only telemetry via `POSTPLAY_SMOKE_OUTPUT`. No automatic player or scenario labels. README documents safe unique movie filenames and the human check.
  - **Verified (2026-10-28):** `nix develop -c godot --headless --path demo --script res://tests/smoke_scene_test.gd` exited 0 with interaction, visible state, movement and boundary assertions. First test attempt failed GDScript type inference; corrected the scene variable and reran successfully. Two runs with `POSTPLAY_SMOKE_OUTPUT=.../artifacts/smoke-fixture` created distinct directories; Node assertions passed for valid JSONL, ordered IDs/times, one activation and clean end in each. These are deterministic fixtures, not captured gameplay or evidence of synchronization.
  - **Pending:** Human playability and actual 30–120-s capture. Probe has its own `smoke-1` shape, not M1 session contracts; synchronization remains unknown. No Movie Maker clip or conversion is claimed.
  - **Recovery commit:** `e7ab6d2`; tracked working tree clean after commit. Ignored fixture outputs remain locally; no recordings, secrets or model results committed.
  - **Owner verification (2026-10-28):** Owner successfully followed recording/conversion instructions and confirms correct playback and desired responsiveness. `recordings/smoke-01.avi` and `.mp4` both probe as 960×540, 30 fps, 104.033333 s; AVI MJPEG/PCM, MP4 H.264. Associated 1,050-event probe ends normally at simulation 104,025 ms, with nine beacon activations. M0.3 acceptance met; framing defect investigated separately under M0.4. Prior pending notes above describe the earlier handoff, now superseded.
- [x] **M0.4 — Validate Movie Maker and media conversion**
  - **Deliver:** A short Movie Maker capture, known recording settings/output path, conversion to playable browser-compatible MP4 using FFmpeg, and observations about capture speed/audio behavior. Probe the editor API needed for launch and restoration.
  - **Done when:** A human can play the scene while recording, output video exists, conversion succeeds, and the recording is playable; documented pass/fail for responsiveness and editor control.
  - **Try:** Record, stop, inspect the original file and play the converted MP4.
  - **Verified (2026-10-28):** Owner confirms interactive capture responsiveness and correct video playback. `nix develop -c ffprobe -v error -show_entries format=duration:stream=index,codec_name,width,height,r_frame_rate -of json recordings/smoke-01.avi` (and MP4 equivalent) confirms 960×540, 30 fps, 104.033333 s. Independently converted original with `ffmpeg -v error -n -i recordings/smoke-01.avi -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart artifacts/framing/reconverted.mp4`; full decode `ffmpeg -v error -i artifacts/framing/reconverted.mp4 -f null -` exited 0. Original AVI has PCM audio; scene has no intentional audio content.
  - **Framing defect and fix:** First decoded AVI and MP4 frames both crop out HUD, placing beacon at (760,64) instead of (760,330). No Camera2D exists. A pre-fix two-frame capture at requested 1920×1080 changed scene scale, confirming window-dependent framing (did not reproduce the exact original crop). Fixed demo with viewport stretch + keep aspect. Captures using `godot --path demo --resolution 1920x1080` and `960x540`, each with unique `--write-movie ... --fixed-fps 30 --quit-after 2`, now render identical full-frame 960×540 images (matching SHA-256 `235fd96f8a0885dfacc192584ba79ddf0afc8cefeed7d1f01589546ee3b64ca5`). Both viewed and HUD/beacon/bounds confirmed. Exact engine/compositor cause of old crop remains unproven; originals untouched. Godot smoke behavior regression passed.
  - **Timing evidence:** `nix develop -c node scripts/check-smoke-timing.mjs recordings/smoke-01.mp4 recordings/smoke-2026-10-28T22-04-14-ccf9e88303d7cf49/smoke-events.jsonl 760 64` passed: nine flashes begin at encoded frames 1120,1243,1549,1723,1897,1943,2387,2659,2847, exactly matching event process frames. Simulation/video differences 8.0–8.7 ms; uncertainty includes 33.3-ms frame resolution. Wrong crop coordinates (760,330) deliberately fail count check (0 vs 9), not false timing success. Measurement applies to these beacon transitions only, not a general clock map.
  - **Editor API:** `nix develop -c godot --headless --editor --path demo --script res://tests/movie_maker_api_probe.gd` exits 0: Movie Maker toggle/restoration assertions pass, movie-file setting exists, play/stop/status methods available. Emits engine RID/ObjectDB leak diagnostics on shutdown, including after waiting for editor initialization/scan; preserve this limitation. Actual addon-driven launch/failure restoration is still M1.5 acceptance work, not claimed here.
  - **Decision:** Continue Movie Maker, with fixed viewport in this demo and per-project framing verification. No external-MP4 fallback triggered. Rendering diagnostics and reconversion remain ignored under `artifacts/framing/`; no media uploaded or committed.
- [x] **M0.5 — Validate the credited Meta API with real video and telemetry**
  - **Deliver:** Minimal server-side request to Muse Spark using the short **actual gameplay MP4** plus timestamped telemetry, a structured-response schema, and a saved redacted request/result fixture. Check media limits, model availability, upload cleanup and reported cost/usage where possible.
  - **Done when:** A real response is received and locally parsed/validated. If API access is blocked, leave this task unchecked and record the blocker; do not count a mocked response as API validation.
  - **Try:** Run the documented smoke test with `MODEL_API_KEY`; inspect a redacted result without exposing the key or sensitive local paths.
  - **Implemented:** Server-only native fetch adapter uses Standard `muse-spark-1.3`, Responses `text.format` strict JSON Schema, no response storage, 4,096 output-token cap, no automatic retries, multipart upload with 1-hour expiry and DELETE in finally. Write-ahead per-run markers and exclusive artifact writes prevent accidental repeated inference. Preparation is capture-specific, not a general M1/M2 importer.
  - **Local verification:** Eight `npm --prefix app test` cases passed (schemas/references/times, request envelope, mocked valid empty response, API/incomplete/schema/cleanup failures, media cap and missing credentials). `npm --prefix app run check` returned 0 errors/warnings/hints after adding Node type definitions and returning typed validation result. Local preparation and FFprobe confirmed 30-s/30-fps 960×540 clip; normalized context validated. No fixture is represented as real API evidence.
  - **Real verification:** `nix develop -c node --use-env-proxy app/scripts/meta-smoke.ts analyze artifacts/meta-smoke-001 --upload-to-meta` exited 0 after one live response; `muse-spark-1.3` accepted MP4 plus context and strict v1 output schema. Saved proposal validates with zero findings and explicit crop/coverage/timing limitations. Upload returned expiry and DELETE returned `deleted: true`. Usage 21,837 input (0 cached), 1,382 output (1,196 reasoning), 23,219 total tokens. Calculated ~$0.03317 from official rates; API did not return billed dollar amount. No live retries or extra model calls.
  - **Recovery / replay:** Repeating the same analyze command exits 1 with EEXIST at `run-started.json` before remote operations. Full redacted request/result/proposal/validation/usage/cleanup and provenance retained locally under ignored `artifacts/meta-smoke-001/`; inspect before any further paid work. Build passed. `docs/verification/m0-meta-smoke.md` records reproducible commands and limitations without committing private payloads or media.
  - **Commit / privacy check:** `a8aa2bc`; staged diff reviewed and clean. Credential-absence assertions passed for staged file contents and saved run JSON; artifacts/recordings are ignored and no secrets/media were committed.
  - **Limitations:** Empty finding result is a valid compatibility outcome, not evidence for bug-detection accuracy. Capture-specific preparation is not general ingestion; final report grounding and budget UX remain M2. Original crop remains explicit. Remote-error and cleanup-failure paths were mocked, not induced with extra paid calls.
  - **Build correction:** A final build attempt triggered optional Astro telemetry and was blocked by the network allowlist. Set documented `ASTRO_TELEMETRY_DISABLED=1` in dev/check/build scripts; rerun build exited 0. No project network permissions changed.
- [x] **M0.6 — Record the recording/API feasibility decision**
  - **Deliver:** A short conclusion in the decision log: Movie Maker usable or external-MP4 fallback; Meta API usable or blocker; proven formats and limits; immediate next steps.
  - **Done when:** Evidence for the choice is linked and the owner can assess it. A fallback must preserve telemetry/video alignment and the approved analysis goal.
  - **Verified:** `docs/verification/m0-meta-smoke.md` links actual capture, timing, conversion, real strict-schema API response, usage and cleanup evidence. Continue Movie Maker and Muse Spark; no fallback triggered. M0 owner gate was left unchecked during implementation and explicitly approved by owner on 2026-10-28 (gate record below). Next: raw portable contracts, then runtime addon work. SAM and distribution remain optional/secondary and unstarted.

**M0 exit gate — owner verification**

- [x] Confirm the Nix shell works with the supplied custom Godot package, the gameplay clip is playable, and a **real** model response has been produced (or flag a blocker rather than claiming success). Confirm the Movie Maker go/no-go decision.
  - **Owner approval (2026-10-28):** After clarifying that the real Muse response (including a valid empty proposal) satisfied the API requirement, owner stated: "I'm satisfied. Mark M0 as aproved and move on to the next task." Gate approved by owner, not inferred from automated checks.

## 4. M1 — Godot addon and portable session capture

**Goal:** A Godot developer can create a usable session without any web dashboard. The addon operates even with no optional instrumentation.

- [x] **M1.1 — Define and test versioned session/event contracts**
  - **Deliver:** Documented `session.json` and `events.jsonl` shapes, stable session/event IDs, typed safe-value encoding, schema versions, relative media paths, supported time/frame fields, status transitions and representative fixtures.
  - **Done when:** Automated checks cover round-trip serialization, unsupported values, malformed records, bounded payloads, and incomplete sessions. No absolute path is embedded in a portable session.
  - **Try:** Open a sample session directory and read its manifest/events without PostPlay running.
  - **Implemented:** `contracts/{session,event,safe-value}.v1.schema.json`, human-readable contract guide, synthetic complete/incomplete packages; native Godot safe-value encoder and UUID v4 helper; pure typed Node validators/JSONL serialization and cross-record checks; `just contract-test`. No session writer or runtime observer integration is claimed yet.
  - **Verified:** `nix develop -c just contract-test` passed six tests, including actual pinned Godot serialization consumed by Node. `nix develop -c just check` passed all 14 Node tests, gameplay regression, zero TypeScript diagnostics and build. `nix develop -c godot --headless --path demo --editor --import --quit` exited 0, generating tracked UIDs. Tests cover JSON round trips, vectors/scalars/tag collisions, unsupported/freed objects, non-finite/unsafe numbers, cycles and depth/item/node/UTF-8 byte limits; malformed schema/paths/UTC dates, clock regressions across null gaps, IDs/registration/source/count/anchor invariants and incomplete-state diagnostics.
  - **Decisions:** Raw versions are independent of AI contract versions; UUID v4 session identity, contiguous evt-N event sequence and stable session-local reg-N/src-N IDs. Keep wall/simulation/process/physics clocks separate and synchronization unknown until an explicit measured anchor exists. Dictionary wrappers avoid tag collisions; unsupported values are markers, not null. Bounds: depth 6, 256 logical values, 64 items, 1,024-character strings, 8 KiB payloads, 16 KiB event lines, 256 KiB manifests, 10,000 events / 16 MiB logs. Details and source APIs in `contracts/README.md`.
  - **Failures corrected / limitations:** First run had 13/14 passing tests because Godot dictionary equality distinguishes numeric variant types; corrected vector test expectations. Type check caught async-capable AJV lookup typing; switched to synchronous compile-time validators. Node validates declared contracts and lexical paths, not actual media files/symlinks or visual synchronization; those remain M1.6/M2.1. Fixtures contain no media and demonstrate no model performance. Original M0 probe data is unchanged. No paid call made.
- [ ] **M1.2 — Implement runtime collection lifecycle**
  - **Deliver:** Godot runtime component that creates/receives a session ID, writes append-only events, flushes cleanly, and preserves partial outputs on interruption where practical. Store UTC start time, frame/simulation timing and capture/debug metadata.
  - **Done when:** Two separate runs produce distinct session directories with coherent manifests/events; premature exit is recognizable, not silently reported as a completed recording.
  - **Try:** Launch/stop twice and compare folders; deliberately interrupt one run to inspect its status.
- [ ] **M1.3 — Watch existing signals and properties**
  - **Deliver:** Documented `watch_signal` and `watch_property` API with expectation labels/descriptions, observed argument/property values, safe serialization, stable object labels, configurable bounded sampling, and safe disconnection/cleanup.
  - **Done when:** Existing game signals are recorded without modifying their emitters; property changes appear with useful times/values; freed objects and unsupported property values do not crash capture.
  - **Try:** Register a damage signal and resource/HUD properties, trigger a change, and inspect the corresponding entries in `events.jsonl`.
- [ ] **M1.4 — Collect generic input, position, and optional semantic context**
  - **Deliver:** Best-effort selected input/action observations, sampled player positions, optional player/play-area/progression annotations, and collision-debug enabled flag. Document capture limitations and avoid raw typed text.
  - **Done when:** Demo actions and movement appear with bounded data rates; a zero-annotation session still records; semantic annotations improve context without supplying hidden bug labels.
  - **Try:** Move/interact for a short period, then inspect input, position and annotation records.
- [ ] **M1.5 — Add the editor-side Record Session workflow**
  - **Deliver:** Enable/disable-able `EditorPlugin` with an obvious Record action, unique output directory, pre-launch Movie Maker configuration, stop/finalize behavior, setting restoration and understandable errors. Do not overwrite prior sessions.
  - **Done when:** A fresh run creates a recording plus telemetry and restores previous editor state even after a failed/aborted run where practical.
  - **Try:** Record twice, verify both videos/files exist, and check subsequent normal Godot runs are not unintentionally recorded.
- [ ] **M1.6 — Align telemetry and video time; support fallback import**
  - **Deliver:** Frame/simulation-time-based mapping to video-local timestamps with an explicit start anchor/offset; conversion offsets where relevant; an external-MP4-with-telemetry path if the Movie Maker fallback is triggered. Flag unknown synchronization instead of guessing.
  - **Done when:** An observable event aligns with the displayed recording within about **0.5 seconds** in the smoke scene; an invalid/missing anchor is reported clearly.
  - **Try:** Trigger a distinctive on-screen interaction, seek its video frame, and compare its telemetry timestamp. Record the measured error.
- [ ] **M1.7 — Document addon integration and test the basic/no-annotation path**
  - **Deliver:** Minimal install/enable instructions and API examples for signal/property watching; recording without custom hooks remains possible.
  - **Done when:** A fresh Godot project can enable the addon and record a basic session with documented prerequisites and limitations.
  - **Try:** Follow the instructions in a clean test project, first without annotations and then with one watched signal.

**M1 exit gate — owner verification**

- [ ] Record one complete real session (video + telemetry), repeat without overwriting, confirm settings restoration, and verify visible-event synchronization with its measured error.

## 5. M2 — AI analysis pipeline and evidence-grounded reports

**Goal:** Given a saved session, the local backend produces a trustworthy, persistent structured result or an explicit failure.

- [ ] **M2.1 — Import, validate, and inspect sessions safely**
  - **Deliver:** Node/TypeScript code to find/import allowed local session directories, validate schemas and referenced media files, probe duration/fps, and reject malformed paths/invalid session states. Support configurable writable local storage.
  - **Done when:** Valid fixtures load; missing files, unsupported schemas, path traversal attempts and partial sessions produce actionable error states rather than crashes.
  - **Try:** Open a valid session and a deliberately damaged copy; compare the reported diagnostics.
- [ ] **M2.2 — Normalize media and telemetry for inference**
  - **Deliver:** Deterministic FFmpeg conversion to suitable MP4; bounded telemetry context with descriptions, event IDs, ordered timestamps, watched values, and optional annotations. Preserve linkable provenance and avoid leaking ground-truth bug modes.
  - **Done when:** Original files are unchanged, prepared MP4 plays, summary size/duration caps work, and a referenced telemetry event can be located in the original log.
  - **Try:** Inspect the prepared analysis request/media for one short captured session.
- [ ] **M2.3 — Define versioned Muse prompts and machine-validated result schemas**
  - **Deliver:** Versioned AI instructions and structured schema for findings, observed/expected behavior and its source, severity, qualitative certainty, timestamp range, evidence IDs/times, alternatives, limitations, reproduction steps, and valid zero-finding outcome.
  - **Done when:** Fixture tests accept a properly grounded finding and `findings: []`, and reject malformed, out-of-range, or missing-evidence reports. Prompts explicitly consider benign explanations and avoid fabricated certainty.
  - **Try:** Inspect the prompt/schema files and run the repository's schema validation tests.
- [ ] **M2.4 — Integrate Muse Spark and control remote data/costs**
  - **Deliver:** Server-only Meta API adapter using environment credentials, explicit user-requested analysis, clip limits/budget controls, bounded errors/retries, upload cleanup or expiry, and recorded model/prompt versions plus available usage/cost metadata.
  - **Done when:** A real saved session can be submitted and yields a structured response; API/network/credit failures are distinguishable; credentials never appear in client output or committed files.
  - **Try:** Analyze a short session with a real key and inspect the redacted run metadata; test a deliberately invalid key without incorrectly showing a clean report.
- [ ] **M2.5 — Ground findings in real evidence and save results**
  - **Deliver:** Validate every model-referenced event/time against session data; preserve explicit uncertainties, avoid invented event values, and distinguish `analyzed/no findings` from `failed`. Save `findings.json` plus nonsecret analysis metadata with schema version.
  - **Done when:** A report can be reopened offline; invalid references are rejected or visibly flagged, not passed off as high-certainty evidence; repeat analyses don't silently overwrite original recordings.
  - **Try:** Read a finding's event IDs/times against `events.jsonl` and the video; reopen the saved result without network access.
- [ ] **M2.6 — Run an end-to-end analysis smoke test**
  - **Deliver:** One real demo session processed from captured files through validation, conversion, Meta request and saved report, with logs for each stage.
  - **Done when:** The pipeline produces a schema-valid stored report (including a valid empty report). Failures must remain truthful and diagnosable, but do **not** satisfy this completion check. No scenario-specific detections or hidden answer labels are hardcoded.
  - **Try:** Run the documented local analysis command/action on a session; inspect the result and stage logs.

**M2 exit gate — owner verification**

- [ ] Confirm one real API-backed report is stored and can be inspected offline, and a failed API call is visibly different from a valid `findings: []` outcome.

## 6. M3 — Local dashboard and report review

**Goal:** A developer can understand exactly why PostPlay raised a concern and inspect the supporting gameplay.

- [ ] **M3.1 — Build the local Astro dashboard shell and session list**
  - **Deliver:** Astro + Tailwind app with Node-backed local endpoints, loopback-only default, a simple session list and recorded/processing/analyzed/failed statuses.
  - **Done when:** A recorded session appears with identifying metadata and duration; an empty library has a helpful state; no remote account/service is required.
  - **Try:** Start the app from `nix develop`, open its local URL, and select a session.
- [ ] **M3.2 — Play recorded media and display timing/context**
  - **Deliver:** Browser-compatible media endpoint/player with seek controls, session duration and synchronization warning if applicable; no arbitrary filesystem exposure.
  - **Done when:** The MP4 plays locally and seeks to a requested video-local timestamp; missing media gets an actionable message.
  - **Try:** Open an imported session, play, pause and seek to a known recorded interaction.
- [ ] **M3.3 — Expose explicit analysis controls and status/error feedback**
  - **Deliver:** Analyze button, user notice about remote Meta upload, status/progress feedback, duplicate request guard, and readable API/conversion/validation errors. Keep secrets server-side.
  - **Done when:** One click triggers a real analysis, repeat clicks don't start duplicate jobs, and errors are distinguishable from success/no findings.
  - **Try:** Analyze a session, then test offline/invalid-credential behavior.
- [ ] **M3.4 — Present actionable findings with evidence navigation**
  - **Deliver:** List of category/title/timestamp/severity/certainty; detail view of observed vs. expected behavior, evidence (including telemetry links), alternative explanations, limitations and proposed reproduction steps.
  - **Done when:** Selecting a finding seeks the video near its timestamp and displays the specific supporting telemetry event(s); certainty is conveyed in text, not color alone.
  - **Try:** Click a saved finding and independently inspect video and event-log evidence.
- [ ] **M3.5 — Handle clean reports, invalid findings, and offline reopening**
  - **Deliver:** Clear `No supported findings` state with coverage/limitations; report-validation errors rendered separately; cached/saved reports viewable without fresh model calls.
  - **Done when:** Fixtures exercise populated, empty, failed, and malformed reports; a saved valid report opens while disconnected.
  - **Try:** Load the supplied fixtures and disconnect network access before reopening a previously analyzed session.
- [ ] **M3.6 — Verify the complete user journey in the dashboard**
  - **Deliver:** A documented test run linking addon recording, session import, analysis, saved report and manual review.
  - **Done when:** A human can finish the record → analyze → inspect workflow without editing internal files or invoking ad hoc developer scripts.
  - **Try:** Follow the user journey in `PROJECT.md` §3 using the demo smoke scene.

**M3 exit gate — owner verification**

- [ ] From a normal browser session, choose a recorded session, run analysis, inspect a finding in the video/telemetry, and distinguish the clean and error states.

## 7. M4 — Demonstration game and empirical evaluation

**Goal:** Show that PostPlay can detect three *different* bug categories without being told which scenario is broken, and avoid confident false alarms in clean sessions.

- [ ] **M4.1 — Flesh out the small 2D demo and instrumentation**
  - **Deliver:** Short, readable game loop with repeatable interaction, resource UI, boundaries and progression; controlled developer-only buggy/clean toggles; optional watched signals/properties/semantic context using the **public addon API**.
  - **Done when:** All scenarios are playable with consistent presentation and controls, and the collected input/telemetry never contains scenario toggles, expected finding labels, or other hidden ground truth.
  - **Try:** Play the game with logging and inspect the resulting AI-bound context for accidental labels.
- [ ] **M4.2 — Scenario A: resource UI fails to synchronize**
  - **Deliver:** Buggy mode where the authoritative resource changes but the HUD does not update correctly, plus equivalent clean mode. Capture relevant property/signal observations and explicit expectation text.
  - **Done when:** The mismatch can be visibly reproduced and is supported by telemetry; the clean mode updates promptly.
  - **Try:** Trigger the resource change in both modes and compare display to logged authoritative value.
- [ ] **M4.3 — Scenario B: player moves out of bounds**
  - **Deliver:** Reproducible escape through a collision flaw, plus a clean boundary. Record positions and optional declared play bounds; debug collision overlay may be used as context but is not required for proof.
  - **Done when:** The player visibly leaves a defined playable area in the buggy mode and stays inside in the clean mode, with evidence linked to player positions.
  - **Try:** Attempt the same movement in both modes and inspect positions/video.
- [ ] **M4.4 — Scenario C: suspected softlock after interaction**
  - **Deliver:** An interaction/state sequence that traps progress under reasonable attempts, plus a clean way to continue; record attempts and progression/state observations.
  - **Done when:** The buggy recording supports a **suspected** softlock without relying merely on player inactivity; clean mode can proceed normally.
  - **Try:** Trigger the trap, attempt available actions, compare with the clean interaction, and inspect telemetry.
- [ ] **M4.5 — Capture and analyze six independent evaluation sessions**
  - **Deliver:** At least one actual recorded **buggy and clean** session for each scenario, approximately 30–120 seconds each; separate ground-truth/evaluation notes not supplied to the models; model output and run metadata retained.
  - **Done when:** All six sessions use the same real recording/analysis pathway and each has a real report (possibly empty). API failures must be documented and retried deliberately or left as unfinished coverage, never counted as a successful evaluation. No handwritten idealized reports substitute for model output.
  - **Try:** Open the six reports; verify scenario modes are absent from AI input.
- [ ] **M4.6 — Evaluate detection quality, certainty, and synchronization honestly**
  - **Deliver:** Human-readable evaluation table for all six sessions (expected behavior, actual findings, evidence/timestamp quality, misses, false positives, limitations, and API usage where available). Test visible event alignment, targeting about **0.5 s**.
  - **Done when:** Results transparently show whether each of the three bugs was detected and whether **any** clean control produced a high-certainty false positive. Report real misses/false alarms; do not fabricate success or make deterministic detectors read hidden modes.
  - **Try:** Follow a representative finding to its video time and telemetry event, then inspect clean results for unjustified claims.
- [ ] **M4.7 — Optional: test targeted SAM 3.1 evidence**
  - **Deliver:** Only if time and API credits remain: run SAM on a specific useful visual question (for example player tracking during out-of-bounds movement), save track geometry/frame references, and assess whether it improves evidence.
  - **Done when:** A concrete added benefit is demonstrated and traceable; otherwise document the experiment and leave SAM optional/disabled. Never block the core MVP on this task.
  - **Try:** Compare evidence with/without tracking for the same segment.

**M4 exit gate — owner verification**

- [ ] Review the six-session evaluation, confirm the demo's three defects/controls really behave as described, and assess the target of three actionable bug detections with **zero high-certainty false positives** on the clean controls. If a target is missed, keep the result explicit and decide whether to improve prompts/instrumentation or accept the limitation; do not silently certify success.

## 8. M5 — Polish, reproducibility, and submission

**Goal:** Make the working prototype reviewable by a judge and avoid late changes that compromise the demonstration.

- [ ] **M5.1 — Complete installation, usage, and troubleshooting docs**
  - **Deliver:** `README.md` with requirements, Nix `nix develop` workflow, practical non-Nix Godot/Node/FFmpeg setup, `MODEL_API_KEY` setup without storing secrets, addon usage, video capture/fallback, demo scenario instructions, and dashboard operation.
  - **Done when:** A fresh developer can follow the documented path to record, analyze and review a session without undisclosed manual setup.
  - **Try:** Follow the README from a clean checkout/environment; log any missing instructions.
- [ ] **M5.2 — Run regression, failure-path, and privacy checks**
  - **Deliver:** Tests for serialization, synchronization, report validation, errors, repeat recordings, clear no-finding states, local-only server binding, safe import paths, absence of leaked API keys, and upload deletion/expiry behavior. Inspect normal and interrupted sessions.
  - **Done when:** All claimed test commands pass, remaining failures are documented, and no known critical issue blocks the main demo. Don't claim full compatibility testing beyond the pinned environment.
  - **Try:** Follow a short smoke-test checklist from record through review; exercise at least one failure.
- [ ] **M5.3 — Prepare a reliable judge-facing demonstration and submission**
  - **Deliver:** Concise demo script, pre-recorded reproducible sessions/reports (without misrepresenting their origin), screenshots or demonstration media, and submission instructions/assets required by the participant portal. Confirm portal-specific rules/deadline/platform requirements.
  - **Done when:** The demo can show a true end-to-end flow and a clean control, with limitations and Meta-model roles explained accurately; required submission materials are ready.
  - **Try:** Rehearse from the README using the prepared scenario and open the resulting evidence links.
- [ ] **M5.4 — Secondary: package the local dashboard using Nix**
  - **Deliver:** If time permits, `packages.default` and `apps.default` so `nix build` builds the local server and `nix run` launches it, with bundled/resolved FFmpeg and writable XDG-compatible data storage outside `/nix/store`.
  - **Done when:** Both commands work from a clean checkout without relying on undeclared global executables; server binds to loopback by default. Otherwise mark `Deferred` with the working devShell launch path.
  - **Try:** Run the packaged server and load a saved session in the browser.
- [ ] **M5.5 — Optional: distribute the Godot addon as a ZIP via Nix**
  - **Deliver:** If still low-risk, `packages.godot-addon` producing a ZIP with `addons/postplay/` and no unrelated project files. No NixOS module, service, or custom installer.
  - **Done when:** `nix build .#godot-addon` yields an archive that installs and enables in a clean Godot project without Nix. Otherwise mark `Deferred`.
  - **Try:** Extract archive into a test game's root and enable the plugin.

**M5 exit gate — owner verification**

- [ ] Approve the final reproducible demo, README, known limitations and hackathon submission assets. Record whether secondary dashboard packaging and optional addon ZIP were delivered or explicitly deferred.

## 9. Decision log, blockers, and owner handoff

Maintain this section whenever an implementation decision changes the path forward. The approved fallbacks below are **options**, not evidence that a fallback has been triggered.

| Topic | Current position | Trigger for revisiting | Actual decision/evidence |
| --- | --- | --- | --- |
| Video capture | Godot Movie Maker first | Unusable responsiveness, launch integration, or synchronization | **M0.4:** owner confirms responsive recording/playback; measured nine matching beacon frames. Continue with demo viewport fix; full addon orchestration remains M1.5 |
| Recording fallback | External MP4 + explicit sync anchor allowed | Movie Maker gate fails | **Not invoked** |
| Model reasoning | Muse Spark required, AI-first | API access/media/schema limits or evidence quality | **M0.5:** one real MP4+telemetry strict-schema response validated with zero supported findings; Standard mode, deletion confirmed; compatibility demonstrated, detection quality unevaluated |
| SAM 3.1 | Optional evidence tool | Core pipeline works and tracking clearly helps | **Not evaluated yet** |
| Backend/data | Astro + Node/TypeScript; local JSON/JSONL | Concrete implementation blocker requiring architecture change | **No change approved** |
| Dev environment | `nix develop` using supplied `nix/godot.nix` | Actual function compatibility issue | **M0.1 verified:** supplied Godot 4.7.2 launcher works; Node 24/npm selected; locked nixpkgs; x86_64 Linux |
| Dashboard distribution | Secondary Nix package/app | Core demo complete and time remains | **Not started** |
| Addon distribution | Optional Nix ZIP | Core demo and documentation complete | **Not started** |

### Open blockers / questions for the owner

- No current setup blocker; supplied `nix/godot.nix` inspected and shell verified in M0.1.
- M0.5 credential prerequisite resolved by owner; key remains server-side and uncommitted. M0 exit gate explicitly approved by owner on 2026-10-28.
- Confirm any participant-portal-specific hackathon requirements during `M5.3` (earlier if a requirement changes the MVP).

### Latest handoff

- **Last completed task:** M1.1 portable session/event contracts and bounded serialization, following owner approval of M0. Prior tooling commit `dd8fb1f`; real API smoke `a8aa2bc`.
- **Next recommended task:** M1.2 runtime collection lifecycle; write active checkpoint before editing. No repeat paid smoke needed.
- **Pending owner verification:** M0 approved by owner on 2026-10-28. Future M1 exit gate remains unchecked; do not infer integrated capture approval from M0 evidence.
- **Known failures / deferred work:** Old crop disclosed to model; headless editor probe shutdown leak diagnostics remain. Initial M0.5 Node type/return-type errors corrected before live call. No extra live error tests or six-session evaluation performed. Optional SAM and distribution packaging remain unstarted.

---

*This file is a progress record, not a source of synthetic test results. When reality differs from the plan, record what happened and request approval for changes to `PROJECT.md` rather than rewriting history.*

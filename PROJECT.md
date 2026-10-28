# PostPlay — Project Specification

## 1. Overview

**PostPlay** is a local, AI-assisted playtesting tool for indie game developers. It analyzes a recorded gameplay session together with structured runtime telemetry to identify **potential technical bugs and softlocks**, then generates timestamped, evidence-backed findings with explanations and suggested reproduction steps.

A Godot addon records gameplay and instruments existing game signals, properties, inputs, and optional semantic context. A local Astro dashboard lets the developer analyze sessions and inspect the resulting reports. **Meta Muse Spark** performs the primary multimodal reasoning; **Meta SAM 3.1** is an optional visual-tracking tool used when it can provide useful additional evidence.

**MVP success statement:** A developer can record a short session in the supplied 2D Godot demo, analyze it through Meta Model API, inspect actionable findings for three intentionally introduced bug categories, and run clean sessions without high-certainty false alarms.

### Constraints

- **Schedule:** approximately seven effective development days, preserving time for debugging and submission.
- **Submission:** November 4, 2026, 9:00 PM US Eastern (November 5, 03:00 CET). Confirm any changes and full rules in the participant portal.
- **Team:** one developer; Codex implements the codebase.
- **Platform:** Linux-first for the local dashboard/backend; Godot 4.x addon and demo. Other operating systems are out of MVP scope unless official hackathon rules require them.
- **Budget:** $150 in participant-provided Meta Model API credits; costs must be visible and controllable.
- **Data:** local-first storage; model analysis requires uploading selected session media/telemetry to Meta.
- **Development environment:** Nix flake with an essential, reproducible `devShell`; reuse the owner-provided Godot derivation from `nix/godot.nix`. Packaged distribution outputs are secondary to the hackathon MVP.

## 2. Users, problem, and boundaries

**Primary user:** A solo or small-team Godot developer debugging their own game.

**Problem:** Manual playtesting and reviewing recordings are time-consuming. Video alone often cannot reveal whether a suspicious interaction contradicts the game's internal state. Raw logs alone rarely explain what the player experienced.

**Value proposition:** Combine what the player **saw and did** with what the game **reported internally**, then produce inspectable hypotheses rather than opaque AI assertions.

### In scope (MVP)

1. Editor-initiated post-session recording of a small Godot game.
2. Runtime telemetry: selected inputs, registered signals, watched properties, and optional semantic annotations (for example player identity, play area, progression events).
3. A portable, versioned session format with video/telemetry synchronization.
4. A local dashboard to open completed sessions, initiate AI analysis, view findings, and jump to relevant video timestamps.
5. Muse Spark AI-first analysis of video **and** telemetry, returning structured findings or an empty findings list.
6. Three demonstrable bug categories: UI/state desynchronization, out-of-bounds movement, and softlock suspicion; plus clean control sessions.
7. Explicit certainty/limitations, evidence references, and suggested reproduction steps.
8. A small purpose-built 2D Godot demo with deliberately controlled bug scenarios and clean equivalents.

### Out of scope (MVP)

- Autonomous gameplay agents, input generation, or unattended exploration.
- Live/real-time bug detection or streaming inference during play.
- Hosted SaaS, user accounts, billing, collaboration, cloud databases, or public sharing.
- General-purpose static analysis, arbitrary game-engine support, or guaranteed bug detection.
- Automatic detection of every collision defect or every kind of softlock.
- Pixel-perfect segmentation as a prerequisite for findings.
- Cross-platform installer packages, production hardening, or exhaustive plugin compatibility.
- NixOS modules, background services, OS-level installers, and advanced distribution workflows.
- Audio-based inference as a required capability; audio may be recorded but is not essential for MVP findings.

## 3. End-to-end user journey

1. **Install:** Copy/enable the PostPlay Godot editor addon in a supported Godot 4.x project. Configure its local output directory if needed.
2. **Instrument (optional):** Register meaningful existing game signals, watched properties, and semantic context through a small runtime API. Without annotations, PostPlay should still record a basic session; richer diagnosis depends on available evidence.
3. **Record:** Choose **Record PostPlay Session** in the editor. The addon prepares an isolated session directory, configures/enables Godot Movie Maker before the run, and starts the demo. The developer plays for roughly 30–120 seconds, then stops the run.
4. **Finalize:** The addon writes a session manifest and telemetry, resolves the video file, and restores its previous editor recording configuration. Sessions must never silently overwrite each other.
5. **Open locally:** Start the local Astro/Node application and open/import a session from the configured session directory. The dashboard displays video and basic metadata even before analysis.
6. **Analyze:** Select **Analyze Session**. The backend validates the session, converts the recording to MP4 if necessary, sends the clip and a bounded telemetry summary to Muse Spark, and validates the structured reply. Optional SAM analysis may provide targeted visual evidence.
7. **Review:** Inspect a list of timestamped findings or a clear **No supported findings** outcome. Select a finding to play the relevant segment, read observed vs. expected behavior, review evidence/uncertainty, and see suggested steps for reproducing it.
8. **Repeat:** Record another session and compare its report manually. Automatic cross-session comparisons are not required.

**Recording fallback:** If Movie Maker fails feasibility checks, accept an externally recorded MP4 paired with telemetry and an explicit synchronization offset/anchor. Do not block the AI pipeline on integrated recording.

## 4. Architecture and component responsibilities

```text
Godot EditorPlugin                Godot runtime instrumentation
  ├─ Record Session UI              ├─ watch_signal(...)
  ├─ Movie Maker launch/restore     ├─ watch_property(...)
  └─ session directory setup        ├─ limited input/position samples
                     \             └─ optional semantic context
                      \                   /
                       └─ Session package ─┘
                          ├─ session.json
                          ├─ events.jsonl
                          └─ recording.ogv / .avi / .mp4
                                      │
                               local Astro + Node
                          ├─ session import/validation
                          ├─ FFmpeg conversion/preview
                          ├─ Meta Model API adapter
                          ├─ report persistence
                          └─ dashboard UI
                                      │
                           Muse Spark analysis
                        optional SAM 3.1 inspection
                                      │
                                findings.json
```

### 4.1 Technology decisions

| Component | MVP choice |
| --- | --- |
| Game engine and addon | Godot 4.x / GDScript; validate against one pinned Godot 4.x version first |
| Video capture | Godot Movie Maker launched by `EditorPlugin`; external recording fallback |
| Dashboard | Astro + Tailwind CSS |
| Local API and orchestration | Node.js + TypeScript, integrated with the Astro application where practical |
| Media conversion/inspection | FFmpeg / FFprobe as local command-line dependencies |
| Persistence | Local session folders and JSON/JSONL; no database required |
| AI reasoning | Meta Model API, `muse-spark-1.3` by default |
| Optional object segmentation/tracking | Meta Model API, `sam-3.1` |
| Target deployment | Local Linux development/server process; browser-based dashboard |
| Development environment | Nix flake (`flake.nix`, `flake.lock`) with a default `devShell` using `nix/godot.nix` |
| Optional distribution | `packages.default` / `apps.default` for the local dashboard; `packages.godot-addon` for an installable addon archive |

**Architecture rule:** Video capture, telemetry collection, analysis, and presentation must communicate through documented session/report contracts. The AI pipeline must not depend on Godot running, and the dashboard must be able to display saved reports without making new API calls.

### 4.2 Godot addon

- **Editor layer:** User-facing record action; create unique session ID; configure Movie Maker output prior to game launch; detect run completion; safely restore modified settings. Provide clear feedback if output files are missing or recording failed.
- **Runtime layer:** Register and timestamp observations; serialize bounded values into append-only events; flush on orderly shutdown and tolerate an incomplete session after a crash when possible.
- **Signal API:** Allow existing `Signal` instances to be watched without changing their emitters. Preserve signal arguments when serializable, plus developer-provided expectations/labels. Manage connections when sources are freed.
- **Property API:** Watch selected object properties at a configurable, bounded sampling interval or on a supported change mechanism. Attach stable object labels/path and developer descriptions. Do not log the entire scene tree by default.
- **Generic inputs:** Capture a useful subset of game inputs/actions without recording raw typed text or sensitive input content. Mark observations as best-effort when Godot event propagation prevents full visibility.
- **Semantic annotations:** Optionally designate player node, playable region, progression/goal signals or state, and meaningful objects. These are context, not hardcoded bug reports.
- **Collision-debug metadata:** Record whether `SceneTree.debug_collisions_hint` was enabled at run start; optional visual overlays are context, not definitive collision proof.
- **Performance:** Bound observation rates and file size; do not block the main thread on network inference (none occurs during a session).

**Illustrative API only (final function signatures are designed during implementation):**

```gdscript
PostPlay.watch_signal(
    damaged,
    "When damaged, health decreases and the HUD should reflect the new value"
)
PostPlay.watch_property(player, "health", "Authoritative player health")
PostPlay.watch_property(health_bar, "value", "Displayed health")
PostPlay.set_player(player)
PostPlay.set_playable_bounds(play_area)
```

The API must support registering an existing signal; a developer must not be forced to add PostPlay-specific signals to game code. Avoid requiring every optional instrumentation method for basic recording.

### 4.3 Session data contract

Each session is an independently inspectable directory with **relative media paths** and **schema versions**. The concrete schema is a separate, version-controlled implementation artifact; minimum semantics:

- **`session.json`:** `schema_version`, `session_id`, game/project/scene identifiers, Godot version, capture mode, started-at UTC, completion status, video path/format/fps/duration (once known), recording settings, collision-debug flag, and synchronization metadata.
- **`events.jsonl`:** one observation per line with session ID, event type (`signal`, `property`, `input`, `position`, `annotation`, etc.), timestamp in session time, available process/physics frame index, source identity, human-readable label, and JSON-safe payload.
- **Video:** original recording plus a generated analysis/browser-compatible MP4 when needed; derived files must not mutate the original.
- **`findings.json`:** schema-versioned analysis output; AI model/prompt versions and provenance; structured findings or an empty list; analysis errors must be stored separately from a clean result.

**Synchronization:** Explicitly distinguish wall time, simulation time, frame counters, and encoded video time. Movie Maker can run slower than wall-clock time, so wall-clock timestamps alone are insufficient. Use frame-based timing with a validated recording-start offset or equivalent anchor, record any conversion offset, and verify alignment with a known visible event. For external video, require a configurable alignment offset/anchor. Never silently pretend an unsynchronized recording is aligned.

**Portable serialization:** Convert supported values (scalars, vectors, arrays, selected dictionaries) to typed JSON-safe representations; omit or clearly mark unsupported object references. Cap payload size and sampling frequency. Don't serialize arbitrary resource trees or private data.

### 4.4 Nix development environment and packaging

**Core requirement — development shell:**

- The repository must contain root-level `flake.nix` and committed `flake.lock` files. Put supporting Nix expressions in the root-level `nix/` directory (including `nix/godot.nix`); keep root-level files only where the flake interface requires them. A separate `shell.nix` is not required.
- `devShells.default` must provide the tools necessary to **develop, run, and test** the Godot addon, demo game, and Astro/Node application on Linux. At minimum, include the owner's custom Godot editor package, a pinned compatible Node.js runtime, the project's selected JavaScript package manager, FFmpeg/FFprobe, and essential build/test tools.
- Reuse the existing owner-provided `nix/godot.nix` function, which takes `nixpkgs` and produces the packaged Godot editor. Inspect its actual call signature when the file is supplied; do **not** replace it with an unrelated Godot package or rewrite it without a documented necessity and owner approval.
- The development shell is available through `nix develop`; its reproducible dependency definitions and JavaScript lockfile must remain consistent. Document any non-Nix secrets/configuration (notably `MODEL_API_KEY`) separately; secrets must not enter Nix derivations, the Nix store, or the committed repository.
- The flake is the **preferred**, but not exclusive, development workflow. Document a conventional Godot/Node/FFmpeg setup path for users or judges without Nix where practical.

**Secondary requirement — runnable local dashboard package:**

- After the primary record → analyze → review pipeline works, aim to expose `packages.default` as the dashboard/backend package and `apps.default` as its launch entry point. The intended user commands are `nix build` and `nix run`.
- The package must carry or locate its **runtime** dependencies (including FFmpeg) without assuming packages happen to be installed globally. It must serve locally (loopback by default), accept normal environment-based API configuration, and write sessions/reports to a configurable writable directory outside the immutable Nix store (prefer an XDG-compatible user data directory).
- Distribution packaging must not block demo validation, report correctness, or submission preparation. If packaging proves disproportionately costly, leave a documented development-shell launch path and mark packaging incomplete.

**Optional requirement — Godot addon distribution:**

- If low-effort after the core deliverables, expose `packages.godot-addon` producing a ZIP archive with the conventional `addons/postplay/` directory layout for manual installation in a Godot project.
- Do not introduce a NixOS module, systemd service, special installer, or direct Nix-based addon injection to achieve this. The unpacked addon must remain usable without Nix.

**Verification:** At minimum, validate entry into `nix develop` and availability of the required tools. Test `nix build` and `nix run` if the dashboard package is implemented, and inspect the addon archive structure if produced. Record actual results and manual steps in `TASKS.md`.

## 5. Meta analysis pipeline

**AI-first** means Muse Spark must search the video and telemetry for possible anomalies rather than merely rephrase preprogrammed detections. Deterministic code is appropriate for ingestion, validation, synchronization, summarization, and checking evidence references—not for inserting known demo bug labels into reports.

### 5.1 Muse Spark — required

1. Verify the API with a short real MP4 plus telemetry and a structured response before building substantial surrounding UI.
2. Validate the session and normalize/summarize telemetry to a size suitable for the model. Preserve event order and timestamps; retain a way to reference original event IDs.
3. Send video and contextual telemetry together via Meta Model API; use a versioned prompt that instructs the model to find possible defects, consider benign explanations, distinguish observation from inference, and allow zero findings.
4. Request schema-constrained structured output; validate it locally. Reject or quarantine malformed reports; never present them as successful clean results.
5. Store model ID, prompt/schema version, request timestamp, reported usage/cost when available, and output for repeatable inspection.
6. Permit a targeted second analysis pass only if initial evidence is unclear and budget permits; one-pass analysis is sufficient for MVP.

### 5.2 SAM 3.1 — optional, evidence-driven

SAM can segment or track a named object (for example the player character, a boundary, or a door) within selected frames or a short video segment. It **does not** determine whether a game mechanic is correct.

- Run SAM only for a specific visual question where geometry/tracking could improve a finding.
- Use a concise noun-phrase or grounded point/box prompt; do not assume stylized 2D sprites will be reliably recognized.
- Preserve SAM-derived boxes/tracks and their frame references separately from model interpretations.
- If inaccurate, unavailable, or too slow, skip SAM and report the limitation. The primary MVP must remain useful.

### 5.3 Safety, budget, and remote data

- API calls are server-side only; read `MODEL_API_KEY` from the local environment, never expose it to browser code, logs, or commits.
- Analysis is explicitly user-triggered. Clearly disclose that the selected video and telemetry are sent to Meta despite local storage of sessions.
- Default to Standard-mode Muse Spark (`muse-spark-1.3`), not Contributor mode, unless the owner deliberately changes the data-use choice.
- Before large uploads, show/estimate media size; support a configurable analysis budget/maximum clip duration and avoid automatic retry storms.
- Prefer expiring uploads (when supported) and/or delete remote uploaded files after processing; Meta file uploads do not expire by default.
- Treat model responses as untrusted data; validate schemas, referenced event IDs, timestamps, and local file paths before rendering.
- Make network/API failures and exhausted credits distinguishable from a report containing zero findings.

## 6. Finding and evidence contract

Every accepted finding must include at least:

| Field | Meaning |
| --- | --- |
| `id`, `category`, `title` | Stable finding identifier and concise classification |
| `severity` | Impact assessment, separate from certainty |
| `certainty` | `low`, `medium`, or `high`; qualitative, not a fabricated probability |
| `start_ms`, optional `end_ms` | Video-local timestamp/range, validated against duration |
| `observed_behavior` | What the video/telemetry actually shows |
| `expected_behavior` | Expected outcome **and its source** (annotation, observed precedent, or explicit inference) |
| `explanation` | Why the discrepancy may be a bug, plus possible benign alternatives |
| `evidence[]` | References to specific telemetry event IDs, property samples, video times, and/or SAM tracks |
| `reproduction_steps[]` | Suggested steps grounded in the recording, marked uncertain if not demonstrated |
| `limitations[]` | Missing observations or other reasons certainty is limited |

**Certainty guidance:** `high` requires consistent, mutually supporting evidence and a clear expected outcome; `medium` supports a plausible discrepancy but allows alternatives; `low` indicates an observation worth reviewing. These labels are model assessments, not calibrated statistical probabilities.

**Evidence rules:** No invented events, fake property values, unsupported causal claims, or fictional reproduction steps. If a timestamp/event reference cannot be resolved, flag the finding as invalid or lower its trust; don't silently fabricate evidence. A suspected softlock is not a verified softlock solely because the player stood still.

**No-finding outcome:** `findings: []` with a brief coverage/limitations summary is valid. An analysis failure is **not** a no-finding outcome.

## 7. Demonstration game and evaluation

Build a compact, visually readable **2D Godot game** with a few simple rooms/interactions. Keep visuals and controls consistent across buggy and clean sessions. Provide selectable, developer-only scenario toggles for reproduction, but **do not send bug-mode flags or ground-truth labels to Muse Spark**.

The evaluation set contains **three buggy scenarios and corresponding clean controls**. Store expected outcomes separately from the model input. Use the same capture and analysis path for both.

### Scenario A — UI/state synchronization

- **Bug:** An authoritative player resource changes, but the on-screen bar/hearts do not reflect it (or update after a visibly unacceptable delay).
- **Evidence available:** property watch of resource; optionally watch displayed widget value; signal representing the change; video showing the UI.
- **Expected output:** A timestamped state/UI mismatch finding describing the changed internal value and stale visual indicator. Timing expectations should be explicitly registered or clearly qualified; do not invent a universal response-time threshold.
- **Clean control:** Same interaction updates the HUD normally. No high-certainty UI mismatch finding.

### Scenario B — Out-of-bounds movement

- **Bug:** The player escapes a clearly defined playable area through an intentional collision flaw.
- **Evidence available:** player position samples, optional play-area annotation, input sequence, recording; debug collision shapes if enabled.
- **Expected output:** A timestamped finding pointing to the player moving outside the declared/reasonably inferred playable region. The explanation should identify whether bounds come from annotations or visual inference.
- **Clean control:** Player collides with the boundary or stays in a legitimate traversable area. No high-certainty out-of-bounds finding.
- **Not required:** Detecting missing collision-shape definitions purely from pixels.

### Scenario C — Softlock

- **Bug:** An interaction or state transition strands the player in a situation from which reasonable attempts cannot advance the game.
- **Evidence available:** watched progression/interaction state, movement/inputs, relevant signal events, and recorded outcome.
- **Expected output:** A clearly labeled **suspected softlock** with the attempted actions, lack of progression, and explicit uncertainties. Only claim it is verified when the instrumentation actually establishes no valid recovery path.
- **Clean control:** Equivalent interaction allows normal continuation or shows an intentional temporary wait. No high-certainty softlock finding.

### Evaluation requirements

- Collect at least one independently captured buggy session and one clean session for **each** scenario; avoid evaluating only on hand-written example telemetry.
- The primary demonstration should produce correctly localized, actionable reports for all three buggy categories; any misses or false positives must be reported honestly rather than patched through ground-truth leakage.
- The six-session evaluation should produce **zero high-certainty false positives** on the three clean controls; lower-certainty observations must remain visibly qualified.
- Verify at least one finding by following its evidence link to the appropriate video segment and relevant telemetry record.
- Test recording-to-video synchronization against an explicit visible action/event. Target alignment within approximately **0.5 seconds** for the small demo; if not met, expose the error rather than showing false precision.
- Demonstrate an empty/clean analysis and a recoverable API failure as distinct dashboard states.
- Optional: rerun one buggy and one clean session to observe model variability; record the result rather than claiming determinism.

These are **acceptance targets**, not a guarantee that the model will always discover a bug. Reliability, reproducibility, and honest reporting take precedence over manufacturing perfect-looking results.

## 8. Dashboard minimum feature set

- **Sessions:** List locally available/imported sessions, with name, recorded date, duration, and status (`recorded`, `processing`, `analyzed`, `failed`).
- **Player:** Browser-compatible video with seek/play controls and displayed session timeline.
- **Analysis action:** Explicitly start analysis, show progress/error and prevent duplicate concurrent analyses of the same session.
- **Findings:** List with category, severity, certainty, brief title, timestamp; allow selecting a finding to seek the video and inspect evidence.
- **Details:** Observed vs. expected behavior, linked telemetry samples, uncertainty, and suggested reproduction steps.
- **Clean state:** Clear explanation when no supported findings were returned.
- **Diagnostics:** Missing video/telemetry, invalid schema, synchronization problems, conversion failure, and Meta API failure must be understandable.

A single responsive page or a few simple routes is enough. No authentication, user management, rich charts, or elaborate design system is necessary.

## 9. Implementation milestones (ordered by risk)

Detailed task checkboxes and verification records belong in `TASKS.md`, not here. Each milestone must leave a manually inspectable result.

| Milestone | Outcome | Exit check |
| --- | --- | --- |
| **M0 — Prove dependencies** | Working Nix development shell using `nix/godot.nix`; minimal Meta video+telemetry request and structured response; Godot Movie Maker test; FFmpeg playback/conversion | `nix develop` exposes the expected toolchain; real API response persisted; short demo recording plays; stop/go decision for Movie Maker |
| **M1 — Capture a portable session** | Addon record action, signal/property instrumentation, basic input/position events, session manifests, sync metadata | Single playable session with readable telemetry and validated visible-event alignment |
| **M2 — Analyze end-to-end** | Session importer, conversion, Muse Spark adapter, versioned prompt/schema, report validation/persistence | Recorded demo clip yields a structured result or explicit failure; no hardcoded findings |
| **M3 — Review locally** | Astro dashboard with session list, video, analysis action, findings, evidence links, clean/error states | User can click from a finding to the correct point in the video and related telemetry |
| **M4 — Controlled demo and evaluation** | Three buggy/clean scenario pairs; explicit ground truth outside model input; evidence/certainty checks | Six sessions analyzed and outcomes documented, including misses/false positives |
| **M5 — Polish and submission** | Setup instructions, reproducible demonstration steps, smoke tests, cleanup, submission media/docs; attempt dashboard package and optional addon archive only if time permits | Fresh local setup follows README and shows at least one complete record → analyze → inspect flow; document any packaging results or deferrals |

**Priority order:** M0–M3 are the essential vertical slice; M4 makes the project compelling and evaluates usefulness; M5 is necessary for submission quality. The Nix `devShell` is required in M0; the runnable dashboard package and addon ZIP are **nonblocking** M5 enhancements. Allocate a final buffer to fixes, not new features. Optional SAM tracking is added after the essential pipeline works and only if it improves the evidence.

**Fallbacks:**

- Movie Maker unusable → manual MP4 + synchronized telemetry import.
- SAM unreliable → disable the optional tracking pass.
- Full clip analysis too costly/slow → trim to short, explicitly identified clips, preserve original references, and document the coverage limitation.
- Time pressure → simplify dashboard visuals and optional semantics before compromising the core record → analyze → review path or misleading the user about certainty.
- Nix dashboard/addon packaging takes too long → retain and document the working `nix develop` workflow; defer optional distribution outputs.

## 10. Nonfunctional requirements

- **Reproducibility:** Pin tested dependency versions with `flake.lock` and the relevant JavaScript lockfile; document Nix and conventional Godot/Node.js/FFmpeg/Meta API setup. Provide a minimal sample session fixture for offline UI tests.
- **Observability:** Local structured logs with redacted secrets; separate capture, conversion, upload, inference, validation, and rendering errors.
- **Performance:** Avoid excessive per-frame serialization; prefer bounded observation rates. A short session should be straightforward to inspect and process on a normal development laptop.
- **Data integrity:** Unique session IDs, stable event IDs, atomic writes where useful, no silent overwrites, and recoverable handling of partial/corrupted recordings.
- **Security:** Bind the local server to loopback by default, constrain file operations to configured directories, validate uploaded/imported files, and protect API credentials. No arbitrary remote command execution from telemetry or model output.
- **Accessibility:** Findings must be understandable as text; severity/certainty must not be represented only by color.
- **Testability:** Unit tests for serializers, normalization/synchronization, and report validation; Godot smoke/integration checks; at least one manually verified end-to-end test with actual Meta API output.
- **Package runtime integrity:** If a Nix package is delivered, it must not require hidden global executables, write into the Nix store, or bind to a public network interface by default.

## 11. Project documentation boundaries

- **`PROJECT.md` (this file):** Authoritative scope, product behavior, architecture, acceptance criteria, and milestones. Changes to agreed scope or major architectural choices require owner approval.
- **`TASKS.md`:** Human-readable implementation checklist grouped by the milestones above. Codex updates verified items with what changed, evidence of automated checks, manual test instructions, and remaining caveats. Unverified manual steps stay visibly pending.
- **`AGENTS.md`:** Binding engineering workflow rules for Codex: read these files first, avoid unapproved scope changes, state ambiguities, implement surgical changes, verify work, and maintain `TASKS.md`. It must require use of the Nix `devShell` for development checks, dependency/lockfile synchronization, and nonreplacement of the custom Godot package without approval.
- **Prompt/schema files:** Versioned analysis prompt(s), model adapters, and machine-readable input/output schemas. Neither prompts nor hidden demo ground truth should be scattered through UI components.
- **`README.md`:** Installation, Nix `devShell` and conventional setup paths, environment variables, how to record, analyze, run demo scenarios, optional `nix run`/addon archive commands, and troubleshoot.

## 12. Assumptions and items to validate during implementation

The following are **explicit assumptions or implementation checks**, not additional user decisions at this stage:

1. **Movie Maker feasibility:** Godot's editor API can enable recording before launching a scene; interactive speed, actual file format, audio behavior, and frame/video alignment must be verified on the pinned Godot build.
2. **Session discovery:** The addon writes portable session directories; the local backend reads/imports them from an explicitly configured location. The exact import UX may be selected for the simplest reliable implementation.
3. **Input observability:** Godot may not expose every consumed input via a single autoload hook; document which input/action events are reliably captured.
4. **Model competence:** Multimodal video understanding is supported by Muse Spark, but accurate detection of these specific gameplay bugs is experimental and must be assessed using the real six-session set.
5. **Structured outputs and file upload:** Verify supported schemas and media limits with the actual credited Meta API account. Convert video to MP4 for Muse Spark.
6. **Semantic instrumentation:** The exact public GDScript API signatures and sampling defaults are implementation-level choices, provided they preserve the product behavior and remain documented.
7. **Hackathon rules:** The public event page does not establish every participant requirement; confirm any portal-specific submission format, originality, deployment, or platform rules before submission.
8. **Library/version choices:** Use minimal supported packages and pinned versions; no need for a database, queue service, Python backend, or separate microservices for this MVP.
9. **Custom Godot derivation:** The owner will supply `nix/godot.nix`; confirm its actual function interface and compatibility before constructing the `devShell`. The flake should not rely on absolute paths to the owner’s machine.
10. **Package feasibility:** A standalone Astro/Node server package and addon ZIP are desirable but subordinate to a demonstrated working product. Select the simplest Nix build method compatible with the actual JavaScript package manager and lockfile.

## 13. References

- [Meta Global AI Developer Hackathon](https://dev.meta.ai/events/global-hackathon)
- [Meta Model API overview](https://dev.meta.ai/docs/overview)
- [Meta video understanding](https://dev.meta.ai/docs/video-understanding)
- [Meta structured Responses schemas](https://dev.meta.ai/docs/api-reference/responses/schemas)
- [Meta SAM / media segmentation](https://dev.meta.ai/docs/media-segmentation)
- [Meta file handling](https://dev.meta.ai/docs/file-handling)
- [Godot Movie Maker documentation](https://docs.godotengine.org/en/4.5/tutorials/animation/creating_movies.html)
- [Godot EditorInterface](https://docs.godotengine.org/en/4.5/classes/class_editorinterface.html)
- [Godot SceneTree](https://docs.godotengine.org/en/4.5/classes/class_scenetree.html)

# PostPlay — Instructions for Codex

> **Purpose:** Repository-wide engineering and execution rules for Codex.  
> **Scope:** Godot addon, demonstration game, local Astro/Node application, AI integration, tests, and Nix tooling.

## 1. Read this first

PostPlay is a **local, post-session AI playtesting assistant**. It combines Godot gameplay recordings and structured telemetry to suggest evidence-backed technical bugs and softlocks. The MVP is a one-week hackathon prototype, **not** a hosted service or autonomous game-playing agent.

Read these files before changing anything:

1. **[`PROJECT.md`](./PROJECT.md)** — approved product specification, architecture, scope, constraints, and milestone acceptance criteria. It answers **what to build**.
2. **[`TASKS.md`](./TASKS.md)** — executable milestone checklist, progress, verification records, blockers, and handoff. It answers **what to do next and what has actually passed**.
3. **This `AGENTS.md`** — working rules for implementation, decisions, tests, and reporting. It answers **how to work**.
4. Relevant code, schemas, prompt files, tests, and README sections for the component you are changing.

**Do not treat an unchecked task as completed, an illustrative snippet as a final API, or an acceptance target as an observed result.** If instructions disagree, identify the exact conflict and ask the owner before proceeding with the conflicting work. Never silently rewrite an approved requirement to accommodate an implementation.

## 2. Think before coding

**Don't assume. Don't conceal uncertainty. Surface tradeoffs.**

Before implementing a nontrivial task:

1. Identify the applicable `TASKS.md` task ID and read its acceptance criteria and dependencies.
2. Inspect the existing implementation, tests, configuration, relevant documentation, and `git status`. Preserve unrelated user changes.
3. State the intended behavior, important assumptions, and a short implementation plan with verification steps.
4. Prefer the **simplest working approach** that meets `PROJECT.md`; point out a simpler option when appropriate and push back on unnecessary complexity.
5. Check whether your proposal crosses an architecture, scope, security, cost, or acceptance boundary.

**Ask before proceeding** if an unresolved choice materially affects user-visible behavior, project scope, data formats or public APIs, architectural boundaries, privacy, model spending, or an approved acceptance criterion. Present the options, tradeoffs, and your recommendation. Stop only the affected work; continue independent, clearly authorized tasks if useful.

**Decide without interrupting** for small, reversible implementation details that conform to the specification and established code style. Record a consequential implementation choice in the `TASKS.md` decision log. Do not ask for confirmation of every filename or helper function.

If an approved feature cannot be implemented as specified, report the tested blocker and a proposed fallback. Do not claim that an untested workaround works.

## 3. Scope, priorities, and restraint

**Deliver a working, honest vertical slice before polishing.** Follow `PROJECT.md` and the M0–M5 path in `TASKS.md`:

- **M0:** Nix devShell, real Godot recording feasibility, real Meta video-plus-telemetry smoke test.
- **M1:** Portable capture with telemetry and verified video synchronization.
- **M2:** Real Muse-backed analysis, schema validation, evidence, persisted results.
- **M3:** Local dashboard that lets a person inspect video and findings.
- **M4:** Three buggy/clean demo pairs and an honest six-session evaluation.
- **M5:** Reproducibility, documentation, submission, and only then secondary packaging.

SAM 3.1 tracking, `packages.default`/`apps.default`, and the addon ZIP have the priority defined in `PROJECT.md`; **do not divert critical-path work toward optional features**. Do not introduce autonomous test agents, a hosted platform, auth/accounts, a database, Python services, a queue, generalized plugin infrastructure, or deployment machinery without an approved requirement.

Keep changes surgical:

- Change only files relevant to the task. Match local conventions.
- Do not opportunistically rewrite nearby code, reformat unrelated files, or add speculative abstractions/configuration.
- Remove dead code or dependencies introduced by your own changes; do not clean up unrelated pre-existing code unless requested.
- Prefer small, inspectable changes over large unreviewable rewrites.
- Reuse framework/engine capabilities instead of recreating them, unless testing proves a genuine limitation.
- Preserve simple documented fallbacks; do not maintain multiple elaborate implementations without a demonstrated need.

## 4. Task execution protocol

### At the start of each Codex work session

1. Read `PROJECT.md`, `AGENTS.md`, and the current `TASKS.md`, especially **Active Work**, task acceptance criteria, blockers, and latest handoff.
2. Inspect `git status` (including staged, unstaged, and untracked work) and the relevant code/tests before editing. Preserve unrelated user changes; use relevant recent commits and test artifacts to reconcile actual work if necessary.
3. **Resume an existing active task before choosing a new one.** Compare its checkpoint with what is on disk. A checkpoint can be stale after an abrupt stop: trust neither the notes nor the working tree without checking. If the task is already complete, verify its acceptance criteria and record the outcome; if incomplete, continue from the first remaining step.
4. Only when there is **no resumable active task**, select the next unblocked, highest-priority task or the exact task requested by the owner. If an active task is blocked or awaiting owner verification, record that state and any permitted independent work explicitly before switching.
5. Briefly state the task ID, intended result, assumptions, and verification steps. If a prerequisite is missing (for example `nix/godot.nix`, API credentials, or manual Godot interaction), report it rather than inventing it.
6. **Before the first substantive code edit**, write/update the **Active Work** checkpoint in `TASKS.md` with the task ID, status, objective, and concrete next action. This is a write-ahead record, not a claim of completion.

### While implementing

- Work against the task's **Done when** condition, not just its **Deliver** list.
- Add or adjust the smallest useful tests for changed behavior; prefer deterministic fixtures for everyday development.
- Do not claim live Meta tests passed from mocked results, nor claim a Godot UI action was manually checked without actually observing it.
- **Checkpoint at meaningful boundaries:** after a substantial implemented substep, a relevant test, a new blocker or changed decision, and before a planned pause or high-risk operation. Record files affected, observed results, and the next actionable step. Do not update after every minor edit/tool call.
- Do not defer all progress recording until the end of the session; usage limits, crashes, and context loss may prevent a final handoff.
- If a new discovery invalidates the plan, document it and seek approval when required by §2.
- **Use one Codex agent.** Do not spawn or delegate to sub-agents; the active agent owns implementation, integration, verification, and progress records.

### Resuming after an unexpected interruption

Treat a request such as **"resume"** or **"continue"**, including in a fresh Codex conversation, as recovery of unfinished work—not permission to start the next unchecked task.

1. Read **Active Work**, its checklist entry, and the latest handoff; identify the task that was underway.
2. Examine `git status`, diffs (staged and unstaged), untracked files, relevant recent commits, and available test/output artifacts. Determine what was actually persisted since the last checkpoint. Do not discard or overwrite partial work to match the notes.
3. Reconcile facts: identify implemented pieces, incomplete code, and checks truly run. Run a focused, safe check when necessary. Update the checkpoint with verified state and an exact next action **before** proceeding.
4. Continue the same task from its first outstanding step. If it is complete, verify the task's acceptance criteria, update its checklist entry, and clear the active checkpoint before selecting another task.
5. If there is no checkpoint, or it disagrees materially with the repository, reconstruct the task from task notes, Git changes, and test evidence. Record the reconstructed checkpoint; ask the owner before any destructive or ambiguous recovery action.
6. Before repeating a **paid Meta API call** or other non-idempotent operation, check whether its result/output already exists and whether another call is necessary. Never assume an interrupted request failed or succeeded without evidence.

A resumed Codex conversation may help recover earlier discussion, but **repository files and verified artifacts are the durable source of progress**. No checkpoint can preserve edits or decisions that were never written to disk.

### Local commands and atomic Git history

- Codex is authorized to autonomously run **project-local** development commands, including `nix develop`, `nix build`, `nix flake check`, Godot runs/tests, package-manager scripts, formatting, linting, and local test servers, within the configured sandbox and network policy. Do not request owner approval for ordinary sandbox-permitted builds, tests, or development commands. A command that genuinely requires new permissions is not permission to bypass the sandbox; report the blocker or ask for the smallest necessary change.
- Codex is authorized to stage and make **local Git commits** without owner approval. Treat Git as a durable project history and recovery aid, not as a replacement for `TASKS.md`. Commit after a coherent, reviewable unit of work; a task may legitimately contain several commits. Do not force one commit per task or artificially split a single logical change.
- Make **atomic, purpose-specific commits**: separate unrelated features, fixes, refactors, and documentation where that improves reviewability. Keep tests and documentation that are necessary for a change alongside that change. Prefer a concise conventional-commit-style subject, such as `feat(addon): record watched signals` or `test(telemetry): cover unsafe values`.
- Before committing, inspect `git status` and the **staged** diff. Stage only files/hunks belonging to the intended change; do not indiscriminately stage the whole repository when unrelated owner work exists. Never commit credentials, generated recordings, session data, local caches, or `.env` files.
- Never erase or rewrite the owner's work or published history. No `git reset --hard`, `git clean -fd`, force-checkouts, history-rewriting rebases, `git commit --amend`, or branch deletion without explicit owner authorization. Do not rewrite an existing commit just to improve its message.
- **Remote publication is reserved exclusively for the owner.** Never execute `git push`, `git send-pack`, `gh repo sync`, or any alternate push/publish mechanism; never create a remote PR/release or upload commits through other tools. Do not try wrappers, aliases, alternate executables, or network calls to bypass command policy. Fetching dependencies or making the explicitly authorized Meta API requests is not permission to publish repository contents.
- Follow the repo's `.codex/config.toml` and `.codex/rules/` restrictions. Those are operational limits, not suggestions. If sandbox restrictions prevent a required operation, do not switch to full access, disable the policy, or change the permission configuration on your own. Ask for the narrowest required change.
- Record relevant commit hashes in the task's verified notes or Active Work checkpoint when they help recover interrupted work. Do not mark a task complete merely because changes have been committed.

### Before ending a work session (when possible)

1. Run the relevant checks you can actually execute; record commands, results, and environment limitations.
2. Inspect the diff for unrelated edits, leaked secrets, generated media, and incorrect paths.
3. Update the relevant `TASKS.md` items accurately. **A task is checked only when its acceptance criteria have been verified**. If implementation exists but required manual checks have not occurred, leave it unchecked and label it **Awaiting owner verification**.
4. Update **Active Work**: retain the task and exact next step if unfinished; clear it only after verified completion or after its pending state is recorded in the task/handoff and another authorized task takes over. Update the milestone summary, blockers/decision log, and latest handoff as applicable.
5. Report briefly: task IDs addressed, files/behavior changed, tests passed/failed/not run, manual test steps, blockers, and next suggested task.

**Do not mark a milestone exit gate as verified on the owner's behalf.** A gate requiring owner verification stays unchecked until the owner confirms it. You may prepare independent follow-up work if not blocked by that gate, but do not represent the milestone as approved.

## 5. Maintaining `TASKS.md`

`TASKS.md` is a **human-readable audit trail**, not a generated activity log or an unchecked to-do dump. Preserve its stable milestone IDs and task numbering.

For a task you actually complete, append compact, factual notes beneath its checkbox:

```md
- [x] **M1.3 — Watch existing signals and properties**
  - **Implemented:** What behavior was added; main files or modules.
  - **Verified:** Exact check(s) run and observed result.
  - **Try it:** Concrete user steps to exercise it, if applicable.
  - **Limitations:** Any relevant unverified path or caveat.
```

For unfinished tasks, leave `[ ]` and use `In progress`, `Blocked`, or `Awaiting owner verification` with what is missing and how to proceed. Automated checks and manual verification are distinct. Do not turn an unexecuted suggested command into a reported result.

Keep the **Active Work** checkpoint near the top of `TASKS.md` current **before** code changes and at meaningful boundaries, not after every minor edit. Keep it short and overwrite only its rolling progress fields; keep lasting verification and limitations beside the task itself. When a task finishes, record verified results in its checklist entry and clear the checkpoint. If interrupted, reconcile notes with Git/test evidence before continuing. Do not remove evidence of previously discovered failures or silently change completion criteria. Optional tasks can explicitly be `Deferred` without blocking a milestone when `PROJECT.md` allows it.

Only the owner approves changes to product scope, architecture, acceptance targets, or the milestone plan. Codex may update task status, truthful implementation notes, and the decision/handoff record autonomously. Propose new tasks or revisions to the authoritative plan for owner approval rather than reshaping milestones silently.

## 6. Engineering boundaries

### Godot addon and demo (GDScript)

- Keep **editor orchestration** (record button, Movie Maker setup, launch/restore) separate from **runtime observation** (signals, watched properties, input/position sampling, event serialization).
- Prefer Godot's built-in Movie Maker for the MVP; use the approved external-MP4 fallback only after the feasibility evidence warrants it.
- The addon must work without game-specific annotations. Optional `watch_signal`, `watch_property`, player/bounds/progression metadata must augment recording, not be mandatory for basic capture.
- A watched `Signal` must be an **existing game signal**; do not require game developers to rewrite emitters or create PostPlay-specific gameplay signals.
- Guard against freed nodes, duplicate subscriptions, invalid property paths, unsupported values, and uncontrolled sampling. Do not scan or serialize an entire scene tree by default.
- Input recording is intentionally limited and best-effort. **Do not record typed text or secret-bearing raw inputs.**
- Preserve normal Godot editor behavior after capture, including previous Movie Maker settings; never overwrite older sessions.
- Use typed GDScript when practical, descriptive snake_case identifiers, and the surrounding Godot project conventions. Keep the demo's gameplay logic independent of PostPlay's internals.

### Portable recording and timing

- Keep versioned contracts for `session.json`, `events.jsonl`, and `findings.json`; assign stable IDs and use relative media paths.
- Treat wall-clock, simulation time, physics/process frames, and encoded video time as **different clocks**. Do not equate them without a measured mapping/anchor.
- Preserve original media and telemetry. Derived MP4s, normalized requests, and reports must be identifiable and reproducible.
- Measure time alignment against a visible event. Do not claim frame-perfect synchronization because timestamps look plausible; flag unknown or excessive offsets.
- Record incomplete or interrupted captures explicitly, and use bounded, JSON-safe serialization with clear unsupported-value behavior.
- Keep session packages consumable without a live Godot editor or a running model service.

### Local Astro / Node.js / TypeScript application

- Use the approved **Astro + Tailwind + Node.js/TypeScript** stack. Prefer Astro's existing server facilities where suitable; do not create a second backend without a demonstrated necessity and approval.
- Keep capture-independent ingestion, FFmpeg preparation, model integration, report validation/storage, and UI concerns separated by typed interfaces and versioned contracts.
- Use strict TypeScript where configured; validate untrusted runtime data explicitly rather than relying on type assertions.
- Bind the local server to loopback by default. Do not expose arbitrary filesystem paths, accept unvalidated traversal, or pass untrusted paths into shell command strings. Invoke FFmpeg with an argument array and explicit error handling.
- Make saved reports reopenable without network access. The frontend must never contain `MODEL_API_KEY` or call the privileged Meta API directly.
- Persist writable data in configured local session directories (XDG-compatible defaults for packaged apps), never in immutable Nix store paths.
- Follow actual checked-in package scripts/formatter configuration; **do not invent `npm test`, `pnpm lint`, etc. as verified commands before they exist**.

### Meta Model API and analysis

- **Muse Spark (`muse-spark-1.3`) is required** for AI-first reasoning over gameplay video and correlated telemetry. SAM 3.1 is optional, targeted visual evidence—not the main bug detector.
- Keep prompts, model configuration, request adapters, and machine-readable schemas **versioned and testable**; do not hide large prompts inside UI components.
- Do not hardcode known demo bug categories as automatic findings or leak bug-mode flags, correct answers, or evaluation labels into model inputs. Bug detection must not depend on knowing which mode was played.
- Every displayed finding needs genuine, locally resolvable video/telemetry evidence and an appropriately qualified expected-behavior source. Distinguish **observations, hypotheses, and demonstrated facts**.
- Keep **severity** independent of **certainty**. `high` certainty requires strong evidence; a stopped player alone does not prove a softlock.
- An empty validated report is a legitimate result. Invalid output, missing evidence, model errors, and insufficient data **must not** be rendered as a successful clean session.
- Treat model outputs as untrusted input: validate schema, event references, timestamps, file paths, and rendering boundaries. Preserve uncertainty rather than inventing explanations or reproduction steps.
- Default to the approved Meta data-use mode, make remote upload user-triggered and visible, and keep credentials server-side. Avoid logging secrets or full sensitive payloads.
- Respect the $150 credit budget: use short clips and deterministic fixtures during most development, cap input and retries, and avoid unnecessary repeated paid calls. Make live calls only for explicitly planned real API checks/evaluations; ask before materially increasing API use. Apply supported upload expiry or cleanup and record genuine usage information when available.

### Evaluation integrity

- The demo must contain three independently observable bug/clean pairs: **UI-state synchronization**, **out-of-bounds movement**, and **suspected softlock**.
- Keep ground truth and bug toggles **out of AI-bound telemetry, prompt context, filenames presented to the model, and results synthesis**. Evaluation notes may store the truth separately.
- Run real recordings and actual API analysis for the six-session evaluation. Fixtures/mocks may exercise app behavior but **cannot** be substituted for empirical model performance.
- Report misses, false positives, timing errors, incomplete evidence, and costs honestly. Never tune results by inserting fake findings, hiding failed clean controls, or overstating confidence.
- A softlock should normally be reported as **suspected** unless collected evidence establishes that no valid recovery/progression path exists.

## 7. Nix and dependency rules

- The root `flake.nix` and committed `flake.lock` define the development environment; supporting expressions go in **`nix/`**, including **`nix/godot.nix`**.
- `nix/godot.nix` is owner-provided and evaluates to a function returning the Godot editor package from `nixpkgs`. **Inspect its actual signature before use; preserve it.** Do not replace it with `pkgs.godot`, copy code from the owner's personal configuration, or rewrite it without owner approval.
- The mandatory interface is `nix develop` with the required Godot editor, Node, selected JS package manager, FFmpeg/FFprobe, and build/test tools. Prefer running development and validation commands **inside this devShell**.
- Update `flake.lock`, JavaScript lockfiles, and dependency declarations deliberately and together when needed. Don't use unpinned global executables as hidden requirements or make unrelated lockfile upgrades.
- Keep credentials and local environment overrides out of Nix derivations, `/nix/store`, and Git.
- The Nix dashboard package/app is **secondary**, and the addon ZIP is **optional**. Only attempt them after the primary end-to-end workflow and evaluation are reliable, unless the owner explicitly reprioritizes them.
- If packaging is implemented, verify the **actual** `nix build` / `nix run` commands. If the addon archive is implemented, verify `nix build .#godot-addon` and archive contents. Otherwise document the status as deferred—not working.
- Do not introduce a NixOS module, systemd service, installer, or unrelated deployment layer.

## 8. Verification standards

**A change is done when its acceptance criteria have been observed, not when code has merely been written.** Choose relevant checks for the task; not every task requires every check.

| Area | Minimum relevant evidence |
| --- | --- |
| Nix / setup | `nix develop` succeeds; actual binaries and versions inspected; package outputs tested only if implemented |
| Godot addon | Scene parses/loads; watched signal/property events actually appear; capture state restored; interrupted/freed-object cases considered |
| Session contracts | Tests for valid/invalid serialization, IDs, relative paths, bounds, and incomplete sessions |
| Timing/media | Real recorded visible event matched to telemetry; measured offset documented; MP4 playable |
| Node/API | Type/build checks plus tests for safe import, path handling, conversion failure, and output schema validation |
| Meta | Real video+telemetry smoke response for M0; saved, schema-valid real analysis for M2; budget/error handling separately tested |
| Dashboard | A human (or observed browser automation) can open a session, seek video, inspect a finding, and distinguish empty/error states |
| Demo/evaluation | Six real buggy/clean sessions, honest results table, missing evidence and high-certainty false positives explicitly reported |

- **Test behavior, not implementation details.** Add regression tests for bugs before or alongside fixes when practical.
- Run focused checks after each task; run broader smoke/regression checks before declaring a milestone ready.
- Document exact commands and observed results. If something was not run, say why. A test you cannot perform remains pending manual verification.
- Keep fixtures small, nonsecret, deterministic, and clearly labeled **fixture**. Never claim a fixture demonstrates successful live inference.
- Fix regressions caused by your changes before declaring task completion; if the fix needs a scope decision, report it instead of bypassing the check.

## 9. Documentation and communication

- Public addon functions and their expected values/events should have concise API documentation and a usage example. Explain meaningful limitations (sampling, timing, signal lifetime).
- Document nonobvious contracts and invariants—especially clock mappings, evidence provenance, safe serialization, and failure states. Avoid comments that merely restate the code or narrate the development history.
- Keep `README.md` aligned with **tested** installation/run commands and real prerequisites. Offer a practical non-Nix path where possible.
- Keep owner-facing reports short, concrete, and navigable. Use task IDs and file paths. Clearly separate **implemented**, **verified**, **awaiting owner action**, and **deferred**.
- Do not treat a proposed command, unsupported API assumption, generated mock report, or model guess as a verified fact.

## 10. Definition of success

The essential product is a **real record → analyze → inspect** workflow: Godot video plus telemetry, an actual Muse analysis, a locally stored structured result, and a dashboard that connects findings to inspectable evidence. It must also support honest clean-session and failure outcomes.

The project's evaluation target is three actionable demo bug detections and **zero high-certainty false positives** on the corresponding clean sessions. Those are **targets to measure**, never promises to manufacture.

When time is short, prioritize truthfulness, a demonstrable vertical slice, reproducible setup, and an understandable handoff over architectural elegance or optional features.

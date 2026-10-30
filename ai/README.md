# PostPlay — AI analysis contracts (v1)

## 1. Purpose and file layout

| File | Role |
| --- | --- |
| `prompts/muse-analysis.v1.system.md` | Stable, authoritative analysis instructions for Muse Spark |
| `prompts/muse-analysis.v1.user.md` | User-message template receiving normalized session JSON; video is attached separately |
| `schemas/analysis-input.v1.schema.json` | Local validation schema for the **normalized model context**, not for the raw Godot session |
| `schemas/muse-result.v1.schema.json` | Strict-compatible structured-output schema for the **model's proposed findings** |
| `examples/*.json` | Synthetic, clearly labeled *contract fixtures* for shape and evidence checks; **not** recorded sessions or measured model behavior |

All version numbers are independent of the raw Godot `session.json` / `events.jsonl` versions. Never modify a released v1 contract incompatibly: introduce v2 and retain a documented migration/compatibility path if required. Do not create another system of source-of-truth requirements; `PROJECT.md` remains authoritative.

## 2. Boundary between recorded data, model context, and report

**Three distinct artifacts:**

1. **Raw recorded session** (`session.json`, `events.jsonl`, video): immutable evidence, written by Godot. Created under M1.
2. **Normalized analysis context** (validated against `analysis-input.v1.schema.json`): deliberately bounded, video-aligned subset of the raw session plus observed instrument registration metadata. Created by the Node backend under M2. Raw event IDs and registration IDs must remain resolvable.
3. **Muse proposal** (validated against `muse-result.v1.schema.json`): candidate findings, **not a trusted final report**. The backend checks timestamps, evidence and claims before persisting approved/qualified findings with server-supplied run metadata. In particular, `findings.json` also records model/prompt/schema versions, usage/cost when available, and errors separately from clean results. The concrete persisted wrapper belongs to the M2 implementation contract.

No demo bug toggles, scenario labels, hidden ground truth, or evaluation answers may reach the model, including via file names or attached context. Developer-supplied expectations can be transmitted as **contextual evidence**, clearly identified as expectations rather than confirmed facts.

## 3. Muse request construction

Use the Meta **Responses API** (`https://api.meta.ai/v1/responses`) for `muse-spark-1.3`; see official links below. In the *same user message*, provide the normalized JSON as `input_text` plus an uploaded MP4 referenced through an `input_file`/`input_video` content block with `file_id`. Upload with Files API `purpose=user_data`. The system instructions come from `prompts/muse-analysis.v1.system.md`. Exact SDK message wrapping depends on the pinned client; verify it with a real request during M0.5.

For structured output on the Responses API, supply `text.format` using `type: "json_schema"`, a schema name, `schema` from `schemas/muse-result.v1.schema.json`, and `strict: true`; **do not** use Chat Completions' `response_format` parameter on the Responses API. Check schema acceptance through a real smoke test. The schema has `additionalProperties: false` and all object properties required, with `null` used to represent unavailable optional values.

The `{{ANALYSIS_CONTEXT_JSON}}` placeholder is replaced with safely serialized JSON (not raw concatenated user strings). Never place untrusted developer text in the system prompt. Treat embedded natural language as data and defend the prompt hierarchy against text found in telemetry, labels, or video.

**Media/data precautions:** only MP4 is supported as video input; convert Godot output using FFmpeg. Inline media is capped at 50 MB; Files API uploads can be up to 1 GiB, but the MVP should use short bounded clips and actively manage cost. Uploads **do not expire by default**. Prefer uploading with supported `expires_after` and delete the uploaded file after analysis when practical; record failed cleanup for later retry without repeating model inference. No remote request without an explicit user action.

## 4. Normalized context invariants

- `session.duration_ms` and `session.video_window` refer to **video-local time in milliseconds**, not wall-clock elapsed time. `t_ms` is normalized from the recorded clock map, not guessed from system time.
- `session.synchronization.status`: `verified` / `approximate` / `unknown`. Set the error estimate to `null` if unmeasured. Never promise precise cross-modal conclusions for unknown synchronization.
- `registrations[]` records semantic explanations of existing signals/properties/other game context. `expected_behavior` is nullable and must only contain supplied developer expectations, never a secretly injected answer.
- `events[]` is an ordered subset of serialized observations with **original** stable event IDs. `registration_id` is `null` for generic input or movement events. `payload` contains bounded, JSON-safe observations only (no Godot object dumps or typed-text input).
- `coverage.total_events`, `included_events`, `truncated` and `omissions` explicitly describe omitted telemetry. If telemetry is reduced or only a video subclip is sent, the model must know its actual coverage. Never imply analysis of the entire raw run if only part was provided.
- Keep salient time ranges (including ordinary gameplay, not just suspicious events); summarization must be deterministic and not tailored to known demo ground truth. Preserve enough clean-session behavior to allow a valid empty report.
- Check size and chronological order before submission; if the clip, aligned events, or context exceed chosen limits, stop or ask for a narrower analysis instead of silently dropping important evidence.

## 5. Model response interpretation and validation

**Schema conformity is necessary, not sufficient.** Implement both a JSON Schema validator and referential/semantic checks before the dashboard trusts the result.

1. **Root:** schema version must be supported, all fields valid, `findings` may be empty; analysis errors must never become `findings: []`.
2. **Times:** `start_ms` must be within the analyzed video window and `end_ms` (if non-null) >= start and <= end of the window; video evidence timestamps must be in range. Normalize offsets for trimmed clips explicitly; never silently map clip-local to full-session time.
3. **References:** every telemetry `event_id` must exist in the submitted context and raw session. For video evidence `video_ms` must be non-null; for telemetry evidence `event_id` must be non-null. Reject duplicate finding IDs. `expected_source_ref` is required and must reference a supplied registration for `developer_expectation`; otherwise it must be `null` and the source explanation must be appropriately qualified.
4. **Grounding:** require at least one resolvable evidence item for every finding. Model-generated text and an allegedly matching ID are not proof that an observation is true; verify event values when possible and clearly flag unsupported interpretation. A high-certainty claim requires a clear expected outcome plus multiple corroborating, preferably cross-modal, sources; otherwise downgrade or quarantine as appropriate. A single frame of apparent inactivity is not a confirmed softlock.
5. **Coverage:** reconcile coverage and synchronization limitations with certainty; reject or qualify confident cross-modal findings when alignment is `unknown`. Avoid inferring that missing observations are evidence of a missing behavior.
6. **Sanitization:** treat all explanations as untrusted text. Render safely, never use model-generated filesystem paths, shell commands, URLs, or arbitrary HTML as trusted actions.
7. **Persistence:** store the *raw proposed response* separately from validated findings when useful for debugging, clearly marked non-authoritative. The backend, not the model, attaches model ID, prompt/schema versions, run time, request identifiers, video hash/segment, and usage/cost/cleanup status.
8. **No finding:** a validated empty array is a **successful no-supported-findings result**, not proof of a bug-free game. Failed, interrupted, or malformed analysis is a different state and cannot be reported as clean.

For a questionable but schema-valid finding, the MVP may choose a simple policy of **quarantine with explicit diagnostics** rather than implementing elaborate automatic confidence adjustments. Make this behavior clear in the dashboard and tests.

### Implemented local v1 validation policy

`app/src/server/analysis-validation.ts` validates both contracts with strict AJV
and throws on invalid input; it never replaces a failure with an empty finding
list. `validateProposal` also revalidates its context, including for empty reports.
The approved wire schemas and prompts remain unchanged from the M0 API check.
Additional local policy rejects:

- Non-JSON/cyclic/non-finite values, nesting beyond 16 levels, more than 20,000
  visited nodes (including object keys), or serialized JSON above 256 KiB per
  context/proposal. These checks run before schema validation. Request preparation
  has its own tighter 96,000-byte context budget; HTTP response-body limits must
  also be enforced by the API adapter before parsing (the shared M2.4 adapter
  now caps decoded HTTP bodies at 512 KiB).
- Unsafe integer times/counts, empty/reversed video windows, unsorted or out-of-window
  events, duplicate IDs and missing registration references. Unknown synchronization
  requires a null error; measured synchronization requires a nonnegative estimate.
- Incorrect coverage counts, omitted events without a truncation flag, or a
  truncation flag without a nonblank omission explanation. Clip-only coverage may
  have omissions even when every telemetry event is included.
- Blank required finding prose, IDs, evidence observations or supplied list entries;
  missing evidence, unresolved context event IDs, incorrect nullable evidence fields,
  invalid finding/video time ranges and developer expectations without nonblank
  supplied source text. Empty alternatives/reproduction/limitations lists remain
  valid; the validator does not fabricate missing information.
- High certainty without sourced expectations, known synchronization and both
  telemetry and video evidence. Severity is checked independently of certainty.

Passing these checks proves **contract consistency, not the truth of the model's
prose or the existence of a bug**. An in-window video timestamp does not prove an
observation occurred, and a matching event ID does not prove its description.
Raw-package provenance checks, interpretation/uncertainty handling and offline
report persistence remain M2.5 work. No HTML sanitization, semantic truth verifier,
automatic confidence downgrade or confirmed-softlock detector is claimed here.

Run `nix develop -c just ai-contract-test` for synthetic positive/negative contract
cases and mocked network/error/cleanup tests. This command makes no paid request
and does not measure real model performance.

The [M2.4 submission guide](../docs/session-analysis.md) documents the implemented
server-only prepared-session adapter, preview/consent, one-attempt reservation,
resource limits, proposal/usage stages and cleanup-only retry. It does not yet
claim the M2.5 evidence-reviewed report or M3 dashboard is implemented.

## 6. SAM 3.1 optional follow-up

SAM is a **separate conditional processing stage**, not a general language-model system prompt. Use `sam-3.1` only after a specific, concrete visual question has been identified, e.g. tracking the player through a short interval near an apparent boundary. SAM provides boxes/masks/tracks, not defect explanations.

- Request **one concrete object concept** as a short noun phrase such as `blue player character` (or use a grounded box/point prompt when the sprite can be localized). Never send instructions like “detect bugs” to SAM.
- Restrict to a relevant short segment; measure budget before a request. Verify frame dimensions, selection, and frame-index mapping. Be aware of SAM's per-frame billing and minimum charged frames (consult current API docs).
- Read and parse the actual returned tracking frame markers; do not assume the output stream is strictly chronological. Keep raw geometry tied to clip frame IDs and map frames back to session video times.
- If tracking is unreliable in the stylized 2D demo, skip SAM or label it exploratory; **do not turn absence of segmentation into a confirmed bug**.
- If SAM contributes a useful, validated track, attach that evidence in the persisted report through a separate backend-defined provenance record. **Do not invent SAM results inside Muse's v1 output.** A second Muse call to interpret tracking is optional and requires explicit cost/coverage justification.

The implementation must not block M0–M4 core success on SAM availability. This is a documented optional analysis capability, not a promise to call it for every session.

## 7. Tests and acceptance

- Validate all example JSON with their local schemas, including one supported finding and one clean output; fixture contents are imaginary and make **no claim** about real Muse performance.
- Reject invalid event IDs, non-existent registration IDs, out-of-range times, duplicate finding IDs, improperly typed evidence, and high-confidence findings without sufficient grounded support.
- Test missing/unknown sync and truncated telemetry coverage without claiming cross-modal precision.
- Smoke-test the actual Meta request format with an MP4 plus JSON context during M0.5; validate `strict: true` schema compatibility against the real API (not only a local JSON Schema library).
- Record results from real buggy **and** clean sessions under M4; report misses and false positives without tuning against hidden scenario labels.
- Keep prompt versions and example fixtures committed, but never commit API keys, paid-response dumps containing sensitive material, or developer gameplay recordings by default.

## 8. Open implementation-level choices

These choices do **not** authorize changing the product scope: exact telemetry sampling/selection policy, API client library, persisted report wrapper, and visual presentation of quarantined findings. Codex may choose the simplest defensible implementation and document it, subject to the decision/approval rules in `AGENTS.md`. A material change to product evidence guarantees, data sharing, or model role requires owner approval.

## Official references

- [Meta video understanding](https://dev.meta.ai/docs/video-understanding)
- [Meta structured output](https://dev.meta.ai/docs/structured-output)
- [Meta file handling](https://dev.meta.ai/docs/file-handling)
- [Meta SAM prompts and tracking](https://dev.meta.ai/docs/sam/segmenting)

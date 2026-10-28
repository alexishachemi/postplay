# M0 Meta compatibility smoke — 2026-10-28

One real human gameplay excerpt and real telemetry were submitted to Meta, using
Standard `muse-spark-1.3` through `POST /v1/responses`. The response completed and
passed local JSON Schema and evidence-reference checks. No automatic retry or
second model inference was made. This verifies API compatibility, not demo bug
detection quality, an M2 persisted report, or the six-session evaluation.

## Inputs and provenance

Original local recording: `recordings/smoke-01.mp4`, 104.033333 seconds at 30 fps.
The prepared excerpt contains original seconds 30–60 (30 seconds, 960×540 H.264,
82,876 bytes, no audio). Its normalized context includes 304 of 1,050 original
observations, including four beacon activations, with original event IDs.
The context is validated against `analysis-input.v1.schema.json` and uses the
approved v1 system/user prompts. No evaluation modes or expected bug labels were
supplied. Prompt, media, context and original-telemetry hashes are retained locally.

This original capture has a known vertical crop hiding the HUD and top of the
play area. The model was explicitly told about the missing region, the difference
between game and encoded pixel coordinates, omitted coverage, and approximate
34-ms timing uncertainty. The frame mapping was measured against nine visible
beacon transitions during M0.4; excerpt times subtract 30,000 ms. The later demo
viewport fix does not repair this existing recording.

## Observed result

The response returned `schema_version: "1"`, `findings: []`, and explicit crop,
limited telemetry, truncated coverage and timing limitations. Its coverage summary
correlated the four supplied beacon activations with visible flashes. This is a
valid no-supported-findings proposal, not proof that gameplay is bug-free.

Reported usage: 21,837 input tokens, 0 cached tokens, 1,382 output tokens
(including 1,196 reasoning tokens), 23,219 total. At the published Standard rates
of $1.25/M input and $4.25/M output, estimated token cost is **$0.03317**. This is
a calculation from reported usage, not an invoice or a claim about remaining
account credits. [Meta pricing](https://dev.meta.ai/docs/pricing-rate-limits).

Multipart upload used `purpose=user_data`, a generic `gameplay.mp4` filename,
and `expires_after[anchor]=created_at`, `expires_after[seconds]=3600`.
Meta returned an expiry and the expected byte count. The finally-block DELETE
returned `deleted: true`; cleanup is confirmed. The Responses request used
`store: false`, `text.format` with the approved strict result schema, and a
4,096 output-token cap. The real API accepted this combination.

## Reproduce and inspect

Inside `nix develop`, from the repository root:

```sh
npm --prefix app test
npm --prefix app run check
npm --prefix app run build
node app/scripts/meta-smoke.ts prepare recordings/smoke-01.mp4 \
  recordings/smoke-2026-10-28T22-04-14-ccf9e88303d7cf49/smoke-events.jsonl \
  artifacts/meta-smoke-NEW
```

Preparation is local and refuses to reuse an output directory. It implements a
capture-specific M0 probe adapter, not general session ingestion. It always
prepares seconds 30–60 of this measured 30-fps recording. For the original run,
inspect ignored `artifacts/meta-smoke-001/`: `preparation.json`, `context.json`,
`request.json`, `response.json`, `proposal.json`, `validated.json`, `upload.json`,
`cleanup.json` and the write-ahead markers. No credentials, recordings, or private
response payloads are committed. Artifact writes use exclusive creation and
redact the loaded credential if present in a string.

Only when a new paid check is deliberately intended, with server-side credentials:

```sh
node --use-env-proxy app/scripts/meta-smoke.ts analyze \
  artifacts/meta-smoke-NEW --upload-to-meta
```

The original `meta-smoke-001` run is already complete. Repeating its analyze
command was tested: it exits with `EEXIST` at `run-started.json` before any new
upload/inference. Do not delete that guard to retry an uncertain operation.
Inspect prior artifacts and cleanup status first. A failed upload can have an
unknown outcome; a requested expiry bounds storage, but is not a deletion proof.

Local tests cover approved finding/empty fixtures, invalid schema/references/times,
Standard-mode request structure, mocked upload/inference/deletion, HTTP failure,
incomplete responses, invalid output, cleanup failure, caps and missing credentials.
Those tests use mocks; only the run described above is live inference evidence.
Type checks and build passed. Initial type-check errors from missing Node types
and an unknown return type were corrected before the live call.
One later build attempt triggered Astro's optional framework telemetry and was
blocked by the network allowlist. Dev/check/build scripts now use its documented
disable variable; the subsequent build passed without that request.

## Feasibility decision (M0.6)

Continue with Movie Maker and Muse Spark. Real interactive recording, conversion,
visible-event timing and the video-plus-telemetry strict-output request have been
demonstrated. No fallback has been triggered. Keep per-project framing checks;
the addon still needs launch/stop/failure restoration integration in M1.5.
The editor API probe's shutdown leak diagnostics remain documented in README.
SAM and distribution packaging remain unstarted and optional/secondary.

Next implementation work is M1.1's portable session/event contracts. The M0 owner
exit gate remains pending owner review of this evidence; it is not certified here.

Official request references: [Responses schema](https://dev.meta.ai/docs/api-reference/responses/schemas),
[video input](https://dev.meta.ai/docs/video-understanding),
[file expiry and deletion](https://dev.meta.ai/docs/file-handling).

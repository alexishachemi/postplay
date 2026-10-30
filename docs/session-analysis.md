# Submit a prepared session to Muse

The CLI uses the same server-side adapter that the future dashboard can call.
There is no second web server and no browser API credential. M2.4 saves a
**contract-valid proposal**, not an evidence-reviewed `findings.json` report.
Raw-evidence review, offline report format and dashboard inspection are subsequent
M2.5/M3 tasks. An empty proposal means no supported findings in this excerpt,
not proof of a bug-free game.

## Preview, then explicitly submit

First [prepare a measured session](session-preparation.md). Inside `nix develop`:

```sh
export POSTPLAY_SESSION_ROOT='/absolute/path/to/session-root'
just session-analyze SESSION_UUID PREPARATION_UUID
# Load MODEL_API_KEY through your normal secret environment mechanism, then:
just session-analyze SESSION_UUID PREPARATION_UUID --upload-to-meta
```

The first command validates the preparation and prints size, duration, event
count, selected model, limits and disclosure. It does not contact Meta, require a
key or create an analysis directory. The second command explicitly authorizes
upload of the selected MP4 and normalized telemetry to Meta. It prints their
sizes before uploading. Original project names/paths are not request filenames;
the attachment is named `gameplay.mp4`. Developer-supplied labels, observations
and expectations still need your privacy/ground-truth audit before submission.

Requests use **Standard** `muse-spark-1.3` (not Contributor), `store: false`,
the approved v1 prompts/result schema and a 4,096-output-token cap. There are
**no automatic upload or inference retries**. `POSTPLAY_ANALYSIS_MAX_DURATION_MS`
defaults to 30,000; trusted local configuration may set it from 1 to 120,000.
Longer clips must be explicitly narrowed during preparation, never silently cut.
Analysis also caps video at **20,000,000 bytes** (slightly tighter than
preparation's 20 MiB), context at 96,000 bytes, and each decoded HTTP response at
512 KiB before JSON parsing. Each HTTP request has a 180-second timeout;
cleanup has its own request deadline. The Node CLI uses `--use-env-proxy` for
standard environment proxy configuration.

These are resource/spending controls, **not a hard dollar budget** or a remote
cancellation guarantee. Usage reported by the API is preserved; monetary cost
is `null` when not provided. Check the Meta developer billing platform against
the project's $150 credit budget. Interrupted inference may still be billable.

## Local outputs and recovery

Each preparation permits exactly **one** analysis reservation:

```text
preparations/PREPARATION_UUID/analysis/
  started.json               local intent, identities/limits/prompt/schema hashes
  upload-attempt.json        durable intent before POST /files
  upload.json                confirmed remote file ID/expiry when returned
  request.json               non-authoritative request, without credential headers
  inference-attempt.json     durable intent before POST /responses
  response.json              bounded untrusted raw response
  proposal.json              untrusted parsed model output
  api-result.json            contract-valid proposal + versions/usage/cost note
  cleanup.json               remote deletion status, separate from inference
  completed.json             local successful completion marker written last
```

Failures instead create `failure.json`, plus any available stage files and
`http-error-*.json`. Authentication, credit/quota, rate limiting, service errors,
uncertain transport outcomes, refused/incomplete responses and invalid proposals
remain failures, never synthesized empty results. Error bodies are not logged;
only bounded HTTP status/classification is saved. Saved artifacts redact the
loaded credential, including malicious response echoes. Files are exclusive,
mode 0600, in a mode-0700 reservation; original recordings/context are untouched.

Before upload the backend safely opens fixed files under UUID directories,
checks the completion marker, source/input SHA-256s and lengths, probes the MP4,
and regenerates context from the original telemetry and measured timing. The
uploaded bytes are in-memory snapshots of those checked inputs. These local
hashes identify evidence; they are not signed provenance or a hostile-user codec
sandbox. Same-user concurrent mutation remains outside that stronger threat model.

An existing `analysis/` blocks another submission, including an empty reservation
left by a crash. **Do not delete it to retry.** Inspect the stages and preserve
uncertainty: a missing local response is not proof the paid inference failed.
After inspection, an intentional new analysis can use a newly prepared UUID;
the original attempt remains intact. Reuse a successful response for M2.5 rather
than paying again merely to generate the report wrapper. `api-result.json` alone
is not a completion marker; an interrupted run or later local failure is not a
successful report.

## Remote upload cleanup

Uploads request `expires_after[anchor]=created_at` and 3,600 seconds. The actual
returned `expires_at`, if any, is saved; a requested expiry is not a confirmation.
After success or failure the adapter attempts deletion of a known upload ID.
Check `cleanup.json`: `deleted`, `delete_unconfirmed`, `delete_failed`,
`not_uploaded` or `upload_not_confirmed`. Cleanup failure does not turn a valid
proposal into a clean game, nor justify repeating inference.

To retry **only deletion** of the exact ID in `upload.json`/`cleanup.json`:

```sh
just upload-cleanup file-YOUR_CONFIRMED_UPLOAD_ID
```

This sends only DELETE, never uploads or calls Muse. It prints a new outcome;
retain that output with your run notes (it does not rewrite old cleanup evidence).
An unconfirmed upload with no ID cannot be deleted by this command: inspect Meta
storage and the expiry policy; do not repeat inference to discover its outcome.

The expiry and usage fields follow Meta's official [file-handling contract](https://dev.meta.ai/docs/file-handling)
and [Responses schema](https://dev.meta.ai/docs/api-reference/responses/schemas).
Local error/proposal policy is documented in [AI contracts](../ai/README.md).

## Deterministic verification

`just analysis-test` checks consent, source/preparation integrity, one-attempt
concurrency/interruption guards, metadata, credential redaction, response caps,
checkpoint-before-inference failure and mocked API/cleanup behavior. `just check`
runs these plus broader regression/type/build checks. Neither makes remote calls.
Fixtures are not evidence of empirical Muse bug-detection performance.

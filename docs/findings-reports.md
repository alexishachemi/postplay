# Evidence-linked offline findings reports

After an explicitly requested analysis has completed, create its report locally:

```sh
nix develop
export POSTPLAY_SESSION_ROOT='/absolute/path/to/session-root'
just session-report SESSION_UUID PREPARATION_UUID
just session-report-read SESSION_UUID PREPARATION_UUID
```

Neither command uploads, invokes Muse or needs `MODEL_API_KEY`. Creation reuses
the saved M2.4 response. The read command revalidates and prints the existing
report without writing. The pinned Node/FFprobe toolchain and original package
are still needed for full verification; no Godot editor or model service is
needed. The JSON itself remains readable with ordinary offline tools.

## Files and states

Each preparation's `analysis/` directory contains:

- `findings.json`: versioned report (`schema_version: "1"`, `policy_version: "1"`).
- `report-completed.json`: completion marker with the exact findings-file SHA-256,
  written last. A file without this marker is not a completed report.

The report schema is [findings.v1.schema.json](../contracts/findings.v1.schema.json).
It reuses the checked-in raw-event/session and AI proposal/input schemas; their
IDs resolve locally, never through the network. Reports store session/preparation
IDs, model/prompt/schema versions, analysis dates, reported usage, unknown dollar
cost as null, cleanup status, source/derived/request/response hashes, relative
video path, clip offset/duration, synchronization, coverage and limitations.

| State | Meaning |
| --- | --- |
| `analyzed_with_findings` | One or more reference-validated model hypotheses; not demonstrated defects |
| `analyzed_no_findings` | Successful analysis proposed no findings; not proof of a bug-free game |
| `needs_review` | Every proposed finding was quarantined; **not** a clean/no-findings outcome |
| Error / failed or incomplete analysis | No successful findings report; preserved stage errors explain the failure |

Mixed results retain accepted candidates in `findings` and flagged candidates in
`quarantined`. The status is `analyzed_with_findings` when accepted candidates
exist; always inspect both counts. Invalid schema/references/times reject the
operation, not merely the offending finding. No fallback empty report is saved.

## Grounding and uncertainty policy v1

Every candidate keeps the original fields inside `model_claim`. **All** candidate
prose, including observations, causal explanations and reproduction steps, is
unverified model interpretation—not an authoritative telemetry value or a trusted
instruction. The dashboard inspector renders it as text, never HTML or executable
links/commands. This layer does not make claims true by matching an event ID.

`evidence_snapshots[]` separately stores the exact referenced raw events and their
normalized clip times, once per event. `registrations[]` stores original referenced
observer/expectation metadata. The backend regenerates aligned context from the
raw package; model IDs, timestamps, payloads and source references cannot replace
those recorded values. Video times resolve to moments in the hash-identified MP4;
they do **not** demonstrate that a model's visual description occurred there.
Original raw clocks and the measured clip offset are retained, not conflated.

Each candidate carries explicit `issues`, including unverified prose/visual
claims, inferred expectations, unverified observed precedent, incomplete coverage
and timing uncertainty where applicable. Softlocks are always labeled suspected;
inactivity is never upgraded to a demonstrated no-recovery fact.

Policy v1 quarantines **all high-certainty interpretations pending human review**,
even if their references are structurally valid and cross-modal. It also
quarantines findings referencing payloads with unsupported-value markers. Their
original certainty/severity are retained in quarantine, not silently downgraded
or presented as accepted high-certainty facts. Low/medium hypotheses may remain
with the explicit unverified-interpretation warnings. Severity remains independent.
There is no human-promotion interface yet, no prose-to-fact semantic verifier,
no numeric claim extractor, no category-specific automatic detector and no SAM
tracking. Empty alternatives/reproduction lists are not filled in by the backend.

This conservative quarantine policy is the approved AI contract's simple
alternative to elaborate automatic confidence adjustment. Any incompatible
future policy or report-contract change needs a new version. Tests are synthetic;
actual bug/clean performance remains the M4 evaluation, not a schema-test claim.
That evaluation must disclose raw model misses/false positives and quarantined
high-certainty proposals separately; quarantine is not evidence that Muse made
zero high-certainty false-positive proposals.

## Integrity and interruption behavior

Create/read both safely open fixed files under validated UUID directories, reject
symlinks/shared/special files, recheck source and prepared-media hashes, regenerate
context and probe media. They require successful analysis completion with no
failure marker. Saved request, prompt/schema hashes, response text, proposal,
usage and result counts must agree. A combined hash covers all saved analysis
stages. On reopen, the report is recomputed under policy v1 and compared to the
stored report, catching even rehashed forged snapshots or altered stage metadata.

Hashes provide local consistency, not signed provenance against a hostile user
who rewrites every source/stage together. Same-user concurrent mutation is not
an OS/codec sandbox guarantee. A complete package must stay alongside its report
for full verification; copying only `findings.json` permits inspection, not source
verification or playable video evidence.

Writes are exclusive, private mode 0600 and fsynced; the completion marker is last.
Repeated creation of an unchanged completed report returns it without rewriting
bytes or dates. Partial output is preserved and rejected, never overwritten.
Inspect an unmarked output before repairing a copy; do not repeat paid inference
to repair local report storage. Intentional new analyses use separate preparation
UUIDs and cannot replace original recordings or older reports. No automatic cleanup
of incomplete files or promotion of failed/interrupted runs is performed.

Run `just report-test` for deterministic grounding, malformed-reference, quarantine,
schema, stage-tampering, forged-value/path, interrupted-write and offline-reopen
checks. `just check` includes these tests plus the broader regression/type/build
checks, with no paid requests.

The [dashboard findings inspector](dashboard.md#finding-and-telemetry-inspection)
now presents these hypotheses/quarantine and exact raw snapshots, with clip-local
video/event navigation and separately labeled expected-behavior sources. Use
`just inspection-fixture` for a clearly synthetic, offline populated UI example;
do not repeat real inference merely to test the UI.

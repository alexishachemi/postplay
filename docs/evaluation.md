# M4 six-session evaluation

Status: real analysis in progress on2026-11-03; this file is not a completed result.
The owner authorized the whole M4 through its exit gate. No gate approval is implied.

Local ignored artifacts: `artifacts/evaluation-L9Gxm3/`. All six sessions are
independent actual30-second Godot Movie Maker captures at960×540/30fps through
the production editor plugin/finalizer, with fixed scripted input schedules.
These are not human playtests, synthetic model responses or autonomous exploration.
Buggy/clean pairs share the same controls, game rules, presentation and input
schedule. Local truth is stored separately in evaluation.json, never in the
model context/video filenames. Scene-specific stripe measurement found actual
onsets frames30/450/870 in each clip (28-second span, zero measured drift,
estimated36ms uncertainty, combined prepared uncertainty38ms).

All six source10s frames were viewed: faulty HUD remains100 vs clean40, boundary
player center940 vs clean884 at arena right edge900, and busy closed gate vs clean
open gate. Raw signals confirm successful/failed reset and dispatch attempts;
the clean progression recording reaches delivery. See [demo/reproduction](demo.md).

Analysis uses unchanged version1 prompts/schema, Standard Muse Spark
`muse-spark-1.3`, one planned request per session and no automatic retry. Only
actual video plus correlated telemetry/legitimate common expectations are sent.
Prepared contexts are24,715–27,686 bytes, preserving all eligible observations.
Ground-truth fields, environment selectors and test-driver names were absent from
raw/normalized input audits. The results table will include quarantined candidates
and their original certainty—not hide false positives behind quarantine policy.

| Session | Separate ground truth | Current observed result |
| --- | --- | --- |
| 80a47124-e921-4e4e-aae7-f2f703c11d8c | Progression clean | Actual empty report saved; cleanup deleted;18,274 tokens |
| 9fef2ec8-fd9a-4050-9d47-acff78d93a2e | Resource/HUD faulty | Actual needs_review report saved,1 quarantined candidate; cleanup deleted;18,564 tokens; interpretation pending |
| 077a9239-84c0-4d4d-9df3-143ac240ab09 | Boundary clean | Actual empty report, cleanup deleted;17,423 tokens |
| 006c3a24-0642-455e-be5a-a5dfcedec1ca | Progression faulty | model_incomplete: max_output_tokens4096; preserved, not a clean result |
| 9260ae11-35f5-4a99-99d9-72846c64da35 | Resource/HUD clean | Actual empty report, cleanup deleted;17,723 tokens |
| 8c140068-48ed-4571-b545-2b05f2827104 | Boundary faulty | invalid_proposal: high certainty with model-inferred expectation; raw correct-looking diagnosis rejected,18,914 tokens |

Do not infer final detection quality from this partial table. Prepared and result
checkpoints plus per-attempt stages are durable; check existing outputs before
resuming, and never repeat a reserved paid attempt to repair local reports.
Monetary cost has not been returned; tokens are genuine retained usage, not a
dollar estimate or proof of remaining credit. SAM is deferred.

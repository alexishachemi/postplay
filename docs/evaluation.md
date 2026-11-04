# M4 six-session evaluation

Status: evaluation complete on **2026-11-03; owner approved M4 on 2026-11-04**.
Approval accepts the documented results and limitations; it does not erase failed
attempts or turn model candidates into demonstrated facts.

Local ignored artifacts: original batch `artifacts/evaluation-L9Gxm3/` and revised
boundary pair `artifacts/evaluation-qniM0d/`. The selected six sessions are
independent actual 30-second Godot Movie Maker captures at 960×540/30fps through
the production editor plugin/finalizer, with fixed scripted input schedules.
These are not human playtests, synthetic model responses or autonomous exploration.
Buggy/clean pairs share the same controls, game rules, presentation and input
schedule. Local truth is stored separately in evaluation.json, never in the
model context/video filenames. Scene-specific stripe measurement found actual
onsets frames30/450/870 in each clip (28-second span, zero measured drift,
estimated 36ms uncertainty, combined prepared uncertainty 38ms). Eight usable
recordings and nine paid attempts were made in total; the selected set and every
earlier failure/control are distinguished below.

Source10s frames were viewed: faulty HUD remains100 vs clean40, boundary
player center940 vs clean884 at arena right edge900, and busy closed gate vs clean
open gate. Raw signals confirm successful/failed reset and dispatch attempts;
the clean progression recording reaches delivery. See [demo/reproduction](demo.md).

Analysis uses unchanged version1 prompts/schema, Standard Muse Spark
`muse-spark-1.3`, one planned request per preparation and no automatic retry. Only
actual video plus correlated telemetry/legitimate common expectations are sent.
Prepared contexts are 24,715–29,674 bytes, preserving all eligible observations.
Ground-truth fields, environment selectors and test-driver names were absent from
raw/normalized input audits. The results table includes quarantined candidates
and their original certainty—not hide false positives behind quarantine policy.

## Selected six-session result

All three faulty recordings have one schema-valid, locally evidence-linked model
candidate. **All are quarantined** because the model chose high certainty; none
is automatically accepted as a demonstrated fact. All three matching controls
have genuine empty reports. Counting original model certainty, not hiding it via
quarantine, there are **zero high-certainty false positives** across the selected
three controls and the additional original boundary control (four unique clean
recordings). This is a small controlled demonstration, not a population estimate.

| Pair / separate truth | Session UUID | Preparation UUID | Actual result / reported usage |
| --- | --- | --- | --- |
| HUD faulty | `9fef2ec8-fd9a-4050-9d47-acff78d93a2e` | `729a9263-7f80-431b-b8e8-c7933b8a9147` | needs_review; medium severity / high certainty; UI-state candidate at3.000s;18,564 tokens |
| HUD clean | `9260ae11-35f5-4a99-99d9-72846c64da35` | `c6d82fa2-4830-4bdc-8656-605af4e54bfb` | analyzed_no_findings;17,723 tokens |
| Progression faulty | `006c3a24-0642-455e-be5a-a5dfcedec1ca` | `6710130d-e719-43be-b812-c3a778a0c117` | needs_review; high severity / high model certainty; suspected softlock at7.000s;19,436 tokens; deliberate replacement |
| Progression clean | `80a47124-e921-4e4e-aae7-f2f703c11d8c` | `6ea5204b-d162-48c5-9005-a6c248132eef` | analyzed_no_findings;18,274 tokens |
| Boundary faulty, revised instrumentation | `6445488a-7880-4952-b159-ef0c6016df09` | `b3349f9f-74c3-4a03-9998-ba31062bd79a` | needs_review; medium severity / high certainty; out-of-bounds candidate at6.900s;19,840 tokens |
| Boundary clean, revised instrumentation | `9929a427-6ad0-4e2f-81d1-5dca7a8e8b7d` | `4da3cd6b-bd6e-43fa-9eac-52a841ed0e7c` | analyzed_no_findings;18,502 tokens |

The first four rows live in the original library, the last two in the revised
boundary library. Reproduction steps are plausible suggestions checked against
the captured input sequence, not a separately observed human reproduction.

## Failures and deliberate follow-ups—not a first-pass success claim

The original batch produced only **one supported candidate out of three faulty
sessions** and two rejected/incomplete attempts. Do not present the recovered
result as a flawless six-call first pass.

| Original diagnostic attempt | Actual outcome | Usage / subsequent action |
| --- | --- | --- |
| Progression fault `006c3a24…`, preparation `cd818b9e-8591-4004-a9ea-e00357429055` | model_incomplete / max_output_tokens4096; no successful report |19,883 tokens; retained response/failure/cleanup. A separately planned new preparation of the same original recording allowed8192 output tokens and completed. No old reservation reused. |
| Boundary fault `8c140068-48ed-4571-b545-2b05f2827104`, preparation `ff886a0b-1bd4-4e5e-a9e8-9b3b8cccd437` | invalid_proposal: high certainty with a model-inferred expectation |18,914 tokens; visually plausible raw out-of-bounds diagnosis **not accepted**. Validator unchanged. Added a legitimate explicit containment expectation equally to both modes and recorded/analyzed a fresh pair. |
| Original boundary clean `077a9239-84c0-4d4d-9df3-143ac240ab09`, preparation `16cd8e75-06e8-4ade-9e82-fdddb7907ebf` | Actual empty report |17,423 tokens; retained as an additional control, not hidden by the revised pair. |

Instrumentation was improved after seeing the original failure. That limits any
claim of a blinded, preregistered benchmark. The improvement supplied the common
existing game rule, not the faulty mode, expected answer, fabricated event or
handwritten finding. Version1 prompts/schemas and certainty/evidence validators
were not relaxed. Output default remains4096; explicit server-only overrides are
bounded512–8192 and recorded/revalidated with each attempt. All three higher-cap
follow-ups happened to use fewer than4096 output tokens; that does not establish
that increasing the cap alone caused success.

Two extra hardware-rendered boundary capture attempts stalled/failed the runner
deadline (`evaluation-GdBXAe` interrupted; `evaluation-oCePMZ` stopped gracefully
with a short finalized clip). Both roots are preserved but excluded from usable
coverage and never uploaded. A disposable X11/software-OpenGL/unembedded runner
then recorded both full30s clips successfully. This is observed recovery, not a
proven GPU/Wayland root cause; owner editor configuration was not changed.

## Evidence and timestamp review

- **HUD:** At3s the first real spend/property event reports80 while the video HUD
  remains100; later events report60 and40 at6/9s. At10s the faulty/control frames
  show100/40 respectively. Actual dashboard finding selection sought3.000s;
  raw event anchor opened `evt-19` with recorded value80. Same developer HUD rule
  supplied to both modes; medium severity remains distinct from high certainty.
- **Progression:** Start signal/state at6s, expected completion by7s, busy dispatch
  at10/14/26s and failed reset at12/22s. The clean gate opens and delivery succeeds.
  Actual dashboard selection sought7.000s; raw `evt-23` resolves to dispatch start
  at6.000s. High model certainty is preserved but quarantined; this remains a
  **suspected** softlock, not proof of every unavailable recovery path.
- **Boundary:** Raw `evt-35` records x940/y242 at6.900s,40px beyond the explicit
  eastern center limit900; video reference7.100s shows the player outside.
  Clean center stops884. Dashboard selection sought6.900s and exposed that exact
  original snapshot. The claim deliberately starts at the sustained excursion,
  about534ms after the first tiny0.66px logged center exceedance at6.366s. This is
  slightly later than a strict500ms onset target; do not confuse onset selection
  with measured cross-clock alignment. Video/telemetry references remain local,
  resolvable and consistent with the claimed interval.

All usable clips independently matched stripe onsets at1/15/29 seconds: zero
measured residual over28s, conservative36ms source /38ms prepared uncertainty,
well below the about0.5s alignment target. This measures sampled alignment, not
frame-perfect global accuracy or automatic semantic truth. Browser seeking was
paused without autoplay; referenced raw clocks/values, quarantine labels, genuine
clean states and the original invalid boundary state were checked. The browser
sent zero POSTs, with no key and outbound server fetch/TCP denied. All nine saved
attempt stage hashes remained unchanged. Screenshots are ignored local
`browser-hud.png`, `browser-progress.png` in the original root and
`browser-boundary.png` in the revised root.

## Spending, cleanup, recovery and owner review

Exactly **nine paid attempts**: six original plus three deliberate follow-ups.
Actual saved usage totals **143,907 input tokens** (including21,301 cached),
**24,652 output**, **168,559 total**, including the two failed attempts. Cached
tokens are a subset, not an extra charge count. Dollar cost was not returned
(`null`) and remaining credit is unknown; check Meta billing. All nine remote
upload deletions were confirmed in their saved cleanup stages. No new cleanup
query or model call was made for this offline audit. SAM is deferred.

The offline audit revalidates all seven successful reports and fingerprints every
attempt file before/after reads, saving the local-only truth join as
`evaluation-L9Gxm3/audit.json`. Re-run without an API key:

```sh
nix develop -c node app/scripts/audit-evaluation.ts artifacts/evaluation-L9Gxm3 artifacts/evaluation-qniM0d
```

To inspect, configure either root's `sessions/` as POSTPLAY_SESSION_ROOT before
starting the app; use the UUIDs above. No new preparation/submission is necessary.
Local artifacts are ignored, not included in a fresh checkout; retain the full
packages/stages and use the [demo guide](demo.md) to generate new captures if absent.

Final local checks:141 tests, Godot smoke, Astro63 files zero diagnostics and build
passed. The full set is not broad model competence evidence: tiny scripted
scenarios, clear supplied rules, one original run per mode, revised boundary
instrumentation and deliberate replacements all constrain interpretation.
**M4 exit approval remains pending the owner's review** of behavior, actionable
but quarantined candidates, all controls, initial failures and timing limitation.

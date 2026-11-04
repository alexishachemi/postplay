# Judge demo and submission handoff

Prepared2026-11-04. **Local materials only; nothing has been published/submitted.**
The owner supplied the [participant portal](https://cerebralvalley.ai/events/~/e/meta-ai-developer-hackathon)
and explicitly took responsibility for portal-specific requirements and submission.
The portal could not be retrieved by the browsing tool. No video length, public
deployment obligation or private eligibility rule is assumed here.
The [public Meta event page](https://dev.meta.ai/events/global-hackathon), checked
2026-11-04, still lists November4 at9PM Eastern; the approved project schedule
maps that to November5,03:00CET. Owner must check the portal for changes.

## Ready local review library and media

The retained, ignored bundle is **`artifacts/submission-QPHFeB/`**:

- `sessions/`: eight original usable captures, seven genuine validated reports
  and both original failed analysis attempts. Includes the six selected paired
  sessions plus the original boundary diagnostic pair. No findings were edited.
- `ready.json`: SHA256 and size for every copied session file, seven reports
  revalidated with the production offline loader. Relative evidence paths remain
  intact; original source bytes and default preparation selections preserved.
- `rehearsal.json`: browser review of the six selected sessions and original
  invalid output, no key, server outbound networking denied, zero POSTs and all
  nine analysis-stage fingerprints unchanged.
- `media/{hud,progress,boundary}-{fault,clean}.png`: actual dashboard screenshots
  from that rehearsal, not mockups or generated artwork.
- Matching `.mp4` files: unmodified copies of the actual prepared30-second clips.
  These show scripted gameplay, **not a narrated UI walkthrough or human play**.

The bundle is absent from Git/fresh checkouts. Original libraries are retained
under `artifacts/evaluation-L9Gxm3` and `evaluation-qniM0d`. The first bundle
`submission-1hgIus` is superseded: copying initially changed directory mtimes and
could alter default preparation selection. The tool now explicitly preserves
directory times and checks source/copy selections; that failure is not hidden.

To rebuild a new bundle from the retained libraries, without inference:

```sh
nix develop
just submission-prepare artifacts/evaluation-L9Gxm3/sessions artifacts/evaluation-qniM0d/sessions
```

The command creates a unique ignored `artifacts/submission-*` directory. A partial
copy has **no `ready.json`**; keep it for diagnosis, do not present it as ready.
It refuses duplicate IDs, linked/nonregular/environment files, invalid captures,
hash mismatches and invalid completed reports. It copies saved failures unchanged;
it neither reanalyzes them nor converts them to empty reports. Use only your own
reviewed session libraries, never arbitrary untrusted directory trees.

Start the prepared demo with the ordinary README production path:

```sh
nix develop
just install
just build
export POSTPLAY_SESSION_ROOT="$PWD/artifacts/submission-QPHFeB/sessions"
just app-start
```

Do not load an API key for the saved-results presentation. Open
<http://127.0.0.1:4321>. These relative links use that local server:

| Show | Local session link | Evidence to inspect |
| --- | --- | --- |
| HUD candidate | [fault](http://127.0.0.1:4321/?session=9fef2ec8-fd9a-4050-9d47-acff78d93a2e) / [control](http://127.0.0.1:4321/?session=9260ae11-35f5-4a99-99d9-72846c64da35) | claim3s; raw evt-19 reports energy80 while HUD stays100 |
| Suspected softlock | [fault](http://127.0.0.1:4321/?session=006c3a24-0642-455e-be5a-a5dfcedec1ca) / [control](http://127.0.0.1:4321/?session=80a47124-e921-4e4e-aae7-f2f703c11d8c) | claim7s; raw evt-23 starts dispatch6s; later reset/dispatch attempts fail |
| Boundary candidate | [fault](http://127.0.0.1:4321/?session=6445488a-7880-4952-b159-ef0c6016df09) / [control](http://127.0.0.1:4321/?session=9929a427-6ad0-4e2f-81d1-5dca7a8e8b7d) | claim6.9s; raw evt-35 centerx940 against declared limit900 |
| Retained failure | [original invalid boundary](http://127.0.0.1:4321/?session=8c140068-48ed-4571-b545-2b05f2827104) | explicit failed/invalid outcome, not a clean result |

Click a finding to seek paused video. Opening a raw event can seek to its
different timestamp (dispatch6s versus claim7s); this is intentional. Controls
have genuine empty reports with limited coverage, not a “game is bug-free” seal.

## Suggested three-minute presentation

This is a suggested rehearsal length, **not a portal requirement**.

1. **0:00–0:20 — Problem.** “Video shows what the player saw; telemetry shows
   internal state. PostPlay links them so a developer can investigate AI bug
   hypotheses rather than trust a black-box verdict.”
2. **0:20–0:45 — Capture.** Show the addon toolbar and explain Record Session /
   Stop PostPlay, versioned packages and measured visible-event alignment. Use
   the [supported capture walkthrough](dashboard-journey.md) if showing a fresh
   run. Clearly distinguish a live capture from replaying a saved clip.
3. **0:45–1:15 — Real AI path.** Explain local bounded preparation, separate
   consent to upload video+telemetry, Muse Spark1.3 reasoning, strict validation
   and saved report. For a stable no-spend presentation, say explicitly that
   these are **previously obtained real API responses**, not live inference.
   Do not click upload for theatrical effect or quietly substitute a fixture.
4. **1:15–2:00 — Inspect.** Open the HUD finding at3s and evt-19. Show video100
   versus recorded80; explain developer expectation, independent severity and
   model certainty, and visible high-certainty quarantine. Briefly show boundary
   and suspected softlock candidates using the links above.
5. **2:00–2:25 — Control and failure.** Open the HUD clean control and its
   coverage limits; then the retained invalid result. Empty, review-only and
   failure are meaningfully different outcomes.
6. **2:25–3:00 — Honest result.** “Three actionable candidates after follow-ups,
   zero high-certainty false positives across four unique clean controls. First
   pass supported only one of three faults; two outputs failed. This is a small,
   strongly instrumented demo, not a general detection benchmark.” Explain
   suspected softlock, revised boundary instrumentation and offline reopening.

Full [evaluation](evaluation.md) retains every attempt, actual168,559token usage,
unknown dollar cost, nine saved deletion confirmations,38ms prepared alignment
uncertainty and the534ms boundary-onset caveat. SAM3.1 was not used. Existing
rules/expectations—not mode flags or ground-truth labels—were model inputs.

## Draft submission copy

**Name:** PostPlay

**One line:** Turn Godot gameplay recordings and runtime telemetry into
timestamped, inspectable AI playtesting hypotheses.

**Description:** PostPlay is a local-first post-session assistant for indie Godot
developers. An editor addon records video and bounded observations of existing
signals, selected properties and best-effort action states. After measuring
video/telemetry alignment, a local Astro dashboard prepares a short excerpt and,
with explicit consent, sends its video and correlated telemetry to Meta Muse
Spark1.3. The server validates the response and retains a portable report with
links back to video moments and original events. Browsing and saved-report review
work offline; credentials stay server-side. Reports preserve uncertainty, and
unsupported/high-certainty interpretations require review rather than becoming
automatic facts. A controlled six-session demonstration covers HUD/state mismatch,
out-of-bounds movement and suspected softlock with matching clean controls.
Results, rejected attempts and limitations are disclosed in the evaluation.

**Built with:** Godot/GDScript, Astro, Tailwind, Node.js/TypeScript, FFmpeg, Nix;
Meta Model API Muse Spark `muse-spark-1.3` for primary multimodal reasoning.
No autonomous exploration, hosted service, SAM pass or synthetic evaluation.
The fixed replay is a capture/reproducibility tool, not an AI gameplay agent.

**Development disclosure:** One owner/developer, with Codex implementing code,
tests and documentation under the checked-in specifications. Owner performed
manual milestone checks. Do not describe the project as built without AI help.

## Owner-only submission checklist

Distribution status: the required `nix develop` workflow works; secondary
dashboard `packages.default`/`apps.default` are explicitly deferred. The optional
source-only addon ZIP is built with `nix build .#godot-addon` and independently
installed/enabled/recorded in the pinned environment; see
[installation](addon-integration.md). No NixOS service, installer or hosted URL.

- Confirm portal fields, eligibility/originality/AI disclosure, deadline/timezone,
  video limits, repository visibility and whether hosted access is required.
  If any requirement changes the approved local-only scope, decide explicitly.
- Review/trim/capture presentation media as the portal requires. The six supplied
  MP4s are raw gameplay examples, not a final voiceover video.
- Review any assets before publishing: local packages retain source paths and
  provider response/upload IDs. They contain demo data, but are not automatically
  approved public releases. Do not publish `.env`, keys, unrelated sessions or
  generated artifacts by staging the whole repository.
- Fill owner/team/contact and repository/video URLs; verify judge access. No
  remote Git push, release, asset upload or portal submission was performed here.
- Check actual Meta billing/remaining credits; dollar cost is unknown, not zero.
- Approve the M5 gate and retain proof of the actual portal submission yourself.

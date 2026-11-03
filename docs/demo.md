# Relay Depot: controlled demo

Relay Depot is `demo/playtest.tscn`, separate from the original smoke scene. It
uses ordinary gameplay signals and the public PostPlay API, not a model-aware bug
detector. Existing smoke-scene owner edits are preserved.

```sh
nix develop
just depot                         # all mechanics working
POSTPLAY_DEMO_CASE=ui POSTPLAY_DEMO_FAULT=1 just depot
POSTPLAY_DEMO_CASE=boundary POSTPLAY_DEMO_FAULT=1 just depot
POSTPLAY_DEMO_CASE=progress POSTPLAY_DEMO_FAULT=1 just depot
just depot-test                    # no video or API
```

Arrows move, Space/Enter interacts near a station, R cancels a transfer, Tab
flashes a timing stripe and Escape exits. The same instructions and expected
rules are visible in every mode. Environment selectors are developer-only: never
displayed in the game, registered as observations, or added to model context.
Unset the fault variable (or use `0`) for the matching clean control. These
commands play the game without capture; for editor recording set the main scene
to `res://playtest.tscn` via Project Settings, then use Record Session/Stop PostPlay.
Do not replace the owner's main scene setting implicitly.

## Three pairs

- **Resource/HUD:** Move from x160 to the console at x260/y330. Each interaction
  spends20 authoritative energy. The UI fault leaves the displayed value100 while
  real energy falls80→60→40. The clean HUD follows each transaction immediately.
- **Boundary:** Move up to y242, then right. The faulty upper-right collision
  segment allows the player's center to reach x940 beyond the declared x900
  arena edge. Clean collision keeps the center at x884 (16px radius).
- **Progression:** Move to dispatch at x650/y330 and interact. Normally the gate
  opens within1 second and delivery at x830 becomes reachable. The fault leaves
  transfer busy; repeated dispatch/reset attempts fail to recover it and the
  closed gate blocks delivery. Report this as **suspected softlock**, not a proof
  that every possible recovery path has been excluded.

Telemetry observes energy, displayed energy, transfer/gate state, actual attempts
and results, progression, scene-local position and declared bounds. Registration
expectations describe the same legitimate rules for every session. Position polls
are500ms, properties200ms and selected action states50ms; short taps can be absent
from polled inputs, while the game's existing interaction signals record results.
No scene-tree scan, typed text or hidden mode is collected.

## Reproducible empirical capture and analysis

```sh
just evaluation-capture
```

This explicit GUI command copies the demo into a fresh ignored directory and runs
six independent30-second Movie Maker recordings through the production editor
plugin/finalizer. It requires a display and can open game windows. It uses fixed
input schedules, identical within each buggy/clean pair, not human play or
autonomous exploration. The editor restores its prior Movie Maker toggle after
each capture. The separate `evaluation.json` records ground truth outside
`sessions/`; only neutral UUID session packages go to the ordinary pipeline.

The command prints a new evaluation root. Preparation uses scene-specific pixel
measurement of three magenta stripe onsets in each actual video, not a guessed
frame offset. No bug detector consumes those pixels. In the devShell:

```sh
node app/scripts/prepare-evaluation.ts /absolute/evaluation-root
```

It applies backed-up timing metadata, prepares the whole30-second excerpt using
the production converter, audits raw/normalized input for mode identifiers and
saves preparation checkpoints/index. A completed index is reused, not overwritten;
an interrupted partial index resumes saved sessions. Keep original media, timing
backups, stages and index together. Inspect existing outputs before recovery.

Only the following **explicit paid** command sends video/telemetry to Meta:

```sh
node --use-env-proxy app/scripts/analyze-evaluation.ts /absolute/evaluation-root --upload-to-meta
```

Requires server-side `MODEL_API_KEY`, exactly six preparations, one request per
previously unreserved preparation and no automatic retries. A reserved attempt is
reopened/recovered locally only. Failed/unresolved attempts remain failures, not
clean controls. Each completed real result and cleanup status is checkpointed
before moving to the next session. Dollar cost is unknown unless returned; usage
and Meta billing, not assumptions, determine expenditure. No SAM pass is run.

To inspect results, set `POSTPLAY_SESSION_ROOT=/absolute/evaluation-root/sessions`
before starting the dashboard and select the session UUID. Ground truth and
evaluation commentary are never submitted to Muse. The empirical results belong
in [the evaluation record](evaluation.md), including misses and false positives.

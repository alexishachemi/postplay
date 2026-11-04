# Harbor Warden

A small top-down island quest built with the supplied **Tiny Swords (Free Pack)** bitmap artwork. The blue-clad warden gathers three timber bundles to repair the harbor gate and return to the castle. No combat, external services or audio dependencies.

From the repository root:

```sh
nix develop -c godot --editor --path demos/top_down
nix develop -c godot --path demos/top_down
```

## Controls and route

WASD/arrows move. E/Space/Enter interact. C cancels a repair and refunds timber. R restarts the entire quest, including while repairing. Tab produces a magenta timing stripe for 0.4 simulation seconds. Escape finishes the run gracefully.

Collect the three golden-ringed timber bundles: southwest `(210,420)`, north-middle `(400,260)`, southeast `(555,430)`. Approach the gate from the west `(665,330)` and interact with three bundles. After four seconds it opens; walk east to the castle `(818,330)` to finish. A normal leisurely run takes roughly 30–60 seconds. The gate blocks all eastward movement until open; decorative houses/trees are scenery, not physical obstacles.

## Controlled cases

Clean is the default. The following local-only environment settings select reproducible faults; neither selectors nor answers are registered in PostPlay observations, labels or visible game text:

```sh
POSTPLAY_DEMO_CASE=hud POSTPLAY_DEMO_FAULT=1 nix develop -c godot --path demos/top_down
POSTPLAY_DEMO_CASE=progress POSTPLAY_DEMO_FAULT=1 nix develop -c godot --path demos/top_down
```

Use the **same** route with `POSTPLAY_DEMO_FAULT=0` for each clean control. In `hud`, inventory changes while the timber counter remains zero; repair remains possible. In `progress`, repair remains busy beyond the stated four seconds and repeated E/C attempts do not recover it. **R still recovers by restarting**, so this supports investigating a suspected local progression softlock, not proof that every recovery path is impossible. Failed attempts are ordinary gameplay signals, not precomputed PostPlay findings.

## Record and inspect

The project uses the canonical `addons/postplay` copy installed by the repository's addon sync tooling. Enable PostPlay in Project Settings → Plugins if needed. Use the addon **Record Session** toolbar action, play the route and press Tab near the beginning and end. Finish with Escape or **Stop PostPlay**, not forced F8. The configured output is repository-root `recordings/`, shared with the other demos. Ordinary non-recording runs create no sessions.

Public optional hooks observe the existing supply/repair/progression signals, authoritative/displayed inventory, gate state, selected action booleans and player position. A missing autoload simply skips instrumentation; remove/disable the autoload declaration as well if removing the addon files. No scene scanning, raw text/key recording or model calls occur in gameplay. Timing signal `timing_pulse(sequence)` and the screen-space magenta stripe at `(0,76,960,8)` support **measured** recording alignment; the pulse alone does not certify synchronization. Follow [the synchronization guide](../../docs/synchronization.md) and [dashboard journey](../../docs/dashboard-journey.md) to prepare/analyze/inspect a saved recording.

A successful clean playthrough is **not** a real empty Muse report. No new paid inference or six-session evaluation is claimed for this game. Model performance and actual video alignment require separately measured recordings.

## Deterministic checks

```sh
nix develop -c godot --headless --path demos/top_down --editor --import --quit
nix develop -c godot --headless --path demos/top_down res://tests/gameplay.tscn
```

These exercise all four clean/fault configurations, collection uniqueness, gate collision, repair timing/cancellation/refund, completion, repeated failed recovery attempts, full restart and pulse lifetime. They exercise normal gameplay with the addon inactive, not real Movie Maker capture or model reasoning.

Original PNG artwork and Aseprite sources are included under their supplied
directory/names at the owner's explicit request. Generated imports/caches and OS
metadata are excluded. See [asset notices](../ASSET_NOTICES.md); no third-party
license or attribution was supplied, and this repository does not invent one.

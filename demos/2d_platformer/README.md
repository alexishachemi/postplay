# Starfall Relay — 2D platformer showcase

A small, single-room space-station platformer using the supplied pixel-art rogue
and blue platform tiles. Jump between three elevated decks, collect their power cells,
then return to deck level and enter the east airlock. The default game is clean.
This showcase complements the original Relay Depot evaluation; it does not replace
or retroactively change its results.

## Run

From the repository root:

```sh
nix develop -c godot --path demos/2d_platformer
nix develop -c godot --path demos/2d_platformer --editor
nix develop -c godot --headless --path demos/2d_platformer res://tests/game_test.tscn
```

Use left/right arrows to move, Space or Up to jump, R to restart the entire run,
Tab for a visible timing stripe, and Escape to finish. The controller has a short
coyote-time/jump buffer. Walk to the right edge of each platform before jumping
to the next; all three cells are reachable with ordinary run/jump input. After
the last cell, drop down and walk to the powered airlock. R also replays a
completed run. The safety tether returns an accidentally escaped/fallen pilot
to the entrance without losing collected cells; R resets everything.

The logical viewport is fixed at 1280×720 with aspect-preserving stretch. There
is no moving camera, so game, video and world coordinates share one frame.

## Capture and inspect

The project uses an unchanged local copy of the canonical addon in
`demo/addons/postplay`. The root showcase tooling installs/checks that copy.
Open this project's editor and use the **PostPlay → Record Session** workflow;
press Tab near the beginning and end, collect cells, and stop via the addon.
The configured output directory is `res://../../recordings` (the repository's
shared `recordings/`). Launch the dashboard with its root set to the same place:

```sh
export POSTPLAY_SESSION_ROOT="$PWD/recordings"
nix develop -c just app
```

See [editor capture](../../docs/editor-capture.md),
[synchronization](../../docs/synchronization.md), and the
[dashboard journey](../../docs/dashboard-journey.md) for actual finalization,
visible-event measurement and user-consented analysis. A pulse is a magenta
`#ff55d9` stripe at logical `Rect2(0,76,1280,8)`, displayed for 0.4 simulation
seconds; `timing_pulse(sequence)` emits when triggered. **A timing marker does not
itself prove synchronization**; measure the encoded movie against the signal.

The game observes real gameplay signals (`cell_collected`, `airlock_opened`,
`relay_completed`, `pilot_returned`, and the player's `jumped`), a few scalar
properties, pilot position and declared station bounds. Expectations reflect
the same visible rules for every run: pickup counters update immediately,
three cells power the exit, and the pilot stays inside the blue perimeter.
No hidden mode or expected finding is registered. The game neither calls Meta
nor generates findings. Optional observations use a looked-up autoload, so
gameplay still works if the plugin/autoload is removed in Project Settings.

## Reproducible developer scenarios

Set selectors **before opening the editor** so its recording child inherits them.
They are local environment switches, never shown in the game or added to its
telemetry. Use identical actions for a faulty run and its clean control.

```sh
# Stale counter: collect any cell; cell disappears but the HUD remains zero.
POSTPLAY_DEMO_CASE=hud POSTPLAY_DEMO_FAULT=1 nix develop -c godot --path demos/2d_platformer --editor

# Containment: walk right along the bottom deck without collecting cells.
POSTPLAY_DEMO_CASE=boundary POSTPLAY_DEMO_FAULT=1 nix develop -c godot --path demos/2d_platformer --editor

# Clean counterpart: change only POSTPLAY_DEMO_FAULT to 0.
POSTPLAY_DEMO_CASE=hud POSTPLAY_DEMO_FAULT=0 nix develop -c godot --path demos/2d_platformer --editor
POSTPLAY_DEMO_CASE=boundary POSTPLAY_DEMO_FAULT=0 nix develop -c godot --path demos/2d_platformer --editor
```

For the boundary case, keep walking right until the pilot crosses the blue
perimeter; the floor ends at x=1244. The automatic tether prevents endless falling;
R returns immediately. In the control, the wall blocks the same attempted exit.
No softlock scenario is claimed for this game (the second showcase covers
progression). High certainty should still require inspectable evidence rather
than these private test switches.

## Verification and limitations

`tests/game_test.tscn` is a deterministic **gameplay fixture**, not AI evaluation.
It exercises a complete route through actual CharacterBody2D physics and normal
input actions, completion/reset, both counter and boundary pairs, pulse expiry,
and gameplay with the autoload removed. It does not insert model findings.
The parent integration records the separate real Movie Maker/capture checks.

No paid Muse call or model accuracy result is claimed for this new game.
A functioning clean game is **not** a verified empty Muse report; a new live
analysis needs explicit upload consent and budget consideration.

## Included assets

`assets/character-rogue.png` is a128×256 atlas with32×32 cells: the first row is
the three-frame idle animation (the fourth cell is empty), and the second row is
the four-frame run animation.
`assets/platform-template.png` is160×160; the blue floor strip at `(0,48,16,8)`
is displayed at uniform3× scale. The player's feet and collision shape remain
aligned; replacement artwork does not change movement or scenario semantics.

These files replace the removed restricted sci-fi pack. The owner states the new
art permits redistribution alongside the game and requested both demos' artwork
committed. Original PNGs are included unchanged, so fresh checkouts have the art.
See [asset notices](../ASSET_NOTICES.md): no third-party license or attribution was
supplied, and no broader standalone-pack license is invented. The addon ZIP does
not include game artwork.

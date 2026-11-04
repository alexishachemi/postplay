# Visual PostPlay showcases

Two independent Godot games use the same unmodified PostPlay addon as `demo/`.
They are additional examples, not replacements for the recorded M4 evaluation.

| Game | Play / record editor | Developer fault cases |
| --- | --- | --- |
| [Starfall Relay](2d_platformer/README.md), sci-fi platformer | `just platformer` / `just platformer-editor` | `hud`, `boundary` |
| [Harbor Warden](top_down/README.md), fantasy top-down quest | `just top-down` / `just top-down-editor` | `hud`, `progress` |

From the repository root, enter `nix develop`. Both games default to working
clean gameplay. Example developer-only selection, inherited by the editor:

```sh
POSTPLAY_DEMO_CASE=hud POSTPLAY_DEMO_FAULT=1 just platformer-editor
POSTPLAY_DEMO_CASE=progress POSTPLAY_DEMO_FAULT=1 just top-down-editor
```

Unset those variables, restart the editor, and record the same route for its
clean control. Fault selectors are not displayed or observed; normal game rules
and expected behavior are the same in both modes. A working clean route is **not
a claim of an empty Muse report**. These new games have not been evaluated with
paid model calls. Do not synthesize findings or reuse another game's report.

## Local assets and distribution

The owner supplied each game's `assets/` directory. Source art is deliberately
ignored/uncommitted, never deleted or rewritten by setup. On another checkout,
obtain the assets from their author and put them at the paths listed in each game
README before launching. The core smoke demo/dashboard do not need these packs.

The sci-fi free pack README permits non-commercial projects and prohibits
redistributing the pack, even modified. It is **not included in the addon ZIP**.
No license document was found in the supplied Tiny Swords directory. Do not infer
that its files are public domain or redistribution-cleared. Confirm permission
before publishing screenshots/video, packaging either game, or distributing art.
The original owner-provided asset files remain on disk for local use.

## Record → measure → analyze → inspect

1. Open the appropriate editor above. Both projects enable the unchanged addon
   and use `postplay/output_directory = res://../../recordings`, the repository's
   common ignored library. Use **Record Session**, play the documented route,
   then **Stop PostPlay** or the game's normal Escape exit. F5 alone does not record.
2. Set `POSTPLAY_SESSION_ROOT="$PWD/recordings"` before starting the dashboard.
   Select the newly recorded UUID and prepare a local preview. Check full framing
   and playback; original AVI and telemetry are preserved.
3. Press Tab for at least two well-separated timing pulses during recording.
   Each visibly flashes a magenta stripe and emits watched `timing_pulse` with a
   sequence number. Correlate actual first-lit frames and event IDs with
   [the synchronization command](../docs/synchronization.md). Do not reuse the
   disposable calibration below for another capture. Completion is not alignment.
4. Prepare the chosen excerpt locally, inspect coverage, then use the existing
   dashboard's separate explicit upload consent if you choose a **paid** Muse
   analysis. The examples themselves never call an API. See the
   [supported walkthrough](../docs/dashboard-journey.md).
5. Inspect actual results: findings remain hypotheses, a failed/invalid result
   is not clean, and an empty report means only no supported findings in its
   analyzed coverage. A recoverable progression failure is at most a suspected
   softlock, not a proof that restarting cannot recover.

## Developer checks

```sh
just showcases-install             # install missing copies; refuse existing differences
just showcases-addon-check         # compare canonical source byte-for-byte
just showcases-test                # both gameplay suites; no recording or API
just showcase-capture-check 2d_platformer
just showcase-capture-check top_down
```

The last two commands explicitly open disposable X11/software-rendered editor
windows and record six seconds through the real production plugin. They trigger
three known timing pulses and a short movement interval, independently decode
the visible onsets, apply backed-up measured alignment and prepare an MP4/context.
They exercise capture/integration, **not full playthroughs, model performance or
autonomous exploration**. Generated files live under `artifacts/showcase-capture-*`;
the owner projects/settings are not rewritten. X11/XWayland DISPLAY and Mesa
software rendering are required for these GUI checks. Normal play does not force
software rendering or alter the owner's display settings.

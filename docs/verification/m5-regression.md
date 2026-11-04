# M5 regression and privacy checks

Checked on 2026-11-04, Linux x86_64, pinned Nix shell. This is a scoped prototype
verification record, not a security audit or cross-platform certification.

## Repeatable checks (no paid requests)

From the repository root:

```sh
nix develop -c just check
nix develop -c just --fmt --check
git diff --check
```

The full check passed **143 tests**, the actual Godot smoke scene, Astro checks
(63 files, zero errors/warnings/hints), and production build. Two new regression
checks cover build-time credential isolation and unconfirmed/failed deletion.
The privacy test builds with a synthetic canary, scans browser assets and rendered
session HTML (including inline scripts), and forbids the privileged Meta endpoint.
It does not insert the real key into a build. Initial test assumptions about
external JavaScript files and scripts on an empty page failed; inspecting the
actual selected-session HTML corrected the test, not production behavior.

| Boundary | Exercised behavior / test file in `app/tests/` |
| --- | --- |
| Portable serialization | `session-contract`, `collector`, `watchers`: bounded safe values, invalid IDs/values, freed sources, repeated runs, caps and interrupted writes |
| Private inputs | `observations`: selected action booleans only, text-focus suppression, no raw typed text |
| Timing / conversion | `synchronization`, `synchronization-command`, `preparation`: real-event anchors, uncertainty/drift, trim offsets, empty/oversized context and conversion errors |
| Local file safety | `session-library`: traversal, symlinks/hardlinks, changed descriptors, malformed/incomplete packages, bounded media probes |
| HTTP / credentials | `dashboard`, `dashboard-analysis`, `report-inspection`: loopback/origin guards, escaped content, safe errors, consent/key requirements, rendered/built credential isolation |
| Model failures / cleanup | `muse-api`, `meta-smoke`, `session-analysis`: mocked auth/quota/transport/refusal/incomplete/schema failures; no automatic retry; requested one-hour expiry; deleted/unconfirmed/failed cleanup distinct |
| Saved reports | `findings-report`, `report-inspection`, `dashboard`: provenance corruption, real event references, quarantine, valid empty versus error, restart without credentials/outbound networking |
| Demo | `demo`: independent faults/controls, CLI consent and parallel offline checkpoint recovery |

These fixtures test handling, **not empirical model performance**. Existing real
evidence is separately recorded in [the evaluation](../evaluation.md).

## Retained real artifacts inspected again

An offline `audit-evaluation.ts` pass over `evaluation-L9Gxm3` and
`evaluation-qniM0d` revalidated seven reports, retained two failed attempts and
verified all nine analysis-stage fingerprints unchanged. Usage remains168,559
tokens, dollar cost unknown; saved cleanup records confirm nine deletions. This
does not poll Meta again or claim to verify current remote retention independently.

Raw contract revalidation distinguished these actual capture outcomes:

- Normal `9fef2ec8…`: complete30,000ms,79 events, orderly `runtime_stopped`.
- Interrupted `6c2c6692…` in `evaluation-GdBXAe`: still `recording`, null duration,
  39 flushed events, no orderly stop. It stays unfinished—not silently promoted
  to complete or rewritten to match a preferred label.
- Short `07e5fac5…` in `evaluation-oCePMZ`: complete5,233ms,29 events, orderly
  stop. Complete does not imply the required30-second evaluation coverage;
  this capture remains excluded.

## Smoke/review checklist

1. Use the [README](../../README.md) shared-root setup. Record via the toolbar,
   stop normally, inspect UUID/media/telemetry, and measure visible timing events.
2. Prepare locally. Unknown timing or bad media must fail without an upload.
3. Reopen an existing genuine report; select a finding, inspect the paused clip
   and exact raw event. Open its clean control, then a failed attempt; neither
   quarantine nor failure may appear as “no supported findings.”
4. Restart without a key/external network and repeat inspection. Do not click
   upload for this regression check. Review saved cleanup and usage separately.
5. Keep interrupted data intact; use deterministic `just capture-test` /
   `just workflow-test` for forced-exit checks, not the owner's running editor.

No new paid calls are required. Real recordings, source-frame timing and browser
interaction were observed in M1–M4; M5 reuses saved evidence rather than claiming
another live inference. Independent non-Nix installations, other Godot versions,
power-loss guarantees and exhaustive adversarial testing remain unverified.

# Local session dashboard

The dashboard now provides a read-only session library and selectable metadata
overview. Video playback, analysis buttons and finding navigation remain later
M3 tasks; the existing CLI workflow still handles those preparation/submission
steps. Loading or refreshing this page **never uploads to Meta or starts a job**.

## Start from the checkout

```sh
nix develop
export POSTPLAY_SESSION_ROOT='/absolute/path/to/addon/session-root'
just app
# Open http://127.0.0.1:4321
# Stop the development server when finished:
just app-stop
```

Configure the root **before** starting the server. It must contain canonical
session-UUID directories, not a single session's files. If unset, the same
XDG-compatible library described in [ingestion](session-ingestion.md) is used.
An empty root has recording/setup instructions; missing permissions, invalid
storage or an out-of-range page produces an explicit error rather than fake data.
The writable root may be created by the shared library initialization.

For the production server:

```sh
just build
just app-start
```

The default binding is `127.0.0.1`; stop the foreground production server with
Ctrl-C. `PORT` can select another local port. Keep this local developer tool off
the public network; it has no accounts or hosted-service security model.

Choose a session card to show its project/scene, UUID, recorded UTC date, session
duration, synchronization label and saved report status. Refresh explicitly after
capture or CLI analysis; this view does not poll or make paid calls. A validated
empty report is not evidence of a bug-free game. `needs_review` and quarantine
counts remain distinguishable from a clean/no-findings result.

## Status rules

| Status | Meaning |
| --- | --- |
| Recorded | Complete original recording/telemetry validated; no completed report for the selected preparation |
| Processing | Capture/preparation/analysis is unfinalized; it may still run **or may have been interrupted** |
| Analyzed | Saved report reopened through full M2 provenance/schema/evidence validation, not just a marker's presence |
| Failed | Incomplete/invalid capture, saved preparation/analysis failure, unsafe files or a report that cannot validate |

For multiple preparations, the overview uses the **most recently modified**
preparation/analysis directory, with UUID tie-breaking. This is local filesystem
ordering, not proof of a running job or an inference timestamp. A newer failed or
unfinished attempt is not hidden by an older successful report. Explicit attempt
selection is not implemented in this first view. A completed model response
without a completed offline report remains unfinished here; use `just session-report`
to finish that CLI step without another model call.

At most ten sessions are loaded per page, in stable UUID order. Root discovery
retains the 1,000-entry cap; preparation discovery stops with a diagnostic beyond
100 entries instead of silently hiding excess attempts. Media probing/report
hash validation can take time on large packages. There is deliberately no stale
cache, automatic background verification, arbitrary filesystem browser or recursive
directory scan. Unknown synchronization remains unknown.

## Read-only local API

- `GET /api/sessions?page=1`: selected public summaries, page/pages/total and ignored-entry count.
- `GET /api/sessions/SESSION_UUID`: one existing session summary; 404 if absent.
- `/?page=1&session=SESSION_UUID`: server-rendered list/selection; works without JavaScript.

The API never returns raw logs, raw model/proposal/request bodies, credentials,
server directory paths or borrowed file descriptors. Names/scene labels are
developer-provided metadata; Astro renders them as escaped text. UUID/path and
page validation precede file access. Symlinks/shared/special files are rejected
by the pinned-descriptor library. Nonlocal Host names and cross-origin requests
are rejected; responses use no-store, nosniff, no-referrer and frame-denial headers.
There are no write or analysis HTTP endpoints in M3.1.

Schemas/prompts load relative to the checked-in app package, independent of the
working directory and Astro's server-chunk depth. Keep `app/`, `contracts/` and
`ai/` together; copying `app/dist` alone is not packaged distribution support.
The Nix package/app remains deferred rather than claimed working.

## Verification

`just dashboard-test` exercises source/stage statuses, report corruption, partial
captures, pagination/path/origin guards, then builds and starts the actual Node
server on temporary loopback ports. It checks metadata APIs, session selection,
escaped script-like labels, helpful empty/error states and no leaked key/path.
The server is deliberately started from another CWD to cover bundled asset paths.
`just check` includes these tests. No tests call Meta; fixtures are synthetic.

Observed browser checks use ephemeral Chromium from the locked nixpkgs, not an
added runtime/dependency requirement. The actual local calibration package was
listed/selected and its recorded date, six-second duration and validated report
displayed. Desktop screenshots and a 390-pixel viewport check are development
artifacts, not empirical model-detection or complete M3 journey evidence.

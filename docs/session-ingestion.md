# Open and inspect saved sessions locally

M2.1 provides a server-only **read-in-place** session library and a diagnostic CLI.
There is no copying importer, media endpoint, dashboard UI or model submission
yet. [Preparation](session-preparation.md) is a separate local command, not a side
effect of inspection. Completed packages can be checked with no Godot editor running
and no API key or network request.

## Choose the library

Set `POSTPLAY_SESSION_ROOT` to the absolute directory containing your UUID-named
session folders. It is trusted local/server configuration, **not** a path supplied
by a browser. For example, if the addon writes to this repository's `recordings/`:

```sh
nix develop
export POSTPLAY_SESSION_ROOT="$PWD/recordings"
just sessions
just session-inspect SESSION_UUID
```

Replace `SESSION_UUID` with a listed ID, not a path. The addon defaults to Godot's
`user://postplay/sessions`, which is not automatically the app's default library:
use the absolute root shown in the editor Output panel, or deliberately configure
both addon output and this environment variable to the same writable directory.
If transporting a portable capture, retain its UUID folder, original files and
any synchronization measurement/backup directory. Duplicate IDs must not be merged
or overwritten. Originals are inspected where they live, not moved or repaired.

Without an override, storage is `${XDG_DATA_HOME}/postplay/sessions` or
`~/.local/share/postplay/sessions` when XDG_DATA_HOME is unset. The explicit
`POSTPLAY_SESSION_ROOT` override takes precedence. Relative paths and Nix-store
roots are rejected. Opening a library explicitly creates missing directories and
checks read/write/traversal access; no writes go into `/nix/store`. Package files
themselves are read-only during inspection. Storage errors are reported without
leaking host paths. A permission check is not a disk-space guarantee.

Discovery is nonrecursive and bounded to 1,000 entries; exceeding that limit is
an error, not silently truncated output. Only canonical lowercase UUID-v4 directory
names are listed, and the manifest ID must match. Other entries are counted as
ignored. A UUID-named symlink may be listed but cannot pass inspection. This keeps
lookup keys suitable for future local UI routes without accepting arbitrary paths.

## What is checked

- Required bounded, UTF-8 `session.json` and `events.jsonl`; raw v1 schemas,
  timestamp/ID/count/source/registration consistency and any synchronization
  anchor. JSONL damage is never silently dropped, including a broken final line.
- Lexically portable relative media paths plus filesystem checks at each path
  component. Symlinks, hardlinked files, FIFOs, devices and nonregular files are
  rejected. Nested regular media paths are supported. Metadata buffers remain
  within the contract's byte budgets even if a file grows during reading.
- A complete capture status. `recording` / `incomplete` stays an explicit partial
  capture even if an AVI exists. Malformed partial logs remain validation errors.
- A nonempty original video, valid first-video-stream dimensions/rate/duration,
  and agreement with manifest dimensions/fps/duration (one-frame duration tolerance,
  minimum 2 ms, for timestamp rounding). Movie Maker's reported average rate, when
  available, must also agree. OGV can legitimately report average rate `0/0`;
  that is retained as `average_fps: null` with a warning, not fabricated certainty.
- Original AVI/OGV/MP4 headers with the corresponding forced FFprobe demuxer.
  Seekable descriptor input supports MP4 metadata at the end of the file.

Unknown synchronization and truncated telemetry remain diagnostics, not fabricated
alignment/full coverage. A successful inspection is **not** an analyzed clean
report or a guarantee of every frame's decodability/cadence. Header inspection
does not repeat M1's full decode or prove a visible timing anchor; media preparation
is separate, and analysis remains a later task. A missing average rate does not establish that
the recording is variable-rate either.

## Errors and recovery

`just session-inspect` prints JSON and exits nonzero on failure. Its summary omits
raw telemetry payloads, credentials, absolute storage paths and FFprobe stderr.
Developer-supplied project labels remain untrusted strings; future UIs must escape
them, not render them as HTML.

| Code | Action |
| --- | --- |
| `invalid_id` | Select a listed UUID; do not pass a path/URL. |
| `not_found` / `missing_media` | Restore the missing original manifest/log/video. |
| `unsupported_schema` | Use a raw v1 package; do not relabel another format. |
| `invalid_manifest` / `invalid_events` | Preserve the damaged package and inspect the contract failure; never truncate it into a clean result. |
| `partial_capture` | Inspect capture interruption/recovery; a video alone does not finalize it. |
| `unsafe_file` | Use regular unshared files/directories within the selected library, not links or devices. |
| `size_limit` | Check contract file limits or choose a smaller library root. |
| `probe_failed` | Check FFprobe on PATH and the original media; missing tools, bad headers and bounded probe failures are not clean results. |
| `media_mismatch` | Compare actual capture metadata with the manifest; do not silently rewrite originals to force success. |
| `storage_unavailable` | Choose an allowed writable absolute root and check permissions/discovery limits. |

## Implementation boundary and tests

`SessionLibrary.create(root)` / `discover()` / `inspect(uuid)` / `close()` live in
`app/src/server/session-library.ts`. Use `close()` in `finally`. The loaded result
contains validated session/events/media/diagnostics, or a typed error; no host
filesystem path is returned. This module is for Node/server use, never client JS.

This Linux-first implementation requires `/proc/self/fd`. It pins directory file
descriptors and uses no-follow, nonblocking opens for each untrusted component.
FFprobe inherits only the already-open regular media descriptor, with only the
`fd` protocol and declared demuxer permitted: no playlist/URL autodetection or
arbitrary filename input. It receives no API-key environment, uses no shell, has
a 15-second kill timeout, 128 KiB combined output cap and bounded probe settings.
These measures are not a general OS sandbox against a malicious same-user process
or a codec vulnerability; keep finalized packages immutable and dependencies trusted.
Normal size/mtime changes during reads/probing are detected, not a transactional
snapshot against adversarial writers.

`nix develop -c just ingestion-test` generates clearly labeled tiny AVI/OGV/MP4
fixtures, tests safe loading, traversal/links/FIFO/invalid data/partial status,
missing FFprobe, directory replacement, discovery limits, unchanged originals and
CLI errors. Those fixtures do not demonstrate model quality or human gameplay.
The command is part of `just check` through the Node test suite; it makes no API
calls. Original real M1 captures were also opened locally, including the verified
six-second calibration and a deliberately incomplete forced-stop session.

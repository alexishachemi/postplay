# Portable raw capture contracts — v1

These contracts describe Godot capture evidence, independently of the normalized
Muse input/proposal contracts in `ai/`. All three raw schemas use
`schema_version: "1"` where applicable. Incompatible changes require a new version.
Schema `$id` URLs identify locally loaded schemas; validation never fetches them.

A package contains `session.json`, `events.jsonl` and the original video declared
by `capture.video_path`. Derived videos and analysis outputs must preserve these
originals and record their own conversion offsets/provenance. The contracts and
pure validators are implemented in M1.1; runtime capture, filesystem/media checks
and measured general synchronization are later M1/M2 tasks.

## Session manifest

`session.v1.schema.json` defines all fields. Required groups are:

- Identity: canonical lowercase UUID v4 `session_id`, project ID/name, relative
  scene path, Godot version and UTC start/end timestamps.
- Capture: `movie_maker` or `external`, relative original video path (nullable
  before finalization), AVI/OGV/MP4 format, configured fps/dimensions, nullable
  measured duration in milliseconds, collision-debug state.
- Telemetry: fixed relative `events.jsonl` path, count at the last manifest
  checkpoint, and explicit `truncated` flag when collection limits dropped data.
- Synchronization: `unknown`, `approximate` or `verified`, a nullable observed
  event anchor, nullable estimated error and bounded notes. Unknown means both
  anchor and error are null; zero is a measurement claim, not an unknown value.
- Registrations: optional existing signals/properties/semantic observers with
  session-local `reg-N` IDs, source metadata, descriptions and nullable developer
  expectations. An empty list is valid; basic capture requires no annotations.

The lifecycle starts at `recording` and terminates at `complete` or `incomplete`.
`complete` requires an end timestamp, original-video path and positive measured
duration. It does not imply known synchronization, full telemetry coverage or a
successful analysis. `incomplete` may lack media/end metadata. A manifest left
`recording` after a crash remains unfinalized; never promote it by inference.
Terminal captures cannot transition back to recording or silently become complete.
Recording-to-recording checkpoint updates do not constitute a status transition.

UTC timestamps are calendar-valid ISO dates with `Z` and optional 1–3 fractional
digits. The UTC end must not precede the start. All structural paths are plain
relative POSIX paths: no absolute/drive/URI paths, backslashes, empty or dot/dot-dot
segments, control characters, percent escapes, `?` or `#`. `source.node_path` may
be `.` for the scene root, or null when unavailable; it is a scene-local node
path, not a host file path. Project scene paths omit Godot's `res://` prefix.
Lexical validation does not prove filesystem containment: ingestion must also
check actual files and symlinks before serving media.

## Event records and clocks

Each line of `events.jsonl` is one `event.v1.schema.json` object, serialized as
compact UTF-8 JSON and normally ending with LF. A valid final record without LF
is accepted. Blank interior lines, malformed/truncated records, unsupported
versions and oversized lines are errors, including in incomplete sessions.
An empty log is valid with zero declared events. Recovery must preserve a damaged
original and explicitly diagnose/repair a copy; this parser never silently drops
a broken tail or converts corruption to a clean capture.

IDs are local to a session: `sequence` starts at 1 without gaps; `id` equals
`evt-<sequence>`. Resolve evidence using `(session_id, id)`. UUIDs are random and
do not encode project paths. Capture creation must also create directories/files
exclusively (M1.2); generating an ID alone is not overwrite protection.

Events carry a kind (`lifecycle`, `signal`, `property`, `input`, `position`,
`annotation`, `progression`), label, nullable registration ID, and a source with
`src-N` ID, label and scene-local path. Source IDs preserve an identity snapshot
throughout the session, even if the observed node is later freed. A registered
event must resolve to a registration on the same source. Unregistered basic
observations are valid. An observer description/expectation is context, never a
finding or a confirmed failure.

| `time` field | Clock and meaning |
| --- | --- |
| `wall_elapsed_ms` | Monotonic elapsed time since capture start; not UTC |
| `simulation_ms` | Accumulated simulation time since capture start; may pause/advance differently from wall time |
| `process_frame` | Process-frame counter, or null when unavailable |
| `physics_frame` | Independent physics-frame counter, or null when unavailable |

Counters are nonnegative safe JSON integers. Simulation time may have fractional
milliseconds. Available values for each clock must never move backwards across
the event stream, including across records where that clock was null. Equal times
are valid; event sequence resolves ties.

Raw events do not claim a `video_ms`. A known synchronization record identifies
an actual event, its recorded clock/value and the matching original-video moment.
The package validator checks this reference and recorded value; it cannot prove
the visual measurement. A process-frame anchor is allowed only for constant-fps
Movie Maker capture. External MP4s must use a measured wall/simulation time anchor
when timing is known; a frame-count/fps equality must not be guessed. Mapping and
drift verification belong to M1.6. Derived/trimmed videos need their own offsets;
the M0 smoke adapter is not a general implementation of this contract.

For complete captures, the manifest count must equal the number of valid events.
For recording/incomplete captures, it may lag the preserved log after a crash;
the validator returns a diagnostic. A count greater than the available records is
corruption, not successful completion. Truncation and unknown sync also return
explicit diagnostics. Media existence/playability is checked separately in M2.1.

## Safe payload values

`safe-value.v1.schema.json` and
`demo/addons/postplay/safe_value.gd` define bounded encoding of selected native
values. `encode_payload(value)` emits JSON-safe data. It does not reflect objects,
walk resources, call arbitrary `to_string()`, or hydrate objects on reading.

| Native value | Encoded value |
| --- | --- |
| null, boolean, finite number, String/StringName | JSON scalar |
| Vector2 / Vector3 | `{ "type": "Vector2", "x": 1.5, "y": -2 }` (Vector3 adds `z`) |
| Array | Array of encoded values |
| Dictionary with string/StringName keys | `{ "type": "dictionary", "entries": { "key": VALUE } }` |
| Object/resource/freed object, unsupported native type or exceeded limit | `{ "type": "unsupported", "reason": "..." }` |

Dictionary wrapping prevents user keys such as `type`/`entries` from colliding
with typed representations. Nonstring keys or collisions after key normalization
mark the entire dictionary unsupported. Objects are always markers; no class
names, instance pointers or resource paths are emitted. A JSON null means actual
null, not unsupported/missing evidence. JSON numbers preserve values within the
safe range; the original Godot int-versus-float distinction is not retained.

v1 limits (fixed, tested across Godot/Node):

- Depth 6 (payload root is depth 0), 256 logical values, 64 entries per collection.
- Strings 1,024 Unicode characters; dictionary keys 128 characters. Numbers must
  be finite and within ±9,007,199,254,740,991 to avoid silent 64-bit integer loss.
- Payload 8,192 UTF-8 bytes; event line 16,384 bytes; manifest 262,144 bytes.
- At most 10,000 events and 16,777,216 bytes per event log; whichever limit is hit
  first bounds capture. Runtime writers must stop/mark truncated rather than
  silently omit data. Actual observation-rate caps are M1.3/M1.4 work.

Depth/string/collection/key/type failures replace the affected value with a
marker. Cyclic references become `cycle` markers. Exceeding the total logical-node
or serialized-payload budget replaces the whole payload with a marker. These
changes are explicit loss of evidence, not inferred game behavior. Metadata has
its own schema bounds; invalid metadata is rejected rather than silently changed.
The encoder is not a privacy filter: observers must select nonsecret game data;
generic input collection must never pass typed text to it.

Usage during later runtime collection:

```gdscript
const SafeValue = preload("res://addons/postplay/safe_value.gd")
var session_id := SafeValue.new_session_id()
var payload = SafeValue.encode_payload({"position": Vector2(160, 330)})
# Store payload inside a v1 event, retaining separate clock fields and IDs.
```

Node's `validateSessionPackage(manifest, jsonl)` checks schema and cross-record
invariants and returns session/events/diagnostics without media access or a running
editor/model. `serializeEvent` validates and emits JSONL; `validateSafeValue` checks
recursive budgets before schema recursion. No generic arbitrary-object decoder is
provided or needed.

## Fixtures and verification

`fixtures/complete/` and `fixtures/incomplete/` are **synthetic contract fixtures**.
Their status/anchor metadata illustrates the format; no media exists there and
no empirical inference/synchronization claim follows from them. Both packages
can be inspected as text without Godot or a model service running.

From `nix develop`:

```sh
just contract-test
just check
```

The Node contract tests actually run the pinned Godot encoder and validate its
output against the same local schemas. Godot also reads/round-trips the shared
fixtures and checks unsupported/freed objects, numeric limits, tag collisions,
cycles and depth/item/node/byte budgets. Node exercises malformed paths/records,
timestamps, ID/reference/count/clock invariants and incomplete-state diagnostics.
These tests need the devShell tools but make no network/API calls.

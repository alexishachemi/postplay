import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONTRACT_LIMITS, assertCaptureTransition, parseEventsJsonl, serializeEvent, validateEvent, validateSafeValue, validateSession, validateSessionPackage } from '../src/server/session-contract.ts';

const fixture = (path: string) => readFileSync(new URL(`../../contracts/fixtures/${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(fixture('complete/session.json'));
const log = fixture('complete/events.jsonl');
const first = () => structuredClone(parseEventsJsonl(log)[0]!);

test('shared complete and incomplete package fixtures round trip with explicit status', () => {
  const complete = validateSessionPackage(manifest, log);
  assert.equal(complete.events.length, 3);
  assert.equal(complete.diagnostics.length, 0);
  assert.deepEqual(parseEventsJsonl(complete.events.map(serializeEvent).join('')), complete.events);
  assert.deepEqual(validateSession(JSON.parse(JSON.stringify(manifest))), manifest);
  const incomplete = validateSessionPackage(JSON.parse(fixture('incomplete/session.json')), fixture('incomplete/events.jsonl'));
  assert.equal(incomplete.session.status, 'incomplete');
  assert.ok(incomplete.diagnostics.some(message => message.includes('finalization')));
  assert.ok(incomplete.diagnostics.some(message => message.includes('synchronization')));
  const stale = structuredClone(manifest);
  stale.status = 'recording'; stale.ended_at_utc = null; stale.telemetry.event_count = 1;
  assert.ok(validateSessionPackage(stale, log).diagnostics.some(message => message.includes('lags')));
});
test('rejects malformed manifests, unsafe paths, status contradictions and false timing precision', () => {
  for (const path of ['/tmp/recording.avi', '../recording.avi', 'a/../recording.avi', 'a//recording.avi', 'C:/recording.avi', 'a\\recording.avi', '%2e%2e/recording.avi', 'a/./recording.avi', 'recording.avi\0']) {
    const candidate = structuredClone(manifest); candidate.capture.video_path = path;
    assert.throws(() => validateSession(candidate), /Path/);
  }
  for (const mutate of [
    (m: typeof manifest) => { m.schema_version = '2'; },
    (m: typeof manifest) => { m.capture.duration_ms = null; },
    (m: typeof manifest) => { m.started_at_utc = '2026-02-30T00:00:00Z'; },
    (m: typeof manifest) => { m.ended_at_utc = '2025-01-01T00:00:00Z'; },
    (m: typeof manifest) => { m.capture.video_path = 'recording.mp4'; },
    (m: typeof manifest) => { m.synchronization.status = 'unknown'; },
    (m: typeof manifest) => { m.synchronization.anchor = null; },
    (m: typeof manifest) => { m.registrations.push(structuredClone(m.registrations[0])); },
    (m: typeof manifest) => { m.project.scene = '/home/fixture/game/main.tscn'; },
  ]) {
    const candidate = structuredClone(manifest); mutate(candidate);
    assert.throws(() => validateSession(candidate));
  }
  const unsynchronized = structuredClone(manifest);
  unsynchronized.synchronization = { status: 'unknown', estimated_error_ms: null, anchor: null, notes: [] };
  assert.equal(validateSession(unsynchronized).status, 'complete'); // File completion is not synchronization.
});
test('enforces payload types, finite numbers, recursion/byte/item bounds and explicit markers', () => {
  validateSafeValue({ type: 'unsupported', reason: 'unsupported_type' });
  validateSafeValue({ type: 'dictionary', entries: { type: 'Vector2', value: [null, true, 1] } });
  for (const value of [NaN, Infinity, 2 ** 53, undefined, 1n, { native: 'unencoded dictionary' }, { type: 'Vector2', x: 0, y: NaN }, 'x'.repeat(1025), Array(65).fill(null), Array(10).fill('x'.repeat(1024))]) assert.throws(() => validateSafeValue(value));
  const cycle: unknown[] = []; cycle.push(cycle);
  assert.throws(() => validateSafeValue(cycle), /Cyclic/);
  let deep: unknown = 0;
  for (let index = 0; index < 8; index++) deep = [deep];
  assert.throws(() => validateSafeValue(deep), /depth/);
  assert.throws(() => validateSafeValue(Array.from({ length: 4 }, () => Array(64).fill(null))), /node/);
  assert.throws(() => parseEventsJsonl('x'.repeat(CONTRACT_LIMITS.eventBytes + 1)), /byte/);
  assert.throws(() => parseEventsJsonl('\n'.repeat(CONTRACT_LIMITS.events + 2)), /count/);
  assert.throws(() => parseEventsJsonl(' '.repeat(CONTRACT_LIMITS.logBytes + 1)), /byte/);
  const bigManifest = structuredClone(manifest);
  bigManifest.registrations = Array.from({ length: 128 }, (_, index) => ({ ...structuredClone(manifest.registrations[0]), id: `reg-${index + 1}`, description: 'x'.repeat(1024), expected_behavior: 'x'.repeat(1024) }));
  assert.throws(() => validateSession(bigManifest), /byte/);
});
test('package validation rejects missing/repeated/wrong-session observations and invalid references', () => {
  const events = parseEventsJsonl(log);
  for (const mutate of [
    (rows: typeof events) => { rows[1]!.session_id = '22222222-2222-4222-8222-222222222222'; },
    (rows: typeof events) => { rows[1]!.sequence = 1; rows[1]!.id = 'evt-1'; },
    (rows: typeof events) => { rows[1]!.time.wall_elapsed_ms = 0; rows[2]!.time.wall_elapsed_ms = 0; rows[0]!.time.wall_elapsed_ms = 1; },
    (rows: typeof events) => { rows[2]!.registration_id = 'reg-99'; },
    (rows: typeof events) => { rows[1]!.source.node_path = 'DifferentNode'; },
    (rows: typeof events) => { rows.pop(); },
  ]) {
    const rows = structuredClone(events); mutate(rows);
    assert.throws(() => validateSessionPackage(manifest, rows.map(row => JSON.stringify(row) + '\n').join('')));
  }
  const badAnchor = structuredClone(manifest); badAnchor.synchronization.anchor.recorded_value++;
  assert.throws(() => validateSessionPackage(badAnchor, log), /anchor/);
  const clockGap = structuredClone(events);
  clockGap[0]!.time.process_frame = 10; clockGap[1]!.time.process_frame = null; clockGap[2]!.time.process_frame = 3;
  assert.throws(() => validateSessionPackage(manifest, clockGap.map(serializeEvent).join('')), /clock/);
  const duplicateManifest = structuredClone(manifest); duplicateManifest.telemetry.event_count = 2;
  assert.throws(() => validateSessionPackage(duplicateManifest, log), /count/);
  assert.throws(() => parseEventsJsonl(log + '{"schema_version":'), /line 4/);
  assert.throws(() => parseEventsJsonl(log + '\n'), /line 4/);
  const badEvent = first(); badEvent.id = 'evt-2';
  assert.throws(() => validateEvent(badEvent), /sequence/);
});
test('capture status transitions never silently promote interrupted captures', () => {
  assertCaptureTransition('recording', 'complete');
  assertCaptureTransition('recording', 'incomplete');
  assert.throws(() => assertCaptureTransition('incomplete', 'complete'));
  assert.throws(() => assertCaptureTransition('complete', 'recording'));
});
test('actual Godot encoder output validates in Node and keeps numeric/vector/object semantics', () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const output = execFileSync('godot', ['--headless', '--path', 'demo', '--script', 'res://tests/contract_test.gd'], { cwd: repo, encoding: 'utf8', timeout: 30000 });
  const extract = (prefix: string) => {
    const line = output.split('\n').find(item => item.startsWith(prefix));
    assert.ok(line, `Missing ${prefix} in Godot output`);
    return JSON.parse(line.slice(prefix.length));
  };
  const event = validateEvent(extract('POSTPLAY_CONTRACT_FIXTURE '));
  assert.deepEqual(parseEventsJsonl(serializeEvent(event)), [event]);
  assert.deepEqual(event.payload, { type: 'dictionary', entries: {
    position: { type: 'Vector2', x: 1.5, y: -2 }, values: [null, true, 3, 4.5, 'fixture'], unsupported: { type: 'unsupported', reason: 'unsupported_type' },
  } });
  const ids = extract('POSTPLAY_SESSION_IDS ');
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1]);
  for (const id of ids) validateSession({ ...structuredClone(manifest), session_id: id });
  for (const value of Object.values(extract('POSTPLAY_SAFE_CASES '))) validateSafeValue(value);
  assert.match(output, /PASS: safe serialization/);
});

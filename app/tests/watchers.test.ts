import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateSessionPackage, type SafeValue } from '../src/server/session-contract.ts';

function run(mode: string) {
  const root = mkdtempSync(join(tmpdir(), 'postplay-watch-fixture-'));
  const stdout = execFileSync('godot', ['--headless', '--path', fileURLToPath(new URL('../../demo', import.meta.url)), '--script', 'res://tests/watchers_test.gd', '--', root, mode], { encoding: 'utf8', timeout: 20_000 });
  const line = stdout.split('\n').find(line => line.startsWith('POSTPLAY_WATCHER_RESULT '));
  assert.ok(line, stdout);
  const result = JSON.parse(line.slice('POSTPLAY_WATCHER_RESULT '.length)) as { directory: string; ids: Record<string, string> };
  return { ...validateSessionPackage(JSON.parse(readFileSync(join(result.directory, 'session.json'), 'utf8')), readFileSync(join(result.directory, 'events.jsonl'), 'utf8')), ids: result.ids };
}
function entries(value: SafeValue): Record<string, SafeValue> {
  assert.ok(value && typeof value === 'object' && 'type' in value && value.type === 'dictionary');
  return value.entries;
}

test('existing signal and property watches preserve source identity, context, arguments and sampled changes', () => {
  const { session, events, ids } = run('basic');
  assert.equal(session.registrations.length, 5);
  const signals = events.filter(event => event.kind === 'signal');
  assert.equal(signals.length, 2, 'no duplicate subscription or post-unwatch event');
  assert.deepEqual(entries(signals[0]!.payload).arguments, [20, { type: 'dictionary', entries: { remaining: 80 } }]);
  assert.ok(signals.every(event => event.source.label === 'Player' && event.source.node_path === '.'));
  const signal = session.registrations.find(reg => reg.id === ids.signal)!;
  assert.equal(signal.expected_behavior, 'HUD should reflect current health');
  assert.equal(signal.description, 'Damage amount and game context');
  const health = events.filter(event => event.registration_id === ids.health);
  assert.deepEqual(health.map(event => entries(event.payload).value), [100, 80]);
  assert.deepEqual(health.map(event => entries(event.payload).phase), ['initial', 'change']);
  assert.equal(health[1]!.time.simulation_ms, 50);
  assert.equal(health[1]!.source.id, signals[0]!.source.id);
  const hud = events.filter(event => event.registration_id === ids.hud);
  assert.deepEqual(hud.map(event => entries(event.payload).value), [0, 80, 70]);
  assert.equal(hud[1]!.time.simulation_ms, 100);
  assert.ok(hud.every(event => event.source.node_path === 'HUD'), 'reparenting does not rewrite identity snapshots');
  for (const name of ['inventory', 'x']) assert.equal(events.filter(event => event.registration_id === ids[name]).length, 2);
});

test('freed targets, invalidated paths and unsupported values remain safe', () => {
  const { events, ids } = run('lifetime');
  const values = events.filter(event => event.registration_id === ids.object).map(event => entries(event.payload).value);
  assert.deepEqual(values, [{ type: 'unsupported', reason: 'unsupported_type' }, null, { type: 'unsupported', reason: 'unsupported_type' }]);
  const signal = events.find(event => event.registration_id === ids.signal)!;
  assert.deepEqual(entries(signal.payload).arguments, [{ type: 'unsupported', reason: 'unsupported_type' }, { type: 'unsupported', reason: 'non_finite' }]);
});

test('zero/eight-argument signals are exact and oversized signatures are rejected', () => {
  const { session, events } = run('arity');
  assert.equal(session.registrations.length, 2);
  assert.deepEqual(events.filter(event => event.kind === 'signal').map(event => entries(event.payload).arguments), [[], [0, 1, 2, 3, 4, 5, 6, 7]]);
});

test('invalid paths, freed registrations and unbounded intervals create no watches', () => {
  const { session, events } = run('invalid');
  assert.equal(session.registrations.length, 0);
  assert.equal(events.length, 2);
});

test('registration history is capped even when watches are removed', () => {
  const { session, events } = run('cap');
  assert.equal(session.registrations.length, 128);
  assert.equal(events.filter(event => event.kind === 'property').length, 128);
  assert.equal(new Set(session.registrations.map(reg => reg.source.id)).size, 128, 'freed target identities are never reused');
});

test('hitting the global log cap disconnects active subscriptions', () => {
  const { session, events } = run('log_cap');
  assert.equal(session.telemetry.truncated, true);
  assert.equal(events.length, 10000);
});

test('abort and freeing the collector disconnect watches without touching game callbacks', () => {
  const aborted = run('abort');
  assert.equal(aborted.session.status, 'incomplete');
  assert.equal(aborted.events.at(-1)!.label, 'capture_aborted');
  const freed = run('free');
  assert.equal(freed.session.status, 'recording');
  assert.equal(freed.events.at(-1)!.label, 'runtime_stopped');
});

test('failed manifest persistence never connects or emits unresolvable registration references', () => {
  const { session, events } = run('io');
  assert.equal(session.registrations.length, 0);
  assert.ok(events.every(event => event.registration_id === null));
  assert.equal(session.status, 'recording');
});

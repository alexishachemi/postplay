import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateSessionPackage, type SafeValue } from '../src/server/session-contract.ts';

function run(mode: string) {
  const root = mkdtempSync(join(tmpdir(), 'postplay-observation-fixture-'));
  const stdout = execFileSync('godot', ['--headless', '--path', fileURLToPath(new URL('../../demo', import.meta.url)), '--script', 'res://tests/observations_test.gd', '--', root, mode], { encoding: 'utf8', timeout: 20_000 });
  const line = stdout.split('\n').find(line => line.startsWith('POSTPLAY_OBSERVATION_RESULT '));
  assert.ok(line, stdout);
  const directory = line.slice('POSTPLAY_OBSERVATION_RESULT '.length);
  const raw = readFileSync(join(directory, 'events.jsonl'), 'utf8');
  return { ...validateSessionPackage(JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8')), raw), raw };
}
function entries(value: SafeValue): Record<string, SafeValue> {
  assert.ok(value && typeof value === 'object' && 'type' in value && value.type === 'dictionary');
  return value.entries;
}

test('real demo actions, movement, bounds and existing progression signal are portable observations', () => {
  const { session, events, raw } = run('demo');
  assert.equal(session.capture.collision_debug, true);
  assert.deepEqual(session.registrations.map(reg => reg.kind), ['player', 'bounds', 'progression']);
  const positions = events.filter(event => event.kind === 'position');
  assert.equal(positions.length, 4);
  assert.deepEqual(positions.map(event => event.time.simulation_ms), [0, 100, 200, 300]);
  assert.deepEqual(entries(positions[0]!.payload).position, { type: 'Vector2', x: 160, y: 330 });
  assert.deepEqual(entries(positions[1]!.payload).position, { type: 'Vector2', x: 184, y: 330 });
  assert.ok(positions.every(event => entries(event.payload).coordinate_space === 'scene_local'));
  const actions = events.filter(event => event.label === 'action_state').map(event => entries(event.payload));
  assert.deepEqual(actions, [{ action: 'ui_right', pressed: true }, { action: 'ui_right', pressed: false }, { action: 'ui_accept', pressed: true }, { action: 'ui_accept', pressed: false }]);
  const progression = events.find(event => event.kind === 'progression')!;
  assert.deepEqual(entries(progression.payload).arguments, [1]);
  assert.equal(progression.source.id, positions[0]!.source.id);
  const bounds = entries(events.find(event => event.label === 'playable_bounds')!.payload);
  assert.deepEqual(bounds.position, { type: 'Vector2', x: 40, y: 170 });
  assert.deepEqual(bounds.size, { type: 'Vector2', x: 880, y: 330 });
  assert.doesNotMatch(raw, /bug_mode|ground_truth|softlock|finding|clean_control/);
});

test('zero-annotation session still observes selected actions and declares its input policy', () => {
  const { session, events } = run('no_annotations');
  assert.equal(session.registrations.length, 0);
  assert.equal(events.filter(event => event.label === 'action_state').length, 2);
  assert.ok(events.every(event => event.registration_id === null));
  const policy = entries(entries(events[0]!.payload).input_policy!);
  assert.equal(policy.interval_ms, 50);
  assert.ok(Array.isArray(policy.actions) && policy.actions.includes('ui_right'));
});

test('LineEdit and TextEdit focus suppress action states without reading or serializing typed text', () => {
  const { events, raw } = run('privacy');
  assert.equal(events.filter(event => event.label === 'action_state').length, 0);
  assert.equal(events.filter(event => event.label === 'input_coverage').length, 2);
  assert.doesNotMatch(raw, /sensitive_fixture_text|unicode|keycode|physical_keycode/);
});

test('configured actions are bounded, changed-state only and can be disabled', () => {
  const { events } = run('custom');
  const actions = events.filter(event => event.label === 'action_state').map(event => entries(event.payload));
  assert.deepEqual(actions, [{ action: 'fixture_jump', pressed: true }, { action: 'fixture_jump', pressed: false }]);
  assert.equal(events.filter(event => event.label === 'input_configuration').length, 2);
});

test('3D world positions and AABB context retain stationary samples and stop on player detach', () => {
  const { events } = run('spatial');
  const positions = events.filter(event => event.kind === 'position');
  assert.equal(positions.length, 3, 'no catch-up burst after a long process delta');
  assert.deepEqual(entries(positions[1]!.payload).position, { type: 'Vector3', x: 1, y: 2, z: 3 });
  assert.equal(entries(positions[1]!.payload).coordinate_space, 'world');
  assert.deepEqual(entries(events.find(event => event.label === 'playable_bounds')!.payload).size, { type: 'Vector3', x: 4, y: 5, z: 6 });
});

test('invalid input policies, positions and bounds do not create annotations', () => {
  const { session, events } = run('invalid');
  assert.equal(session.registrations.length, 0);
  assert.equal(events.length, 2);
});

test('failed metadata persistence creates no dangling player/bounds/progression references', () => {
  const { session, events } = run('io');
  assert.equal(session.registrations.length, 0);
  assert.ok(events.every(event => event.registration_id === null));
});

test('global event cap stops action, position and progression observation', () => {
  const { session, events } = run('limit');
  assert.equal(session.telemetry.truncated, true);
  assert.equal(events.length, 10000);
});

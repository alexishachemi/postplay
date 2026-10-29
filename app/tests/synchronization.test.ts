import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSessionPackage, type Session } from '../src/server/session-contract.ts';
import { mapEventToVideo, mapToDerivedVideo, measureSynchronization } from '../src/server/synchronization.ts';

const fixture = (name: string) => readFileSync(new URL(`../../contracts/fixtures/complete/${name}`, import.meta.url), 'utf8');
const { session: original, events: raw } = validateSessionPackage(JSON.parse(fixture('session.json')), fixture('events.jsonl'));
function setup() {
  const session = structuredClone(original);
  session.capture.duration_ms = 5000;
  session.synchronization = { status: 'unknown', anchor: null, estimated_error_ms: null, notes: [] };
  const events = structuredClone(raw);
  // Engine starts at a nonzero frame; wall clock deliberately differs from movie time.
  events.forEach(event => { event.time.process_frame! += 900; });
  return { session, events };
}
const observations = [
  { event_id: 'evt-1', video_ms: 100, uncertainty_ms: 1 },
  { event_id: 'evt-3', video_ms: 1100, uncertainty_ms: 1 },
];

test('measured nonzero frame anchor maps without assuming wall/simulation/frame equivalence', () => {
  const { session, events } = setup();
  const before = JSON.stringify({ session, events });
  const measurement = measureSynchronization(session, events, 'process_frame', observations);
  assert.equal(measurement.synchronization.status, 'verified');
  assert.equal(measurement.synchronization.estimated_error_ms, 36);
  assert.deepEqual(measurement.residuals_ms, [0, 0]);
  assert.equal(JSON.stringify({ session, events }), before);
  session.synchronization = measurement.synchronization;
  assert.deepEqual(mapEventToVideo(session, events, 'evt-2'), { status: 'mapped', video_ms: 600, estimated_error_ms: 36 });
  assert.throws(() => measureSynchronization(session, events, 'wall_elapsed_ms', observations), /Wall/);
});

test('unknown anchors stay explicit, invalid/missing anchors never silently produce a timestamp', () => {
  const { session, events } = setup();
  assert.equal(mapEventToVideo(session, events, 'evt-2').status, 'unknown');
  session.synchronization = structuredClone(original.synchronization);
  assert.throws(() => mapEventToVideo(session, events, 'evt-2'), /anchor/);
  session.synchronization.anchor = null;
  assert.throws(() => mapEventToVideo(session, events, 'evt-2'), /anchor/);
});

test('one observation/short span remains approximate; large drift is surfaced, not fitted away', () => {
  const { session, events } = setup();
  assert.equal(measureSynchronization(session, events, 'process_frame', observations.slice(0, 1)).synchronization.status, 'approximate');
  const drift = measureSynchronization(session, events, 'process_frame', [observations[0], { ...observations[1], video_ms: 1800 }]);
  assert.equal(drift.synchronization.status, 'approximate');
  assert.equal(drift.synchronization.estimated_error_ms, 736);
  assert.deepEqual(drift.residuals_ms, [0, 700]);
});

test('malformed/out-of-video/repeated/missing/unordered observations rejected', () => {
  const { session, events } = setup();
  for (const bad of [null, [], Array(129).fill(observations[0]), [observations[0], observations[0]], [{ ...observations[0], event_id: 'evt-999' }], [{ ...observations[0], video_ms: -1 }], [{ ...observations[0], video_ms: 5000 }], [{ ...observations[0], uncertainty_ms: NaN }], [{ ...observations[0], extra: true }], [observations[1], observations[0]]]) {
    assert.throws(() => measureSynchronization(session, events, 'process_frame', bad));
  }
  events[0]!.time.process_frame = null;
  assert.throws(() => measureSynchronization(session, events, 'process_frame', observations), /clock/);
  session.status = 'incomplete';
  assert.throws(() => measureSynchronization(session, events, 'simulation_ms', observations), /finalized/);
});

test('conversion trim offsets are explicit, outside events not clamped, unknown not rescued', () => {
  const { session, events } = setup();
  session.synchronization = measureSynchronization(session, events, 'process_frame', observations).synchronization;
  const time = mapEventToVideo(session, events, 'evt-2');
  assert.deepEqual(mapToDerivedVideo(time, { source_start_ms: 100, duration_ms: 900 }), { status: 'mapped', video_ms: 500, estimated_error_ms: 36 });
  assert.equal(mapToDerivedVideo(time, { source_start_ms: 601, duration_ms: 900 }).status, 'outside');
  assert.equal(mapToDerivedVideo(time, { source_start_ms: 0, duration_ms: 600 }).status, 'outside');
  assert.throws(() => mapToDerivedVideo(time, { source_start_ms: NaN, duration_ms: 900 }));
  assert.deepEqual(mapToDerivedVideo({ status: 'unknown', reason: 'fixture' }, { source_start_ms: 0, duration_ms: 900 }), { status: 'unknown', reason: 'fixture' });
  session.synchronization.anchor!.video_ms = 0;
  session.synchronization.anchor!.event_id = 'evt-3';
  session.synchronization.anchor!.recorded_value = events[2]!.time.process_frame!;
  assert.equal(mapEventToVideo(session, events, 'evt-1').status, 'outside');
  assert.throws(() => mapEventToVideo(session, events, 'evt-999'), /Unknown event/);
});

test('simulation anchor and external wall anchor remain explicit supported clock choices', () => {
  const { session, events } = setup();
  assert.equal(measureSynchronization(session, events, 'simulation_ms', observations).synchronization.status, 'verified');
  session.capture.mode = 'external'; session.capture.format = 'mp4'; session.capture.video_path = 'recording.mp4';
  assert.throws(() => measureSynchronization(session, events, 'process_frame', observations), /fixed-fps/);
  const external: Session = { ...session, synchronization: measureSynchronization(session, events, 'wall_elapsed_ms', [{ ...observations[0] }, { ...observations[1], video_ms: 2100 }]).synchronization };
  assert.equal(mapEventToVideo(external, events, 'evt-2').status, 'mapped');
});

// Actual recording inspection and scene-specific visible timing measurement.
// Ground truth is read only to enumerate UUIDs; never passed to model context.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { SessionLibrary } from '../src/server/session-library.ts';
import { runMeasurement } from './measure-synchronization.ts';
import { prepareSession } from '../src/server/media-preparation.ts';

const root = resolve(process.argv[2] ?? '');
if (process.argv.length !== 3) throw new Error('Usage: prepare-evaluation.ts EVALUATION_ROOT');
const index = JSON.parse(readFileSync(join(root, 'evaluation.json'), 'utf8'));
const output = join(root, 'prepared.json');
if (existsSync(output)) throw new Error('Prepared index exists; reuse it, never silently prepare another set');
const library = await SessionLibrary.create(join(root, 'sessions'));
const checkpoint = join(root, 'preparation-checkpoint.json');
const prepared: { session_id: string; preparation_id: string; [key: string]: unknown }[] = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, 'utf8')) : [];
try {
  for (const run of index.runs) {
    const id: string = run.session_id;
    if (prepared.some(item => item.session_id === id)) { console.log(`Reusing checkpoint for ${id}`); continue; }
    const inspected = await library.inspect(id);
    assert.ok(inspected.ok, 'Complete real source required');
    const source = inspected;
    assert.ok(source.session.capture.duration_ms! >= 29900);
    const directory = join(root, 'sessions', id);
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', join(directory, 'recording.avi'), '-vf', 'crop=8:8:400:147', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1024 * 1024 });
    const frames: number[] = []; let previous = false;
    for (let offset = 0, frame = 0; offset < pixels.length; offset += 192, frame++) {
      let red = 0, green = 0, blue = 0;
      for (let p = 0; p < 64; p++) { red += pixels[offset + p * 3]! / 64; green += pixels[offset + p * 3 + 1]! / 64; blue += pixels[offset + p * 3 + 2]! / 64; }
      const lit = red > 180 && green < 140 && blue > 130;
      if (lit && !previous) frames.push(frame); previous = lit;
    }
    const markers = source.events.filter(event => event.kind === 'signal' && event.label === 'marker_changed');
    assert.equal(frames.length, 3); assert.equal(markers.length, 3);
    const observations = frames.map((frame, i) => ({ event_id: markers[i]!.id, video_ms: Math.round(frame * 1000 / source.session.capture.fps), uncertainty_ms: 1 }));
    const observationFile = join(root, id + '-observations.json');
    if (existsSync(observationFile)) assert.deepEqual(JSON.parse(readFileSync(observationFile, 'utf8')), observations);
    else writeFileSync(observationFile, JSON.stringify(observations, null, 2), { flag: 'wx' });
    const synchronization = source.session.synchronization.status === 'unknown' ? (await runMeasurement(directory, observationFile, 'process_frame', true)).report.synchronization : source.session.synchronization;
    assert.equal(synchronization.status, 'verified');
    assert.ok(synchronization.estimated_error_ms! <= 500);
    const result = await prepareSession(library, id, { start_ms: 0, duration_ms: Math.min(30000, source.session.capture.duration_ms!) });
    const context = readFileSync(join(directory, 'preparations', result.preparation_id, 'context.json'), 'utf8');
    assert.doesNotMatch(context, /POSTPLAY_DEMO|fault_enabled|ground_truth|"scenario"|"_fault"|buggy|evaluation_driver|depot_replay/);
    const events = readFileSync(join(directory, 'events.jsonl'), 'utf8');
    assert.doesNotMatch(events, /POSTPLAY_DEMO|fault_enabled|ground_truth|"scenario"|"_fault"|buggy|evaluation_driver|depot_replay/);
    prepared.push({ session_id: id, preparation_id: result.preparation_id, visible_frames: frames, measurement: synchronization, context_bytes: Buffer.byteLength(context) });
    writeFileSync(checkpoint, JSON.stringify(prepared, null, 2));
    console.log(`Prepared ${id}: ${frames.join('/')} visible frames, ${Buffer.byteLength(context)} context bytes; no mode identifiers`);
  }
  writeFileSync(output, JSON.stringify(prepared, null, 2), { flag: 'wx' });
} finally { await library.close(); }

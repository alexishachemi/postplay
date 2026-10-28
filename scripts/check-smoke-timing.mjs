// Development-only measurement of the smoke scene's visible magenta beacon.
// This does not detect gameplay defects or form part of model inference.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [video, telemetry, centerX = '760', centerY = '330'] = process.argv.slice(2);
assert.ok(video && telemetry, 'Usage: node scripts/check-smoke-timing.mjs VIDEO PROBE [X Y]');
const x = Number(centerX);
const y = Number(centerY);
assert.ok(Number.isInteger(x) && x >= 4 && Number.isInteger(y) && y >= 4);
const info = JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', video,
], { encoding: 'utf8' }));
assert.equal(info.streams[0].r_frame_rate, '30/1', 'This smoke check requires 30 fps');
assert.ok(Number(info.format.duration) <= 120, 'Smoke measurement is capped at 120 seconds');
assert.ok(x + 4 <= info.streams[0].width && y + 4 <= info.streams[0].height);
const pixels = execFileSync('ffmpeg', [
  '-v', 'error', '-i', video, '-vf', `crop=8:8:${x - 4}:${y - 4}`,
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { maxBuffer: 2 * 1024 * 1024 });
const starts = [];
let previouslyLit = false;
for (let frame = 0; frame < pixels.length / 192; frame++) {
  let r = 0, g = 0, b = 0;
  for (let offset = 0; offset < 192; offset += 3) {
    r += pixels[frame * 192 + offset];
    g += pixels[frame * 192 + offset + 1];
    b += pixels[frame * 192 + offset + 2];
  }
  const lit = r / 64 > 180 && g / 64 < 140 && b / 64 > 130;
  if (lit && !previouslyLit) starts.push(frame);
  previouslyLit = lit;
}
const events = readFileSync(telemetry, 'utf8').trim().split('\n').map(JSON.parse)
  .filter(event => event.kind === 'beacon_activated');
assert.ok(events.length > 0, 'No beacon interactions to measure');
assert.equal(starts.length, events.length, 'Visible flashes and telemetry counts must match');
const measurements = events.map((event, index) => {
  assert.equal(event.probe_version, 'smoke-1');
  assert.ok(Number.isInteger(event.simulation_ms));
  assert.equal(starts[index], event.process_frame, 'Visible flash must match the recorded process frame');
  const videoMs = starts[index] * 1000 / 30;
  const errorMs = videoMs - event.simulation_ms;
  assert.ok(Math.abs(errorMs) <= 500, 'Observed timing error exceeds 0.5 seconds');
  return { event_id: event.id, frame: starts[index], video_ms: videoMs, simulation_ms: event.simulation_ms, error_ms: errorMs };
});
console.log(JSON.stringify({
  measurements,
  max_observed_error_ms: Math.max(...measurements.map(item => Math.abs(item.error_ms))),
  frame_resolution_ms: 1000 / 30,
  limitation: 'Measured beacon transitions only; not a universal clock map or sub-frame precision.',
}, null, 2));

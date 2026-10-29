// Explicit GUI integration check, never part of the default headless test suite.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateSessionPackage } from '../src/server/session-contract.ts';
import { measureSynchronization, mapEventToVideo } from '../src/server/synchronization.ts';

const timing = process.argv.slice(2).includes('--timing');

const repo = fileURLToPath(new URL('../..', import.meta.url));
mkdirSync(join(repo, 'artifacts'), { recursive: true });
const root = mkdtempSync(join(repo, 'artifacts', 'editor capture-'));
const project = join(root, 'project');
cpSync(join(repo, 'demo'), project, { recursive: true, filter: path => !path.split('/').some(part => ['.godot', 'recordings', 'sessions', 'artifacts', 'node_modules'].includes(part) || part === '.env' || part.startsWith('.env.')) });
const projectFile = join(project, 'project.godot');
const originalProject = readFileSync(projectFile, 'utf8');
assert.ok(originalProject.includes('"res://addons/postplay/plugin.cfg"'));
const env = { ...process.env };
delete env.MODEL_API_KEY;
// Import once before enabling the test driver; don't race first-scan UI startup.
execFileSync('godot', ['--headless', '--editor', '--import', '--quit', '--path', project], { env, encoding: 'utf8', timeout: 60_000 });
writeFileSync(projectFile, readFileSync(projectFile, 'utf8').replace('"res://addons/postplay/plugin.cfg"', '"res://addons/postplay/plugin.cfg", "res://tests/editor_driver/plugin.cfg"'));
if (timing) writeFileSync(projectFile, readFileSync(projectFile, 'utf8').replace('[autoload]', '[autoload]\n\nTimingCalibration="*res://tests/timing_calibration.gd"'));
const stdout = execFileSync('godot', ['--editor', '--path', project, '--', join(root, 'sessions'), ...(timing ? ['timing'] : [])], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 100_000, maxBuffer: 4 * 1024 * 1024 });
process.stdout.write(stdout);
if (timing) {
  const line = stdout.split('\n').find(line => line.startsWith('POSTPLAY_TIMING_RESULT '));
  assert.ok(line, 'Timing capture did not finish');
  const directory = line.slice('POSTPLAY_TIMING_RESULT '.length).trim();
  const { session, events } = validateSessionPackage(JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8')), readFileSync(join(directory, 'events.jsonl'), 'utf8'));
  // Scene-specific visible detector, NOT a bug detector or a universal clock assumption.
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', join(directory, 'recording.avi'), '-vf', 'crop=8:8:756:326', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 2_000_000 });
  const frames: number[] = [];
  let previous = false;
  for (let offset = 0, frame = 0; offset < pixels.length; offset += 192, frame++) {
    const means = [0, 0, 0];
    for (let pixel = 0; pixel < 64; pixel++) for (let channel = 0; channel < 3; channel++) means[channel]! += pixels[offset + pixel * 3 + channel]! / 64;
    const lit = means[0]! > 180 && means[1]! < 140 && means[2]! > 130;
    if (lit && !previous) frames.push(frame);
    previous = lit;
  }
  const beacons = events.filter(event => event.kind === 'signal' && event.label === 'beacon_activated');
  assert.equal(frames.length, 3); assert.equal(beacons.length, 3);
  const observations = frames.map((frame, index) => ({ event_id: beacons[index]!.id, video_ms: Math.round(frame * 1000 / session.capture.fps), uncertainty_ms: 1 }));
  const measurement = measureSynchronization(session, events, 'process_frame', observations);
  assert.equal(measurement.synchronization.status, 'verified');
  assert.ok(measurement.synchronization.estimated_error_ms! <= 500);
  const aligned = { ...session, synchronization: measurement.synchronization };
  beacons.forEach(event => assert.equal(mapEventToVideo(aligned, events, event.id).status, 'mapped'));
  writeFileSync(join(root, 'observations.json'), JSON.stringify(observations, null, 2), { flag: 'wx' });
  writeFileSync(join(root, 'timing-result.json'), JSON.stringify({ fixture: 'Deterministic calibration, not gameplay evaluation', directory, measured_video_frames: frames, event_clocks: beacons.map(event => event.time), ...measurement }, null, 2), { flag: 'wx' });
  console.log(`PASS: actual Movie Maker beacon transitions measured. Artifacts: ${root}`);
  console.log(JSON.stringify(measurement, null, 2));
  process.exit(0);
}
const line = stdout.split('\n').find(line => line.startsWith('POSTPLAY_EDITOR_RESULT '));
assert.ok(line, 'Editor test did not reach a verified result');
const result = JSON.parse(line.slice('POSTPLAY_EDITOR_RESULT '.length)) as { directories: string[]; interrupted: string; normal_run: boolean; settings_restored: boolean; recovery: boolean };
assert.equal(result.directories.length, 2);
assert.equal(new Set(result.directories).size, 2);
for (const directory of result.directories) {
  const { session, events } = validateSessionPackage(JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8')), readFileSync(join(directory, 'events.jsonl'), 'utf8'));
  assert.equal(session.status, 'complete');
  assert.equal(session.synchronization.status, 'unknown');
  assert.ok(session.capture.duration_ms! > 0);
  assert.equal(events[0]!.label, 'capture_started');
  assert.equal(events.at(-1)!.label, 'runtime_stopped');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', join(directory, 'recording.avi')], { encoding: 'utf8' }));
  assert.equal(probe.streams[0].r_frame_rate, '30/1');
  assert.equal(probe.streams[0].width, session.capture.width);
  assert.equal(probe.streams[0].height, session.capture.height);
}
const interrupted = validateSessionPackage(JSON.parse(readFileSync(join(result.interrupted, 'session.json'), 'utf8')), readFileSync(join(result.interrupted, 'events.jsonl'), 'utf8'));
assert.equal(interrupted.session.status, 'incomplete');
assert.ok(result.normal_run && result.settings_restored && result.recovery);
process.stdout.write(`PASS: two editor captures, interrupted capture, media/contracts, settings restoration, ordinary run and recovery. Artifacts: ${root}\n`);

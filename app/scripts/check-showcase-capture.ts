// Explicit GUI verification: real Movie Maker + unchanged production addon.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { SessionLibrary } from '../src/server/session-library.ts';
import { runMeasurement } from './measure-synchronization.ts';
import { prepareSession } from '../src/server/media-preparation.ts';

const [game, ...extra] = process.argv.slice(2);
if (!['2d_platformer', 'top_down'].includes(game ?? '') || extra.length) throw new Error('Usage: check-showcase-capture.ts 2d_platformer|top_down (GUI; no uploads)');
const repo = fileURLToPath(new URL('../..', import.meta.url));
mkdirSync(join(repo, 'artifacts'), { recursive: true });
const root = mkdtempSync(join(repo, 'artifacts', 'showcase-capture-'));
const project = join(root, 'project');
cpSync(join(repo, 'demos', game!), project, { recursive: true, filter: path => !path.split('/').some(part => ['.godot', 'recordings', 'sessions'].includes(part) || part === '.env' || part.startsWith('.env.')) });
const env: NodeJS.ProcessEnv = { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' };
delete env.MODEL_API_KEY;
delete env.POSTPLAY_DEMO_CASE; delete env.POSTPLAY_DEMO_FAULT;
console.log(`Disposable real capture: ${root}`);
execFileSync('godot', ['--headless', '--editor', '--import', '--quit', '--path', project], { env, encoding: 'utf8', timeout: 120000 });
cpSync(join(repo, 'tests/fixtures/showcase-capture'), join(project, 'tests/postplay_capture'), { recursive: true });
const config = join(project, 'project.godot');
const original = readFileSync(config, 'utf8');
assert.ok(original.includes('"res://addons/postplay/plugin.cfg"') && original.includes('[autoload]'));
writeFileSync(config, original.replace('"res://addons/postplay/plugin.cfg"', '"res://addons/postplay/plugin.cfg", "res://tests/postplay_capture/plugin.cfg"').replace('[autoload]', '[autoload]\nShowcaseCalibration="*res://tests/postplay_capture/calibration.gd"'));
writeFileSync(join(project, '.godot/editor/project_metadata.cfg'), '[game_view]\nembed_on_play=false\n');
const stdout = execFileSync('godot', ['--editor', '--display-driver', 'x11', '--path', project, '--', join(root, 'sessions')], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 140000, maxBuffer: 4 * 1024 * 1024 });
const line = stdout.split('\n').find(line => line.startsWith('POSTPLAY_SHOWCASE_RESULT '));
assert.ok(line, 'Actual recording did not reach verified finalization');
const directory = line.slice('POSTPLAY_SHOWCASE_RESULT '.length).trim();
const id = directory.split('/').at(-1)!;
const library = await SessionLibrary.create(join(root, 'sessions'));
try {
  const inspection = await library.inspect(id);
  assert.ok(inspection.ok, 'Complete media/telemetry required');
  assert.ok(inspection.media.duration_ms >= 5900 && inspection.media.duration_ms < 7000);
  assert.equal(inspection.session.synchronization.status, 'unknown');
  const pulses = inspection.events.filter(event => event.kind === 'signal' && event.label === 'timing_pulse');
  assert.equal(pulses.length, 3, 'Existing gameplay timing signal must actually be observed');
  assert.ok(inspection.events.some(event => event.kind === 'property'));
  assert.ok(inspection.events.some(event => event.kind === 'position'));
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', join(directory, 'recording.avi'), '-vf', 'crop=8:2:400:78', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 100000 });
  const frames: number[] = []; let previous = false;
  for (let offset = 0, frame = 0; offset < pixels.length; offset += 48, frame++) {
    let red = 0, green = 0, blue = 0;
    for (let p = 0; p < 16; p++) { red += pixels[offset+p*3]!/16; green += pixels[offset+p*3+1]!/16; blue += pixels[offset+p*3+2]!/16; }
    const lit = red > 180 && green < 140 && blue > 130;
    if (lit && !previous) frames.push(frame); previous = lit;
  }
  assert.equal(frames.length, 3, 'Three actual visible pulse onsets required');
  const observations = frames.map((frame, index) => ({ event_id: pulses[index]!.id, video_ms: Math.round(frame*1000/30), uncertainty_ms: 1 }));
  const observationFile = join(root, 'observations.json');
  writeFileSync(observationFile, JSON.stringify(observations, null, 2), { flag: 'wx' });
  const measured = await runMeasurement(directory, observationFile, 'process_frame', true);
  assert.equal(measured.report.synchronization.status, 'verified');
  assert.ok(measured.report.synchronization.estimated_error_ms! <= 500);
  const preparation = await prepareSession(library, id, { start_ms: 0, duration_ms: Math.min(6000, inspection.media.duration_ms) });
  const context = readFileSync(join(directory, preparation.relative_directory, 'context.json'), 'utf8');
  assert.doesNotMatch(context, /POSTPLAY_DEMO|fault_enabled|ground_truth|"_fault"|ShowcaseCalibration|postplay_capture/);
  const screenshot = join(root, 'source-frame.png');
  execFileSync('ffmpeg', ['-v', 'error', '-n', '-ss', '2', '-i', join(directory, 'recording.avi'), '-frames:v', '1', screenshot]);
  const result = { game, root, session_id: id, preparation_id: preparation.preparation_id, duration_ms: inspection.media.duration_ms, visible_frames: frames, synchronization: measured.report.synchronization, events: inspection.events.length, registrations: inspection.session.registrations.length, screenshot, remote_calls: 0, fixture: 'Fixed calibration and limited input, not full gameplay or real model evaluation' };
  writeFileSync(join(root, 'verification.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
} finally { await library.close(); }

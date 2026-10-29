// Explicit GUI integration check, never part of the default headless test suite.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateSessionPackage } from '../src/server/session-contract.ts';

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
const stdout = execFileSync('godot', ['--editor', '--path', project, '--', join(root, 'sessions')], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 100_000, maxBuffer: 4 * 1024 * 1024 });
process.stdout.write(stdout);
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

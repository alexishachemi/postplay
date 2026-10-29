// Explicit GUI verification. Copies ONLY the addon into an independent project.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateSessionPackage } from '../src/server/session-contract.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
mkdirSync(join(repo, 'artifacts'), { recursive: true });
const root = mkdtempSync(join(repo, 'artifacts', 'fresh project-'));
const project = join(root, 'project');
const filter = (path: string) => !path.split('/').includes('.godot');
cpSync(join(repo, 'tests/fixtures/godot-project'), project, { recursive: true, filter });
cpSync(join(repo, 'demo/addons/postplay'), join(project, 'addons/postplay'), { recursive: true });
const projectFile = join(project, 'project.godot');
assert.ok(!readFileSync(projectFile, 'utf8').includes('[autoload]'));
assert.ok(!readFileSync(join(project, 'game.gd'), 'utf8').includes('PostPlay'));
assert.ok(!existsSync(join(project, 'main.gd')));
const env = { ...process.env };
delete env.MODEL_API_KEY;
execFileSync('godot', ['--headless', '--editor', '--import', '--quit', '--path', project], { env, encoding: 'utf8', timeout: 60_000 });
// Catch fixture parse errors before opening an editor that cannot run its watchdog.
for (const script of ['game.gd', 'observed_game.gd', 'editor_driver/driver.gd']) {
  execFileSync('godot', ['--headless', '--path', project, '--check-only', '--script', `res://${script}`], { env, encoding: 'utf8', timeout: 30_000 });
}
assert.ok(!readFileSync(projectFile, 'utf8').includes('[autoload]'), 'Import alone must not install an inactive addon');
writeFileSync(projectFile, readFileSync(projectFile, 'utf8') + '\n[editor_plugins]\nenabled=PackedStringArray("res://editor_driver/plugin.cfg")\n');
const stdout = execFileSync('godot', ['--editor', '--path', project, '--', join(root, 'sessions')], { env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 100_000, maxBuffer: 4 * 1024 * 1024 });
process.stdout.write(stdout);
const line = stdout.split('\n').find(line => line.startsWith('POSTPLAY_FRESH_PROJECT_RESULT '));
assert.ok(line, 'Fresh-project driver did not complete');
const result = JSON.parse(line.slice('POSTPLAY_FRESH_PROJECT_RESULT '.length)) as { directories: string[]; normal_run: boolean; settings_restored: boolean; disabled: boolean };
assert.equal(result.directories.length, 2);
assert.equal(new Set(result.directories).size, 2);
const packages = result.directories.map(directory => {
  const parsed = validateSessionPackage(JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8')), readFileSync(join(directory, 'events.jsonl'), 'utf8'));
  assert.equal(parsed.session.status, 'complete');
  assert.equal(parsed.session.project.name, 'Independent capture fixture');
  assert.equal(parsed.session.synchronization.status, 'unknown');
  assert.ok(parsed.session.capture.duration_ms! >= 2900);
  assert.equal(parsed.events[0]!.label, 'capture_started');
  assert.equal(parsed.events.at(-1)!.label, 'runtime_stopped');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', join(directory, 'recording.avi')], { encoding: 'utf8' }));
  assert.equal(probe.streams[0].r_frame_rate, '30/1');
  assert.equal(probe.streams[0].width, 480); assert.equal(probe.streams[0].height, 270);
  return parsed;
});
const basic = packages[0]!;
assert.equal(basic.session.project.scene, 'basic.tscn');
assert.deepEqual(basic.session.registrations, []);
assert.ok(basic.events.every(event => event.registration_id === null && ['lifecycle', 'input'].includes(event.kind)));
const observed = packages[1]!;
assert.equal(observed.session.project.scene, 'observed.tscn');
assert.deepEqual(observed.session.registrations.map(item => item.kind), ['signal', 'property']);
const signals = observed.events.filter(event => event.kind === 'signal');
assert.equal(signals.length, 1); assert.equal(signals[0]!.label, 'health_changed');
assert.deepEqual(signals[0]!.payload, { type: 'dictionary', entries: { signal: 'health_changed', arguments: [9] } });
const properties = observed.events.filter(event => event.kind === 'property');
assert.equal(properties.length, 2);
assert.deepEqual(properties.map(event => event.payload), [
  { type: 'dictionary', entries: { property: 'health', phase: 'initial', value: 10 } },
  { type: 'dictionary', entries: { property: 'health', phase: 'change', value: 9 } },
]);
assert.ok(result.normal_run && result.settings_restored && result.disabled);
assert.ok(!readFileSync(projectFile, 'utf8').includes('PostPlay='), 'Disabling must remove the installed autoload');
writeFileSync(join(root, 'verification.json'), JSON.stringify({ fixture: 'Independent deterministic integration; not human gameplay or evaluation', ...result, basic_events: basic.events.length, observed_events: observed.events.length }, null, 2), { flag: 'wx' });
console.log(`PASS: copied addon enabled from scratch; no-hook and signal/property captures, ordinary run, settings restoration and disable. Artifacts: ${root}`);

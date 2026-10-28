import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { CONTRACT_LIMITS, validateSessionPackage } from '../src/server/session-contract.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const args = ['--headless', '--path', join(repo, 'demo'), '--script', 'res://tests/collector_test.gd', '--'];
const temporary = () => mkdtempSync(join(tmpdir(), 'postplay-collector-fixture-'));
const load = (directory: string) => validateSessionPackage(JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8')), readFileSync(join(directory, 'events.jsonl'), 'utf8'));
function run(mode: string, root = temporary()) {
  const stdout = execFileSync('godot', [...args, root, mode], { encoding: 'utf8', timeout: 45_000 });
  const line = stdout.split('\n').find(line => line.startsWith('POSTPLAY_COLLECTOR_RESULT '));
  assert.ok(line, stdout);
  const result = JSON.parse(line.slice('POSTPLAY_COLLECTOR_RESULT '.length)) as { directory: string; supplied: string };
  assert.equal(readdirSync(root).length, 2, 'only the two intended directories exist');
  return { ...result, package: load(result.directory), suppliedPackage: load(result.supplied) };
}

test('two runtime runs have distinct IDs, coherent portable data and no overwrites', () => {
  const first = run('seal');
  const second = run('seal');
  assert.notEqual(first.package.session.session_id, second.package.session.session_id);
  for (const result of [first, second]) {
    const { session, events, diagnostics } = result.package;
    assert.equal(session.status, 'recording');
    assert.equal(session.ended_at_utc, null);
    assert.equal(session.capture.duration_ms, null);
    assert.equal(session.synchronization.status, 'unknown');
    assert.equal(session.telemetry.event_count, 4);
    assert.deepEqual(events.map(event => event.label), ['capture_started', 'fixture_observation', 'after_frames', 'runtime_stopped']);
    assert.ok(events[2]!.time.simulation_ms > 0);
    assert.ok(diagnostics.some(message => message.includes('finalization')));
    assert.equal(result.suppliedPackage.session.session_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(result.suppliedPackage.session.capture.collision_debug, true);
    assert.equal(result.suppliedPackage.session.status, 'incomplete');
    assert.ok(!readdirSync(result.directory).includes('session.json.pending'));
  }
});

test('explicit abort is terminal incomplete; scene-tree exit seals without claiming video completion', () => {
  const aborted = run('abort').package;
  assert.equal(aborted.session.status, 'incomplete');
  assert.ok(aborted.session.ended_at_utc);
  assert.equal(aborted.events.at(-1)!.label, 'capture_aborted');
  const exited = run('tree_exit').package;
  assert.equal(exited.session.status, 'recording');
  assert.equal(exited.events.at(-1)!.label, 'runtime_stopped');
  assert.equal(exited.session.telemetry.event_count, exited.events.length);
});

test('periodic checkpoints persist the live event count without finalizing media', () => {
  const result = run('checkpoint');
  assert.equal(result.package.session.status, 'recording');
  assert.equal(result.package.session.telemetry.event_count, 4);
});

test('event and byte caps preserve valid partial logs and flag truncation', () => {
  const capped = run('limit');
  assert.equal(capped.package.events.length, CONTRACT_LIMITS.events);
  assert.equal(capped.package.session.telemetry.truncated, true);
  assert.equal(capped.package.session.status, 'incomplete');
  const bytes = run('bytes');
  assert.ok(bytes.package.events.length < CONTRACT_LIMITS.events);
  assert.equal(bytes.package.session.telemetry.truncated, true);
  assert.equal(bytes.package.session.status, 'incomplete');
  assert.ok(statSync(join(bytes.directory, 'events.jsonl')).size <= CONTRACT_LIMITS.logBytes);
});

test('failed manifest replacement returns an error and retains the last valid checkpoint', () => {
  const result = run('io_error');
  assert.equal(result.package.session.status, 'recording');
  assert.equal(result.package.session.telemetry.event_count, 3);
  assert.equal(result.package.events.length, 5);
  assert.equal(result.package.events.at(-1)!.label, 'capture_aborted');
  assert.ok(result.package.diagnostics.some(message => message.includes('lags')));
  assert.ok(statSync(join(result.directory, 'session.json.pending')).isDirectory());
});

test('SIGKILL preserves flushed observations and an explicitly unfinalized manifest', { timeout: 30_000 }, async () => {
  const root = temporary();
  const child = spawn('godot', [...args, root, 'kill'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = '';
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  try {
    const directory = await new Promise<string>((resolve, reject) => {
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(/POSTPLAY_COLLECTOR_READY (.+)\n/);
        if (match) resolve(match[1]!);
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`Godot exited before ready: ${output}\n${stderr}`)));
    });
    child.kill('SIGKILL');
    const [, signal] = await exited;
    assert.equal(signal, 'SIGKILL');
    const interrupted = load(directory);
    assert.equal(interrupted.session.status, 'recording');
    assert.equal(interrupted.session.ended_at_utc, null);
    assert.equal(interrupted.events.length, 2);
    assert.equal(interrupted.events[1]!.label, 'fixture_observation');
    assert.ok(interrupted.session.telemetry.event_count <= interrupted.events.length);
    assert.ok(interrupted.diagnostics.some(message => message.includes('finalization')));
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
});

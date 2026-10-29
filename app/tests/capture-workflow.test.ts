import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateSession, validateSessionPackage } from '../src/server/session-contract.ts';

function run(mode: string) {
  const root = mkdtempSync(join(tmpdir(), 'postplay-workflow-fixture-'));
  const stdout = execFileSync('godot', ['--headless', '--path', fileURLToPath(new URL('../../demo', import.meta.url)), '--script', 'res://tests/capture_workflow_test.gd', '--', root, mode], { encoding: 'utf8', timeout: 20_000 });
  const line = stdout.split('\n').find(line => line.startsWith('POSTPLAY_WORKFLOW_RESULT '));
  assert.ok(line, stdout);
  const directory = line.slice('POSTPLAY_WORKFLOW_RESULT '.length);
  const session = validateSession(JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8')));
  return { directory, session, log: readFileSync(join(directory, 'events.jsonl'), 'utf8') };
}

test('reserved capture is claimed once, finalizes measured fixture media and never rewrites terminal status', () => {
  const { session, log } = run('complete');
  const complete = validateSessionPackage(session, log);
  assert.equal(complete.session.status, 'complete');
  assert.equal(complete.session.capture.duration_ms, 200);
  assert.equal(complete.session.capture.width, 64);
  assert.equal(complete.session.capture.height, 48);
  assert.equal(complete.session.synchronization.status, 'unknown');
});
for (const mode of ['interrupted', 'missing_media', 'bad_media', 'fps']) {
  test(`capture finalizer preserves a truthful incomplete outcome: ${mode}`, () => {
    const { session, log } = run(mode);
    assert.equal(validateSessionPackage(session, log).session.status, 'incomplete');
    assert.ok(session.synchronization.notes.length);
  });
}
test('corrupted telemetry remains an explicit validation failure, never a clean or silently repaired log', () => {
  const { session, log } = run('corrupt_tail');
  assert.equal(session.status, 'incomplete');
  assert.ok(log.endsWith('{"broken":'));
  assert.throws(() => validateSessionPackage(session, log), /line/);
});
test('finalization cannot touch a package while its capture process is still alive', () => {
  const { session, log } = run('alive');
  assert.equal(validateSessionPackage(session, log).session.status, 'recording');
});

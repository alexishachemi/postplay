import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInspectionFixture } from './fixtures/inspection-session.ts';

test('Relay Depot gameplay reproduces independent faults and working controls without recording or a model', () => {
  const env = { ...process.env }; delete env.MODEL_API_KEY;
  const demo = new URL('../../demo', import.meta.url).pathname;
  const output = execFileSync('godot', ['--headless', '--path', demo, '--script', 'res://tests/playtest_test.gd'], { env, encoding: 'utf8', timeout: 20000 });
  assert.match(output, /PASS: energy\/HUD, collision segment, transfer\/reset and clean counterparts/);
});

test('evaluation upload tool requires explicit consent and credentials before reading input or creating attempts', () => {
  const env = { ...process.env, MODEL_API_KEY: '' };
  for (const name of ['analyze-evaluation', 'evaluation-followup']) {
    const script = new URL(`../scripts/${name}.ts`, import.meta.url).pathname;
    assert.throws(() => execFileSync(process.execPath, [script, '/missing-evaluation'], { env, stdio: 'pipe' }), /Usage:.*--upload-to-meta/);
    const args = name === 'evaluation-followup' ? ['/missing-evaluation', 'session-id', '--upload-to-meta'] : ['/missing-evaluation', '--upload-to-meta'];
    assert.throws(() => execFileSync(process.execPath, [script, ...args], { env, stdio: 'pipe' }), /MODEL_API_KEY required server-side/);
  }
});

test('parallel saved-session followup recovery preserves independent checkpoints and cannot use networking', async () => {
  const root = mkdtempSync(join(tmpdir(), 'postplay-followup-')), sessions = join(root, 'sessions'); mkdirSync(sessions);
  const fixtures = await Promise.all([createInspectionFixture(sessions, 'empty'), createInspectionFixture(sessions, 'empty')]);
  writeFileSync(join(root, 'prepared.json'), JSON.stringify(fixtures.map(f => ({ session_id: f.id, preparation_id: f.preparation_id }))));
  const script = new URL('../scripts/evaluation-followup.ts', import.meta.url).pathname;
  const denial = new URL('./fixtures/deny-outbound.mjs', import.meta.url).pathname;
  await Promise.all(fixtures.map(f => promisify(execFile)(process.execPath, ['--import', denial, script, root, f.id, '--upload-to-meta'], { env: { ...process.env, MODEL_API_KEY: 'offline-recovery-credential' }, timeout: 20000 })));
  for (const f of fixtures) {
    const saved = JSON.parse(readFileSync(join(root, `followups-${f.id}.json`), 'utf8'));
    assert.equal(saved.length, 1); assert.equal(saved[0].preparation_id, f.preparation_id); assert.equal(saved[0].status, 'analyzed_no_findings');
  }
});

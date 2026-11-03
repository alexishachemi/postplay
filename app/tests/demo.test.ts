import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('Relay Depot gameplay reproduces independent faults and working controls without recording or a model', () => {
  const env = { ...process.env }; delete env.MODEL_API_KEY;
  const demo = new URL('../../demo', import.meta.url).pathname;
  const output = execFileSync('godot', ['--headless', '--path', demo, '--script', 'res://tests/playtest_test.gd'], { env, encoding: 'utf8', timeout: 20000 });
  assert.match(output, /PASS: energy\/HUD, collision segment, transfer\/reset and clean counterparts/);
});

test('evaluation upload tool requires explicit consent and credentials before reading input or creating attempts', () => {
  const script = new URL('../scripts/analyze-evaluation.ts', import.meta.url).pathname;
  const env = { ...process.env, MODEL_API_KEY: '' };
  assert.throws(() => execFileSync(process.execPath, [script, '/missing-evaluation'], { env, stdio: 'pipe' }), /Usage:.*--upload-to-meta/);
  assert.throws(() => execFileSync(process.execPath, [script, '/missing-evaluation', '--upload-to-meta'], { env, stdio: 'pipe' }), /MODEL_API_KEY required server-side/);
});

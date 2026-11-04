import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
test('independent showcase addon copies remain byte-identical to canonical source', () => {
  const output = execFileSync(process.execPath, ['app/scripts/showcase-addons.ts', 'check'], { cwd: repo, encoding: 'utf8', timeout: 10000 });
  assert.match(output, /PASS: 2d_platformer/);
  assert.match(output, /PASS: top_down/);
});

test('showcase developer tools reject invalid commands without launching GUI, capture or model actions', () => {
  for (const [script, args] of [
    ['showcase-addons', ['overwrite']], ['showcase-addons', ['install', 'extra']],
    ['check-showcase-capture', ['../../demo']], ['check-showcase-capture', ['top_down', '--upload-to-meta']],
  ] as const) {
    assert.throws(() => execFileSync(process.execPath, [`app/scripts/${script}.ts`, ...args], { cwd: repo, stdio: 'pipe', timeout: 10000 }), /Usage:/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInspectionFixture } from './fixtures/inspection-session.ts';
import { SessionLibrary } from '../src/server/session-library.ts';
import { loadFindingsReport } from '../src/server/report-storage.ts';

test('local submission copies reopen offline, retain failed attempts and leave source bytes unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'postplay-submission-'));
  const ready = await createInspectionFixture(root), failed = await createInspectionFixture(root, 'failed');
  const preparation = join(ready.directory, 'preparations', ready.preparation_id);
  const oldTime = new Date('2020-01-01T00:00:00Z');
  utimesSync(preparation, oldTime, oldTime);
  utimesSync(join(preparation, 'analysis'), oldTime, oldTime);
  const original = readFileSync(join(ready.directory, 'preparations', ready.preparation_id, 'analysis', 'findings.json'));
  const cli = new URL('../scripts/prepare-submission.ts', import.meta.url).pathname;
  const denial = new URL('./fixtures/deny-outbound.mjs', import.meta.url).pathname;
  const output = execFileSync(process.execPath, ['--import', denial, cli, root], { cwd: root, env: { ...process.env, MODEL_API_KEY: '' }, encoding: 'utf8', timeout: 30000 });
  const result = JSON.parse(output.trim().split('\n').at(-1)!);
  assert.equal(result.sessions, 2); assert.equal(result.validated_reports, 1); assert.equal(result.remote_calls, 0);
  assert.equal(statSync(join(result.session_root, ready.id, 'preparations', ready.preparation_id)).mtimeMs, oldTime.getTime());
  assert.equal(statSync(join(result.session_root, ready.id, 'preparations', ready.preparation_id, 'analysis')).mtimeMs, oldTime.getTime());
  const manifest = JSON.parse(readFileSync(join(result.output, 'ready.json'), 'utf8'));
  assert.ok(manifest.files.every((file: { sha256: string }) => /^[0-9a-f]{64}$/.test(file.sha256)));
  assert.deepEqual(readFileSync(join(ready.directory, 'preparations', ready.preparation_id, 'analysis', 'findings.json')), original);
  const library = await SessionLibrary.create(result.session_root);
  try { assert.equal((await loadFindingsReport(library, ready.id, ready.preparation_id)).status, 'analyzed_with_findings'); }
  finally { await library.close(); }
  const failure = join(failed.id, 'preparations', failed.preparation_id, 'analysis', 'failure.json');
  assert.deepEqual(readFileSync(join(root, failure)), readFileSync(join(result.session_root, failure)));
});

test('submission copying refuses linked extras and never marks a partial bundle ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'postplay-submission-links-'));
  const f = await createInspectionFixture(root);
  symlinkSync(join(f.directory, 'events.jsonl'), join(f.directory, 'untrusted-link'));
  const cli = new URL('../scripts/prepare-submission.ts', import.meta.url).pathname;
  assert.throws(() => execFileSync(process.execPath, [cli, root], { cwd: root, stdio: 'pipe', timeout: 30000 }), /link or nonregular/);
  for (const bundle of readdirSync(join(root, 'artifacts'))) assert.ok(!readdirSync(join(root, 'artifacts', bundle)).includes('ready.json'));
});

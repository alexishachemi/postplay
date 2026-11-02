import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SessionLibrary } from '../src/server/session-library.ts';
import { prepareSession } from '../src/server/media-preparation.ts';
import { analyzeSession } from '../src/server/session-analysis.ts';
import { analysisView, runAnalysisAction, parseAnalysisAction, controlError, AnalysisControlError } from '../src/server/dashboard-analysis.ts';
import { POST } from '../src/pages/api/sessions/[id]/analysis.ts';

const root = mkdtempSync(join(tmpdir(), 'postplay-controls-'));
const media = join(root, 'fixture.avi');
execFileSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=30', '-t', '2', '-c:v', 'mjpeg', media]);
const fixture = (name: string) => readFileSync(new URL(`../../contracts/fixtures/complete/${name}`, import.meta.url), 'utf8');
async function capture() {
  const dir = mkdtempSync(join(root, 'library-')), id = randomUUID(), path = join(dir, id); mkdirSync(path);
  const manifest = JSON.parse(fixture('session.json')); manifest.session_id = id; manifest.capture.width = 64; manifest.capture.height = 48;
  writeFileSync(join(path, 'session.json'), JSON.stringify(manifest));
  writeFileSync(join(path, 'events.jsonl'), fixture('events.jsonl').replaceAll('11111111-1111-4111-8111-111111111111', id));
  writeFileSync(join(path, 'recording.avi'), readFileSync(media));
  return { path, manifest, id, library: await SessionLibrary.create(dir) };
}
const success: typeof fetch = async (url, init) => {
  if (init?.method === 'DELETE') return Response.json({ deleted: true });
  if (String(url).endsWith('/files')) return Response.json({ id: 'file-fixture' });
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ schema_version: '1', coverage_summary: 'Synthetic controls fixture, not a real model response', coverage_limitations: [], findings: [] }) }] }] });
};
const prepare = { action: 'prepare', start_ms: 0, duration_ms: 2000, reviewed_previous_attempt: false } as const;
const upload = (id: string) => ({ action: 'analyze', preparation_id: id, upload_to_meta: true } as const);

test('consent/action validation is exact and public errors never echo provider prose or credentials', async () => {
  for (const value of [null, {}, { ...prepare, duration_ms: 0 }, { ...prepare, start_ms: -1 }, { ...prepare, apiKey: 'secret' }, { ...upload(randomUUID()), upload_to_meta: false }, { action: 'analyze', preparation_id: randomUUID() }, upload('../.env')]) assert.throws(() => parseAnalysisAction(value));
  assert.equal(controlError(new Error('secret /private/path')).code, 'local_failure');
  assert.equal(controlError(new AnalysisControlError('constructor')).code, 'local_failure');
  assert.equal(typeof controlError(new AnalysisControlError('constructor')).message, 'string');
  const request = new Request('http://localhost/api/sessions/id/analysis', { method: 'POST', headers: { host: 'attacker.invalid', origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(prepare) });
  const response = await POST({ request, params: { id: randomUUID() }, url: new URL(request.url) } as unknown as Parameters<typeof POST>[0]); assert.equal(response.status, 403);
});

test('prepare is local, upload requires consent/key, successful action saves report once and blocks repeats', async () => {
  const f = await capture(); let calls = 0;
  const options = { apiKey: 'fixture-sensitive-key', fetcher: (async (...args) => { calls++; return await success(...args); }) as typeof fetch };
  try {
    assert.equal((await analysisView(f.library, f.id)).phase, 'unprepared');
    const ready = await runAnalysisAction(f.library, f.id, prepare, options); assert.equal(ready.remote_upload, false); assert.equal(calls, 0);
    const view = await analysisView(f.library, f.id); assert.equal(view.phase, 'ready'); assert.equal(view.preparation?.id, ready.preparation_id); assert.ok(view.preparation!.video_bytes > 0);
    await assert.rejects(runAnalysisAction(f.library, f.id, upload(ready.preparation_id), { apiKey: '', fetcher: options.fetcher }), /credentials_missing/); assert.equal(calls, 0);
    const result = await runAnalysisAction(f.library, f.id, upload(ready.preparation_id), options); assert.equal(result.remote_upload, true); assert.equal(calls, 3);
    const saved = await analysisView(f.library, f.id); assert.equal(saved.phase, 'finished'); assert.equal(saved.reserved, true); assert.equal(saved.cleanup, 'deleted');
    await assert.rejects(runAnalysisAction(f.library, f.id, upload(ready.preparation_id), options), /already_started/); assert.equal(calls, 3);
    await assert.rejects(runAnalysisAction(f.library, f.id, prepare, options), /prior_attempt_review/);
    const newClip = await runAnalysisAction(f.library, f.id, { ...prepare, reviewed_previous_attempt: true }, options); assert.notEqual(newClip.preparation_id, ready.preparation_id); assert.equal(calls, 3);
    assert.ok(!JSON.stringify(saved).includes('fixture-sensitive-key') && !JSON.stringify(saved).includes(f.path));
  } finally { await f.library.close(); }
});

test('concurrent session operations are rejected while status reflects actual persisted inference stage', async () => {
  const f = await capture(); let inference = 0, release!: () => void, reached!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }); const begun = new Promise<void>(resolve => { reached = resolve; });
  try {
    const ready = await runAnalysisAction(f.library, f.id, prepare);
    const operation = runAnalysisAction(f.library, f.id, upload(ready.preparation_id), { apiKey: 'fixture-control-secret', fetcher: async (url, init) => {
      if (String(url).endsWith('/responses')) { inference++; reached(); await pending; } return await success(url, init);
    } });
    await begun;
    const status = await analysisView(f.library, f.id); assert.equal(status.phase, 'reasoning'); assert.equal(status.active, true); assert.equal(status.reserved, true);
    await assert.rejects(runAnalysisAction(f.library, f.id, upload(ready.preparation_id), { apiKey: 'fixture-control-secret' }), /busy/);
    await assert.rejects(runAnalysisAction(f.library, f.id, prepare), /busy/);
    release(); await operation; assert.equal(inference, 1); assert.equal((await analysisView(f.library, f.id)).active, false);
  } finally { release(); await f.library.close(); }
});

test('mock authentication/offline/invalid-response errors stay failed and reservations prevent resubmission', async () => {
  for (const mode of ['auth', 'offline', 'invalid'] as const) {
    const f = await capture(); let calls = 0;
    try {
      const ready = await runAnalysisAction(f.library, f.id, prepare);
      await assert.rejects(runAnalysisAction(f.library, f.id, upload(ready.preparation_id), { apiKey: 'fixture-sensitive-key', fetcher: async (url, init) => {
        calls++;
        if (mode === 'offline') throw new Error('fixture-sensitive-key /private/provider/path');
        if (String(url).endsWith('/responses')) return mode === 'auth' ? Response.json({ error: { message: 'fixture-sensitive-key', code: 'bad_key' } }, { status: 401 }) : Response.json({ status: 'completed', output: [] });
        return await success(url, init);
      } }));
      const view = await analysisView(f.library, f.id); assert.equal(view.phase, 'failed'); assert.equal(view.reserved, true);
      assert.equal(view.code, mode === 'auth' ? 'authentication_failed' : mode === 'offline' ? 'transport_unknown' : 'invalid_response');
      assert.ok(!JSON.stringify(view).includes('fixture-sensitive-key') && !JSON.stringify(view).includes('/private/'));
      const before = calls; await assert.rejects(runAnalysisAction(f.library, f.id, upload(ready.preparation_id), { apiKey: 'fixture-control-secret' }), /already_started/); assert.equal(calls, before);
      assert.ok(!existsSync(join(f.path, 'preparations', ready.preparation_id, 'analysis', 'findings.json')));
    } finally { await f.library.close(); }
  }
});

test('completed proposals recover report offline; interrupted and corrupt reports cannot be clean or retried', async () => {
  const f = await capture();
  try {
    const prepared = await prepareSession(f.library, f.id);
    await analyzeSession(f.library, f.id, prepared.preparation_id, { upload_to_meta: true, apiKey: 'fixture-control-secret', fetcher: success });
    assert.equal((await analysisView(f.library, f.id)).phase, 'report_available');
    const recovered = await runAnalysisAction(f.library, f.id, { action: 'report', preparation_id: prepared.preparation_id }, { apiKey: '', fetcher: async () => { throw new Error('Network forbidden'); } });
    assert.equal(recovered.remote_upload, false); assert.equal((await analysisView(f.library, f.id)).phase, 'finished');
    writeFileSync(join(f.path, prepared.relative_directory, 'analysis', 'findings.json'), '{}');
    assert.equal((await analysisView(f.library, f.id)).phase, 'failed');
    writeFileSync(join(f.path, prepared.relative_directory, 'clip.mp4'), 'corrupt');
    const corrupt = await analysisView(f.library, f.id); assert.equal(corrupt.phase, 'failed'); assert.equal(corrupt.reserved, true); assert.equal(corrupt.preparation, null);
    await assert.rejects(runAnalysisAction(f.library, f.id, prepare), /prior_attempt_review/);
    const next = await prepareSession(f.library, f.id); const run = join(f.path, next.relative_directory, 'analysis'); mkdirSync(run);
    const view = await analysisView(f.library, f.id); assert.equal(view.phase, 'interrupted'); assert.equal(view.reserved, true); assert.equal(view.active, false);
    await assert.rejects(runAnalysisAction(f.library, f.id, upload(next.preparation_id), { apiKey: 'fixture-control-secret' }), /already_started/);
    assert.deepEqual(readdirSync(run), []);
  } finally { await f.library.close(); }
});

test('unknown sync, oversized clips, missing media and tampered prepared data fail before any upload', async () => {
  const f = await capture(); let calls = 0; const options = { apiKey: 'fixture-control-secret', fetcher: (async () => { calls++; throw new Error('No request allowed'); }) as typeof fetch };
  try {
    await assert.rejects(runAnalysisAction(f.library, f.id, { ...prepare, duration_ms: 120001 }, options), /analysis_limit/);
    const ready = await runAnalysisAction(f.library, f.id, prepare, options);
    writeFileSync(join(f.path, 'preparations', ready.preparation_id, 'clip.mp4'), 'corrupt');
    await assert.rejects(runAnalysisAction(f.library, f.id, upload(ready.preparation_id), options));
    f.manifest.synchronization = { status: 'unknown', estimated_error_ms: null, anchor: null, notes: [] }; writeFileSync(join(f.path, 'session.json'), JSON.stringify(f.manifest));
    await assert.rejects(runAnalysisAction(f.library, f.id, prepare, options), /Measure a visible/); assert.equal(calls, 0);
    renameSync(join(f.path, 'recording.avi'), join(f.path, 'preserved-original.avi'));
    await assert.rejects(runAnalysisAction(f.library, f.id, prepare, options), /missing/); assert.equal(calls, 0);
    assert.ok(!existsSync(join(f.path, 'preparations', ready.preparation_id, 'analysis')));
  } finally { await f.library.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { SessionLibrary } from '../src/server/session-library.ts';
import { prepareSession } from '../src/server/media-preparation.ts';
import { analyzeSession, analysisDuration } from '../src/server/session-analysis.ts';
import { ModelError } from '../src/server/muse-api.ts';

const id = '11111111-1111-4111-8111-111111111111';
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const fixtureText = (name: string) => readFileSync(new URL(`../../contracts/fixtures/complete/${name}`, import.meta.url), 'utf8');
const mediaRoot = mkdtempSync(join(tmpdir(), 'postplay-analysis-media-'));
const media = join(mediaRoot, 'fixture.avi');
execFileSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=30', '-t', '2', '-c:v', 'mjpeg', media]);
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'postplay-analysis-')); const directory = join(root, id); mkdirSync(directory);
  const manifest = JSON.parse(fixtureText('session.json')); manifest.capture.width = 64; manifest.capture.height = 48;
  writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest)); writeFileSync(join(directory, 'events.jsonl'), fixtureText('events.jsonl')); writeFileSync(join(directory, 'recording.avi'), readFileSync(media));
  const library = await SessionLibrary.create(root);
  const preparation = await prepareSession(library, id);
  const prepared = join(directory, preparation.relative_directory);
  return { root, directory, library, preparation, prepared };
}
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8'));
const success: typeof fetch = async (url, init) => {
  if (init?.method === 'DELETE') return Response.json({ deleted: true });
  if (String(url).endsWith('/files')) return Response.json({ id: 'file-fixture', expires_at: 123 });
  return Response.json({ status: 'completed', usage: { input_tokens: 10, output_tokens: 3 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ schema_version: '1', coverage_summary: 'Synthetic no-supported-findings fixture', coverage_limitations: [], findings: [] }) }] }] });
};

test('preview has no network or analysis writes; explicit consent stores one proposal and immutable provenance', async () => {
  const f = await fixture(); let calls = 0;
  const fetcher: typeof fetch = async (...args) => { calls++; return await success(...args); };
  const original = ['session.json', 'events.jsonl', 'recording.avi'].map(name => sha(readFileSync(join(f.directory, name))));
  try {
    const preview = await analyzeSession(f.library, id, f.preparation.preparation_id, { fetcher });
    assert.equal(preview.status, 'preview'); assert.equal(preview.remote_upload, false); assert.equal(calls, 0);
    assert.ok(!existsSync(join(f.prepared, 'analysis')));
    assert.equal(preview.video_bytes, statSync(join(f.prepared, 'clip.mp4')).size);
    const result = await analyzeSession(f.library, id, f.preparation.preparation_id, { upload_to_meta: true, apiKey: 'fixture-sensitive-key', fetcher });
    assert.equal(result.status, 'validated_proposal'); assert.equal(calls, 3);
    const run = join(f.prepared, 'analysis');
    const started = readJson(join(run, 'started.json'));
    assert.equal(started.clip_sha256, sha(readFileSync(join(f.prepared, 'clip.mp4'))));
    assert.equal(started.prompt_version, '1'); assert.equal(started.data_use_mode, 'Standard');
    assert.equal(readJson(join(run, 'completed.json')).findings_count, 0);
    assert.equal(readJson(join(run, 'cleanup.json')).status, 'deleted');
    assert.equal(statSync(join(run, 'started.json')).mode & 0o777, 0o600);
    assert.ok(!existsSync(join(run, 'findings.json')));
    await assert.rejects(analyzeSession(f.library, id, f.preparation.preparation_id, { upload_to_meta: true, apiKey: 'fixture', fetcher }), (e: unknown) => e instanceof ModelError && e.code === 'already_started');
    assert.equal(calls, 3);
    assert.deepEqual(['session.json', 'events.jsonl', 'recording.avi'].map(name => sha(readFileSync(join(f.directory, name)))), original);
    for (const file of readdirSync(run)) assert.ok(!readFileSync(join(run, file), 'utf8').includes('fixture-sensitive-key'));
  } finally { await f.library.close(); }
});

test('concurrent consent reserves only one inference; interrupted reservations remain non-retryable', async () => {
  const f = await fixture(); let inference = 0;
  const fetcher: typeof fetch = async (url, init) => { if (String(url).endsWith('/responses')) inference++; return await success(url, init); };
  try {
    const results = await Promise.allSettled([1, 2].map(() => analyzeSession(f.library, id, f.preparation.preparation_id, { upload_to_meta: true, apiKey: 'fixture', fetcher })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(inference, 1);
    const next = await prepareSession(f.library, id); const partial = join(f.directory, next.relative_directory, 'analysis'); mkdirSync(partial);
    await assert.rejects(analyzeSession(f.library, id, next.preparation_id, { upload_to_meta: true, apiKey: 'fixture', fetcher }), /already reserved/);
    assert.deepEqual(readdirSync(partial), []); assert.equal(inference, 1);
  } finally { await f.library.close(); }
});

test('API errors store failure separately, redact echoes and never become a clean report', async () => {
  const f = await fixture();
  try {
    const fetcher: typeof fetch = async (url, init) => String(url).endsWith('/responses') ? Response.json({ error: { message: 'fixture-sensitive-key', code: 'bad_key' } }, { status: 401 }) : await success(url, init);
    await assert.rejects(analyzeSession(f.library, id, f.preparation.preparation_id, { upload_to_meta: true, apiKey: 'fixture-sensitive-key', fetcher }), /401/);
    const run = join(f.prepared, 'analysis');
    assert.equal(readJson(join(run, 'failure.json')).code, 'authentication_failed');
    assert.equal(readJson(join(run, 'cleanup.json')).status, 'deleted');
    assert.ok(!existsSync(join(run, 'api-result.json')) && !existsSync(join(run, 'completed.json')));
    for (const file of readdirSync(run)) assert.ok(!readFileSync(join(run, file), 'utf8').includes('fixture-sensitive-key'));
  } finally { await f.library.close(); }
});

test('response/proposal/usage echoes of the credential are redacted in saved artifacts', async () => {
  const f = await fixture();
  try {
    const fetcher: typeof fetch = async (url, init) => {
      const response = await success(url, init);
      if (!String(url).endsWith('/responses')) return response;
      const data = await response.json();
      data.output[0].content[0].text = data.output[0].content[0].text.replace('Synthetic', 'fixture-sensitive-key');
      data.usage.note = 'fixture-sensitive-key';
      return Response.json(data);
    };
    await analyzeSession(f.library, id, f.preparation.preparation_id, { upload_to_meta: true, apiKey: 'fixture-sensitive-key', fetcher });
    const run = join(f.prepared, 'analysis');
    for (const file of readdirSync(run)) assert.ok(!readFileSync(join(run, file), 'utf8').includes('fixture-sensitive-key'));
    assert.ok(readFileSync(join(run, 'response.json'), 'utf8').includes('[REDACTED]'));
  } finally { await f.library.close(); }
});

test('tampered source, prepared bytes and even rehashed fabricated context fail before upload', async () => {
  for (const change of ['source', 'video', 'context', 'rehashed-context', 'marker', 'symlink'] as const) {
    const f = await fixture(); let calls = 0;
    try {
      if (change === 'source') writeFileSync(join(f.directory, 'events.jsonl'), fixtureText('events.jsonl').replace('Fixture', 'Different'));
      if (change === 'video') writeFileSync(join(f.prepared, 'clip.mp4'), 'bad video');
      if (change === 'context' || change === 'rehashed-context') {
        const context = readJson(join(f.prepared, 'context.json'));
        context.session = { ...(context.session as Record<string, unknown>), recording_notes: ['FABRICATED_EVALUATION_ANSWER'] };
        const data = JSON.stringify(context) + '\n'; writeFileSync(join(f.prepared, 'context.json'), data);
        if (change === 'rehashed-context') {
          const marker = readJson(join(f.prepared, 'preparation.json')); marker.context_sha256 = sha(data); marker.context_bytes = Buffer.byteLength(data);
          writeFileSync(join(f.prepared, 'preparation.json'), JSON.stringify(marker));
        }
      }
      if (change === 'marker') writeFileSync(join(f.prepared, 'preparation.json'), '{}');
      if (change === 'symlink') symlinkSync(mediaRoot, join(f.prepared, 'analysis'));
      await assert.rejects(analyzeSession(f.library, id, f.preparation.preparation_id, { upload_to_meta: true, apiKey: 'fixture', fetcher: async () => { calls++; return Response.json({}); } }));
      assert.equal(calls, 0);
    } finally { await f.library.close(); }
  }
});

test('IDs, key and lowered duration limits fail safely before reserving an upload', async () => {
  const f = await fixture();
  try {
    await assert.rejects(analyzeSession(f.library, id, '../preparation'), /UUID/);
    await assert.rejects(analyzeSession(f.library, id, f.preparation.preparation_id, { max_duration_ms: 1 }), /duration/);
    await assert.rejects(analyzeSession(f.library, id, f.preparation.preparation_id, { upload_to_meta: true, apiKey: '' }), /MODEL_API_KEY/);
    assert.ok(!existsSync(join(f.prepared, 'analysis')));
    assert.equal(analysisDuration({}), 30000); assert.equal(analysisDuration({ POSTPLAY_ANALYSIS_MAX_DURATION_MS: '120000' }), 120000);
    for (const value of ['0', '120001', 'Infinity', '3.5']) assert.throws(() => analysisDuration({ POSTPLAY_ANALYSIS_MAX_DURATION_MS: value }));
    const cli = new URL('../scripts/analyze-session.ts', import.meta.url).pathname;
    const output = spawnSync(process.execPath, [cli, id, f.preparation.preparation_id], { encoding: 'utf8', env: { ...process.env, MODEL_API_KEY: '', POSTPLAY_SESSION_ROOT: f.root }, timeout: 20000 });
    assert.equal(output.status, 0); assert.equal(JSON.parse(output.stdout).status, 'preview');
    assert.ok(!output.stdout.includes(f.root)); assert.ok(!existsSync(join(f.prepared, 'analysis')));
  } finally { await f.library.close(); }
});

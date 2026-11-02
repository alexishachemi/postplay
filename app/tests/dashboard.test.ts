import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, renameSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { SessionLibrary } from '../src/server/session-library.ts';
import { parsePage, sessionPage, sessionSummary, localRequest } from '../src/server/dashboard.ts';
import { prepareSession } from '../src/server/media-preparation.ts';
import { analyzeSession } from '../src/server/session-analysis.ts';
import { createFindingsReport } from '../src/server/report-storage.ts';
import { projectAsset } from '../src/server/project-assets.ts';
import { GET as sessionsEndpoint } from '../src/pages/api/sessions/index.ts';
import { createPlayback, playbackBytes, playbackState, videoResponse } from '../src/server/playback.ts';

const root = mkdtempSync(join(tmpdir(), 'postplay-dashboard-'));
const fixture = (name: string) => readFileSync(new URL(`../../contracts/fixtures/complete/${name}`, import.meta.url), 'utf8');
const media = join(root, 'fixture.avi');
execFileSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=30', '-t', '2', '-c:v', 'mjpeg', media]);
function capture(libraryRoot: string, name = 'Synthetic dashboard fixture') {
  const id = randomUUID(); const directory = join(libraryRoot, id); mkdirSync(directory, { recursive: true });
  const manifest = JSON.parse(fixture('session.json'));
  manifest.session_id = id; manifest.project.name = name; manifest.capture.width = 64; manifest.capture.height = 48;
  writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'events.jsonl'), fixture('events.jsonl').replaceAll('11111111-1111-4111-8111-111111111111', id));
  writeFileSync(join(directory, 'recording.avi'), readFileSync(media));
  return { id, directory, manifest };
}
const mock: typeof fetch = async (url, init) => {
  if (init?.method === 'DELETE') return Response.json({ deleted: true });
  if (String(url).endsWith('/files')) return Response.json({ id: 'file-fixture' });
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ schema_version: '1', coverage_summary: 'Synthetic empty fixture, not real inference', coverage_limitations: [], findings: [] }) }] }] });
};

test('dashboard distinguishes recorded, unfinished, analyzed, failed and corrupt saved states', async () => {
  const dir = mkdtempSync(join(root, 'statuses-')); const f = capture(dir); const library = await SessionLibrary.create(dir);
  try {
    let row = await sessionSummary(library, f.id); assert.equal(row.status, 'recorded'); assert.equal(row.duration_ms, 2000); assert.equal(row.scene, 'main.tscn');
    const prepared = await prepareSession(library, f.id);
    const analysis = join(f.directory, prepared.relative_directory, 'analysis'); mkdirSync(analysis);
    row = await sessionSummary(library, f.id); assert.equal(row.status, 'processing'); assert.match(row.detail, /interrupted/);
    writeFileSync(join(analysis, 'failure.json'), JSON.stringify({ message: 'fixture-sensitive-key and /private/path must not be returned' }));
    row = await sessionSummary(library, f.id); assert.equal(row.status, 'failed'); assert.ok(!row.detail.includes('/private/path'));
    const next = await prepareSession(library, f.id);
    await analyzeSession(library, f.id, next.preparation_id, { upload_to_meta: true, apiKey: 'fixture-sensitive-key', fetcher: mock });
    await createFindingsReport(library, f.id, next.preparation_id);
    row = await sessionSummary(library, f.id); assert.equal(row.status, 'analyzed'); assert.equal(row.report?.status, 'analyzed_no_findings');
    writeFileSync(join(f.directory, next.relative_directory, 'analysis', 'findings.json'), '{}');
    row = await sessionSummary(library, f.id); assert.equal(row.status, 'failed'); assert.equal(row.report, null);
  } finally { await library.close(); }
});

test('incomplete/unfinalized manifests retain useful metadata without pretending capture succeeded', async () => {
  const dir = mkdtempSync(join(root, 'partial-')); const f = capture(dir); const library = await SessionLibrary.create(dir);
  try {
    f.manifest.status = 'recording'; f.manifest.ended_at_utc = null; writeFileSync(join(f.directory, 'session.json'), JSON.stringify(f.manifest));
    assert.equal((await sessionSummary(library, f.id)).status, 'processing');
    f.manifest.status = 'incomplete'; writeFileSync(join(f.directory, 'session.json'), JSON.stringify(f.manifest));
    const row = await sessionSummary(library, f.id); assert.equal(row.status, 'failed'); assert.equal(row.name, f.manifest.project.name); assert.match(row.detail, /incomplete/);
  } finally { await library.close(); }
});

test('empty/paginated libraries, unsafe directories and malformed page/asset paths are bounded', async () => {
  const dir = mkdtempSync(join(root, 'pages-')); const library = await SessionLibrary.create(dir);
  try {
    assert.deepEqual((await sessionPage(library, 1)).sessions, []);
    for (let i = 0; i < 11; i++) capture(dir);
    assert.equal((await sessionPage(library, 1)).sessions.length, 10); assert.equal((await sessionPage(library, 2)).sessions.length, 1);
    await assert.rejects(sessionPage(library, 3));
    const id = randomUUID(); symlinkSync(root, join(dir, id)); assert.equal((await sessionSummary(library, id)).status, 'failed');
    for (const value of ['0', '-1', '1.5', '../', '10000']) assert.throws(() => parsePage(value));
    assert.throws(() => projectAsset('../.env')); assert.throws(() => projectAsset('contracts/../.env'));
  } finally { await library.close(); }
});

test('local origin policy rejects remote Host/origin before endpoint library access', async () => {
  assert.equal(localRequest(new Request('http://127.0.0.1:4321/')), true);
  assert.equal(localRequest(new Request('http://attacker.invalid/')), false);
  assert.equal(localRequest(new Request('http://localhost:4321/', { headers: { origin: 'https://attacker.invalid' } })), false);
  // The environment's HTTP transport refuses Host/authority mismatches. Test
  // the actual endpoint directly with Astro's normalized URL + original Host.
  const request = new Request('http://localhost:4321/api/sessions', { headers: { host: 'attacker.invalid' } });
  const response = await sessionsEndpoint({ request, url: new URL(request.url) } as Parameters<typeof sessionsEndpoint>[0]);
  assert.equal(response.status, 403);
});

test('local preview preserves source bytes, works with unknown sync, reopens and detects corruption', async () => {
  const dir = mkdtempSync(join(root, 'preview-')); const f = capture(dir); const library = await SessionLibrary.create(dir);
  f.manifest.synchronization = { status: 'unknown', estimated_error_ms: null, anchor: null, notes: [] };
  writeFileSync(join(f.directory, 'session.json'), JSON.stringify(f.manifest));
  const original = ['session.json', 'events.jsonl', 'recording.avi'].map(name => readFileSync(join(f.directory, name)));
  try {
    assert.match((await playbackState(library, f.id, null)).message, /Create a local/);
    const metadata = await createPlayback(library, f.id);
    assert.equal(metadata.source_start_ms, 0); assert.equal(metadata.duration_ms, 2000); assert.equal(metadata.kind, 'local preview');
    assert.deepEqual((await playbackState(library, f.id, null)).video, metadata);
    assert.deepEqual(await createPlayback(library, f.id), metadata, 'Reuse valid preview instead of reconverting');
    ['session.json', 'events.jsonl', 'recording.avi'].forEach((name, i) => assert.deepEqual(readFileSync(join(f.directory, name)), original[i]));
    const preview = new URL(metadata.url, 'http://localhost').searchParams.get('preview')!;
    const loaded = await playbackBytes(library, f.id, 'preview', preview); assert.ok(loaded.video.length > 100);
    writeFileSync(join(f.directory, 'playback', preview, 'clip.mp4'), 'corrupt');
    await assert.rejects(playbackBytes(library, f.id, 'preview', preview));
    assert.equal((await playbackState(library, f.id, null)).video, null);
    const retry = await createPlayback(library, f.id); assert.notEqual(retry.url, metadata.url);
    assert.equal(readdirSync(join(f.directory, 'playback')).length, 2, 'Preserve invalid attempt');
    renameSync(join(f.directory, 'recording.avi'), join(f.directory, 'saved-original.avi'));
    assert.match((await playbackState(library, f.id, null)).message, /missing|Restore/);
    await assert.rejects(createPlayback(library, f.id), /missing/);
  } finally { await library.close(); }
});

test('analysis excerpts retain actual source offsets and reject unsafe preview files', async () => {
  const dir = mkdtempSync(join(root, 'excerpt-')); const f = capture(dir); const library = await SessionLibrary.create(dir);
  try {
    const prepared = await prepareSession(library, f.id, { start_ms: 500, duration_ms: 1000 });
    const state = await playbackState(library, f.id, prepared.preparation_id);
    assert.equal(state.video?.kind, 'analysis excerpt'); assert.equal(state.video?.source_start_ms, 500); assert.equal(state.video?.duration_ms, 1000);
    await assert.rejects(playbackBytes(library, f.id, 'preview', '../../.env'));
    const generated = await createPlayback(library, f.id); const preview = new URL(generated.url, 'http://localhost').searchParams.get('preview')!;
    const clip = join(f.directory, 'playback', preview, 'clip.mp4'); renameSync(clip, clip + '.original'); symlinkSync(media, clip);
    await assert.rejects(playbackBytes(library, f.id, 'preview', preview));
    const previewParent = join(f.directory, 'playback'); renameSync(previewParent, previewParent + '.original'); symlinkSync(root, previewParent);
    await assert.rejects(createPlayback(library, f.id), /Symlinks|safely/);
  } finally { await library.close(); }
});

test('preview conversion tool failure is explicit and does not finalize a partial run', async () => {
  const dir = mkdtempSync(join(root, 'tool-error-')); const f = capture(dir); const library = await SessionLibrary.create(dir);
  // Keep FFprobe available but intentionally omit FFmpeg; no external request.
  const bin = mkdtempSync(join(root, 'probe-only-'));
  symlinkSync(execFileSync('sh', ['-c', 'command -v ffprobe'], { encoding: 'utf8' }).trim(), join(bin, 'ffprobe'));
  const previous = process.env.PATH;
  try {
    process.env.PATH = bin;
    await assert.rejects(createPlayback(library, f.id), /FFmpeg/);
    const runs = readdirSync(join(f.directory, 'playback')); assert.equal(runs.length, 1);
    assert.ok(!readdirSync(join(f.directory, 'playback', runs[0]!)).includes('preview.json'));
  } finally { process.env.PATH = previous; await library.close(); }
});

test('preview attempt discovery/creation is bounded and never silently overwrites history', async () => {
  const dir = mkdtempSync(join(root, 'preview-cap-')); const f = capture(dir); const library = await SessionLibrary.create(dir);
  const parent = join(f.directory, 'playback'); mkdirSync(parent);
  for (let i = 0; i < 100; i++) mkdirSync(join(parent, randomUUID()));
  try {
    await assert.rejects(createPlayback(library, f.id), /100 entries/);
    assert.equal(readdirSync(parent).length, 100);
  } finally { await library.close(); }
});

test('byte range responses support seeks, suffixes, HEAD and safe unsatisfiable requests', async () => {
  const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
  const response = (range?: string, method = 'GET', extra = {}) => videoResponse(bytes, new Request('http://localhost/video', { method, headers: { ...(range ? { range } : {}), ...extra } }));
  const all = response(); assert.equal(all.status, 200); assert.equal(all.headers.get('content-type'), 'video/mp4'); assert.equal(all.headers.get('content-length'), '100');
  const range = response('bytes=10-19'); assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 10-19/100'); assert.deepEqual(new Uint8Array(await range.arrayBuffer()), bytes.slice(10, 20));
  assert.equal((await response('bytes=90-').arrayBuffer()).byteLength, 10);
  assert.equal((await response('bytes=-5').arrayBuffer()).byteLength, 5);
  assert.equal((await response('bytes=90-999').arrayBuffer()).byteLength, 10);
  for (const bad of ['bytes=100-', 'bytes=10-9', 'bytes=-0', 'bytes=-', 'bytes=1-2,4-5', 'items=0-1', 'bytes=99999999999999999-']) {
    const invalid = response(bad); assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */100');
  }
  const head = response(undefined, 'HEAD'); assert.equal((await head.arrayBuffer()).byteLength, 0); assert.equal(head.headers.get('content-length'), '100');
  assert.equal(response('bytes=10-19', 'GET', { 'if-range': 'unknown-validator' }).status, 200);
});

// Test the actual bundled Node server: a source-only unit check cannot catch
// resource URLs that change depth when Astro emits server/chunks modules.
const app = new URL('../', import.meta.url).pathname;
execFileSync('npm', ['run', 'build'], { cwd: app, stdio: 'pipe', timeout: 30000 });
async function withServer(libraryRoot: string, use: (base: string) => Promise<void>, credential = 'fixture-sensitive-key') {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); assert.ok(address && typeof address !== 'string'); const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, [join(app, 'dist/server/entry.mjs')], { cwd: tmpdir(), stdio: 'ignore', env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MODEL_API_KEY: credential, POSTPLAY_SESSION_ROOT: libraryRoot } });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await fetch(base); ready = true; break; } catch { await pause(50); }
    }
    assert.ok(ready, 'Bundled server should start'); await use(base);
  } finally { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } }
}
test('production HTTP renders escaped/selectable sessions, metadata APIs and safe empty/error states from any CWD', async () => {
  const dir = mkdtempSync(join(root, 'http-')); const name = '<script>globalThis.pwned=1</script>'; const f = capture(dir, name);
  await withServer(dir, async base => {
    const page = await fetch(base); assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
    const html = await page.text(); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes(name)); assert.ok(html.includes('2.0 s'));
    assert.ok(!html.includes('fixture-sensitive-key') && !html.includes(dir));
    const list = await fetch(base + '/api/sessions'); assert.equal(list.status, 200);
    const data = await list.json(); assert.equal(data.sessions[0].id, f.id); assert.ok(!JSON.stringify(data).includes('fixture-sensitive-key') && !JSON.stringify(data).includes(dir));
    const selected = await fetch(base + '/?session=' + f.id); assert.match(await selected.text(), /SESSION DURATION/);
    assert.equal((await fetch(base + '/api/sessions/' + f.id)).status, 200);
    assert.equal((await fetch(base + '/api/sessions/' + randomUUID())).status, 404);
    assert.equal((await fetch(base + '/api/sessions/not-a-uuid')).status, 400);
    assert.equal((await fetch(base + '/?session=../../.env')).status, 400);
    assert.equal((await fetch(base + '/api/sessions?page=0')).status, 400);
    assert.equal((await fetch(base + '/api/sessions?page=2')).status, 400);
    assert.equal((await fetch(base + '/api/sessions', { headers: { origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await fetch(base + '/api/sessions', { headers: { origin: base } })).status, 200);
    assert.equal((await fetch(base + '/api/sessions', { method: 'POST' })).status, 404);
    const endpoint = base + '/api/sessions/' + f.id;
    assert.equal((await fetch(endpoint + '/preview', { method: 'POST' })).status, 403);
    assert.equal((await fetch(endpoint + '/preview', { method: 'POST', headers: { origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await fetch(endpoint + '/preview', { method: 'POST', headers: { origin: base, 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' } })).status, 415);
    const attempts = await Promise.all([1, 2].map(() => fetch(endpoint + '/preview', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' } })));
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409], 'Duplicate clicks must not start parallel conversions');
    const created = attempts.find(r => r.status === 200)!;
    const result = await created.json(); assert.equal(result.remote_upload, false);
    const selectedVideo = await fetch(base + '/?session=' + f.id); const videoHtml = await selectedVideo.text();
    assert.match(videoHtml, /data-video/); assert.match(videoHtml, /Synchronization warning/); assert.match(videoHtml, /video-local seconds/);
    const video = await fetch(base + result.video.url); assert.equal(video.status, 200); const bytes = new Uint8Array(await video.arrayBuffer());
    const range = await fetch(base + result.video.url, { headers: { range: 'bytes=10-29' } }); assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 10-29/${bytes.length}`); assert.deepEqual(new Uint8Array(await range.arrayBuffer()), bytes.slice(10, 30));
    assert.equal((await fetch(base + result.video.url, { method: 'HEAD' })).headers.get('content-length'), String(bytes.length));
    assert.equal((await fetch(base + result.video.url, { headers: { range: 'bytes=99999999-' } })).status, 416);
    assert.equal((await fetch(base + result.video.url, { headers: { origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await fetch(endpoint + '/video?preview=../../.env')).status, 400);
    assert.equal((await fetch(base + result.video.url + '&preparation=' + randomUUID())).status, 400);
    assert.equal((await fetch(endpoint + '/video?preview=' + randomUUID())).status, 404);
    assert.equal((await fetch(base + '/api/sessions/' + randomUUID() + '/preview', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' } })).status, 422);
    renameSync(join(f.directory, 'recording.avi'), join(f.directory, 'original-preserved.avi'));
    assert.equal((await fetch(base + result.video.url)).status, 404);
    assert.match(await (await fetch(base + '/?session=' + f.id)).text(), /Restore missing original media/);
  });
  const empty = mkdtempSync(join(root, 'empty-'));
  await withServer(empty, async base => { const r = await fetch(base); assert.equal(r.status, 200); assert.match(await r.text(), /No sessions yet/); });
  await withServer(join(root, 'fixture.avi'), async base => { const r = await fetch(base); assert.equal(r.status, 503); assert.match(await r.text(), /Session library unavailable/); });
});

test('production analysis API requires exact consent, origin, bounded JSON and server credentials', async () => {
  const dir = mkdtempSync(join(root, 'analysis-http-')), f = capture(dir);
  await withServer(dir, async base => {
    const endpoint = base + '/api/sessions/' + f.id + '/analysis';
    const post = (body: unknown, origin = base) => fetch(endpoint, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const prepare = { action: 'prepare', start_ms: 0, duration_ms: 2000, reviewed_previous_attempt: false };
    assert.equal((await post(prepare, 'https://attacker.invalid')).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prepare) })).status, 403);
    assert.equal((await post({ ...prepare, unexpected: true })).status, 400);
    assert.equal((await post({ padding: 'x'.repeat(1025) })).status, 413);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await fetch(endpoint + '?preparation=../../.env')).status, 400);
    assert.equal((await fetch(endpoint + '?apiKey=secret')).status, 400);
    const initial = await (await fetch(endpoint)).json(); assert.equal(initial.phase, 'unprepared'); assert.equal(initial.credentials_configured, false);
    const ready = await post(prepare); assert.equal(ready.status, 200); const data = await ready.json(); assert.equal(data.remote_upload, false);
    const view = await (await fetch(endpoint)).json(); assert.equal(view.phase, 'ready'); assert.ok(view.preparation.video_bytes > 0);
    const html = await (await fetch(base + '/?session=' + f.id)).text(); assert.match(html, /I consent to uploading/); assert.match(html, /Prepared upload/); assert.match(html, /not configured on this server/);
    assert.ok(!html.includes(dir));
    assert.equal((await post({ action: 'analyze', preparation_id: data.preparation_id, upload_to_meta: false })).status, 400);
    const denied = await post({ action: 'analyze', preparation_id: data.preparation_id, upload_to_meta: true }); assert.equal(denied.status, 422); assert.equal((await denied.json()).error.code, 'credentials_missing');
    assert.ok(!readdirSync(join(f.directory, 'preparations', data.preparation_id)).includes('analysis'));
    const library = await SessionLibrary.create(dir);
    try {
      await assert.rejects(analyzeSession(library, f.id, data.preparation_id, { upload_to_meta: true, apiKey: 'fixture-sensitive-key', fetcher: async () => Response.json({ error: { code: 'bad_key', message: 'fixture-sensitive-key /private/provider/body' } }, { status: 401 }) }));
    } finally { await library.close(); }
    const failed = await (await fetch(endpoint)).json(); assert.equal(failed.phase, 'failed'); assert.equal(failed.code, 'authentication_failed');
    const failureHtml = await (await fetch(base + '/?session=' + f.id)).text(); assert.match(failureHtml, /Meta rejected the server credential/); assert.match(failureHtml, /already reserved an attempt/);
    assert.ok(!failureHtml.includes('fixture-sensitive-key') && !failureHtml.includes('/private/provider/body'));
  }, '');
});

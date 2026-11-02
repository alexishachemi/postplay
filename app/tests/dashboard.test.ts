import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
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

// Test the actual bundled Node server: a source-only unit check cannot catch
// resource URLs that change depth when Astro emits server/chunks modules.
const app = new URL('../', import.meta.url).pathname;
execFileSync('npm', ['run', 'build'], { cwd: app, stdio: 'pipe', timeout: 30000 });
async function withServer(libraryRoot: string, use: (base: string) => Promise<void>) {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); assert.ok(address && typeof address !== 'string'); const port = address.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, [join(app, 'dist/server/entry.mjs')], { cwd: tmpdir(), stdio: 'ignore', env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MODEL_API_KEY: 'fixture-sensitive-key', POSTPLAY_SESSION_ROOT: libraryRoot } });
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
  });
  const empty = mkdtempSync(join(root, 'empty-'));
  await withServer(empty, async base => { const r = await fetch(base); assert.equal(r.status, 200); assert.match(await r.text(), /No sessions yet/); });
  await withServer(join(root, 'fixture.avi'), async base => { const r = await fetch(base); assert.equal(r.status, 503); assert.match(await r.text(), /Session library unavailable/); });
});

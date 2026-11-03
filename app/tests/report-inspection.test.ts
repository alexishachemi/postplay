import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SessionLibrary } from '../src/server/session-library.ts';
import { inspectReport } from '../src/server/report-inspection.ts';
import { evidenceSeekMs } from '../src/lib/evidence-time.ts';
import { createInspectionFixture } from './fixtures/inspection-session.ts';

const root = mkdtempSync(join(tmpdir(), 'postplay-inspection-'));
const fixture = await createInspectionFixture(root);
const run = join(fixture.directory, 'preparations', fixture.preparation_id, 'analysis');
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('offline inspection retains genuine snapshot values, independent severity/certainty and quarantine', async () => {
  const before = readdirSync(run).map(name => [name, digest(join(run, name))]);
  const library = await SessionLibrary.create(root);
  try {
    const view = await inspectReport(library, fixture.id, fixture.preparation_id); assert.equal(view.status, 'ready');
    if (view.status !== 'ready') throw new Error('Expected validated fixture');
    assert.equal(view.report.findings.length, 2); assert.equal(view.report.quarantined.length, 1);
    const claim = view.report.findings[0]!.model_claim; assert.equal(claim.severity, 'high'); assert.equal(claim.certainty, 'medium'); assert.match(claim.observed_behavior, /x=999/);
    const snapshot = view.report.evidence_snapshots.find(s => s.event.id === 'evt-2')!;
    assert.deepEqual(snapshot.event.payload, { type: 'Vector2', x: 160, y: 330 }); assert.equal(snapshot.clip_ms, 0); assert.equal(view.report.timing.source_start_ms, 500);
    assert.equal(snapshot.event.time.wall_elapsed_ms, 1000); assert.equal(snapshot.event.time.simulation_ms, 500); assert.equal(snapshot.event.time.process_frame, 15);
    assert.equal(view.report.quarantined[0]!.model_claim.certainty, 'high'); assert.ok(view.report.quarantined[0]!.issues.includes('suspected_softlock_only'));
    assert.match(view.video_url, new RegExp(`^/api/sessions/${fixture.id}/video\\?preparation=${fixture.preparation_id}$`));
    assert.deepEqual(readdirSync(run).map(name => [name, digest(join(run, name))]), before);
  } finally { await library.close(); }
});

test('clip seeks never add source offset, clamp invalid inputs, or silently treat the end boundary as a frame', () => {
  assert.equal(evidenceSeekMs(300, 1200), 300); assert.equal(evidenceSeekMs(0, 1200), 0); assert.equal(evidenceSeekMs(1200, 1200), 1199);
  for (const time of [-1, 1201, NaN, Infinity]) assert.equal(evidenceSeekMs(time, 1200), null);
  for (const duration of [0, -1, NaN, Infinity]) assert.equal(evidenceSeekMs(0, duration), null);
});

test('missing/tampered/symlink reports are errors, never empty success or repair writes', async () => {
  const library = await SessionLibrary.create(root);
  const file = join(run, 'findings.json'), bytes = readFileSync(file);
  try {
    assert.equal((await inspectReport(library, fixture.id, null)).status, 'unavailable');
    assert.equal((await inspectReport(library, fixture.id, '../../.env')).status, 'invalid');
    writeFileSync(file, '{}'); assert.equal((await inspectReport(library, fixture.id, fixture.preparation_id)).status, 'invalid'); assert.equal(readFileSync(file, 'utf8'), '{}');
    renameSync(file, file + '.saved'); symlinkSync(file + '.saved', file);
    assert.equal((await inspectReport(library, fixture.id, fixture.preparation_id)).status, 'invalid');
    renameSync(file, file + '.symlink'); writeFileSync(file, bytes);
    renameSync(file, file + '.missing'); assert.equal((await inspectReport(library, fixture.id, fixture.preparation_id)).status, 'invalid');
    renameSync(file + '.missing', file);
  } finally { await library.close(); }
});

test('currently loaded credential cannot be rendered from an older report or snapshot', async () => {
  const library = await SessionLibrary.create(root), original = process.env.MODEL_API_KEY;
  try {
    process.env.MODEL_API_KEY = 'UNVERIFIED MODEL CLAIM';
    assert.equal((await inspectReport(library, fixture.id, fixture.preparation_id)).status, 'invalid');
  } finally { if (original === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = original; await library.close(); }
});

test('fixture CLI creates a unique synthetic library even when its output parent does not exist', () => {
  const cli = new URL('../scripts/inspection-fixture.ts', import.meta.url).pathname;
  const result = JSON.parse(execFileSync(process.execPath, [cli, join(root, 'new-parent', 'fixture')], { encoding: 'utf8', env: { ...process.env, MODEL_API_KEY: '' } }));
  assert.equal(result.remote_calls, 0); assert.match(result.kind, /SYNTHETIC/);
  assert.equal(readdirSync(join(result.session_root, result.session_id, 'preparations', result.preparation_id, 'analysis')).length, 12);
  assert.notEqual(result.session_root, root);
});

test('fixture CLI rejects unknown outcome names before creating output directories', () => {
  const before = readdirSync(root);
  const cli = new URL('../scripts/inspection-fixture.ts', import.meta.url).pathname;
  assert.throws(() => execFileSync(process.execPath, [cli, join(root, 'must-not-exist', 'fixture'), 'not-an-outcome'], { stdio: 'pipe' }), /Unknown synthetic fixture outcome/);
  assert.deepEqual(readdirSync(root), before);
});

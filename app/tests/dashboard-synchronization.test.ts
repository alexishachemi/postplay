import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSynchronizationFixture } from './fixtures/synchronization-session.ts';
import { SessionLibrary } from '../src/server/session-library.ts';
import { createPlayback } from '../src/server/playback.ts';
import { prepareSession } from '../src/server/media-preparation.ts';
import { runSynchronizationAction, synchronizationView, parseSynchronizationAction } from '../src/server/dashboard-synchronization.ts';
import { withSessionOperation, runAnalysisAction } from '../src/server/dashboard-analysis.ts';
import { GET, POST } from '../src/pages/api/sessions/[id]/synchronization.ts';

async function capture() {
  const root = mkdtempSync(join(tmpdir(), 'postplay-sync-ui-'));
  const f = createSynchronizationFixture(root), library = await SessionLibrary.create(root);
  const preview = await createPlayback(library, f.id);
  const preview_id = new URL(preview.url, 'http://localhost').searchParams.get('preview')!;
  const action = { action: 'preview', preview_id, review: null, observations: [
    { event_id: 'evt-3', video_ms: 500, uncertainty_ms: 100 }, { event_id: 'evt-4', video_ms: 1500, uncertainty_ms: 100 },
  ] };
  return { ...f, root, library, action };
}
test('browser measurement preview is read-only; apply backs up, preserves originals and permits real local preparation', async () => {
  const f = await capture();
  try {
    const before = readFileSync(join(f.path, 'session.json')), log = readFileSync(join(f.path, 'events.jsonl')), video = readFileSync(join(f.path, 'recording.avi'));
    const view = await synchronizationView(f.library, f.id);
    assert.deepEqual(view.events.map(event => event.id), ['evt-3', 'evt-4']);
    assert.match(view.events[0]!.label, /<img/);
    const preview = await runSynchronizationAction(f.library, f.id, f.action);
    assert.equal(preview.applied, false); assert.equal(preview.measurement.synchronization.status, 'verified');
    assert.ok(preview.measurement.synchronization.estimated_error_ms! >= 234);
    assert.deepEqual(readFileSync(join(f.path, 'session.json')), before);
    assert.equal(readdirSync(f.path).some(name => name.startsWith('synchronization-')), false);
    const saved = await runSynchronizationAction(f.library, f.id, { ...f.action, action: 'apply', review: preview.review });
    assert.equal(saved.applied, true);
    assert.deepEqual(readFileSync(join(f.path, saved.backup_directory!, 'session.before.json')), before);
    const report = JSON.parse(readFileSync(join(f.path, saved.backup_directory!, 'measurement.json'), 'utf8'));
    assert.equal(report.observations.length, 2); assert.equal(report.video_sha256.length, 64);
    assert.deepEqual(readFileSync(join(f.path, 'events.jsonl')), log); assert.deepEqual(readFileSync(join(f.path, 'recording.avi')), video);
    assert.equal((await f.library.manifest(f.id)).synchronization.status, 'verified');
    await assert.rejects(runSynchronizationAction(f.library, f.id, { ...f.action, action: 'apply', review: preview.review }));
    assert.ok((await prepareSession(f.library, f.id, { duration_ms: 2000 })).preparation_id);
  } finally { await f.library.close(); }
});

test('changed observations, missing review, duplicate events, bounds and lifecycle anchors cannot save alignment', async () => {
  const f = await capture();
  try {
    const preview = await runSynchronizationAction(f.library, f.id, f.action);
    for (const action of [
      { ...f.action, action: 'apply', review: null },
      { ...f.action, action: ['apply'], review: preview.review },
      { ...f.action, action: 'apply', review: '0'.repeat(64) },
      { ...f.action, action: 'apply', review: preview.review, observations: f.action.observations.map(item => ({ ...item, video_ms: item.video_ms + 1 })) },
      { ...f.action, observations: [f.action.observations[0], f.action.observations[0]] },
      { ...f.action, observations: [{ ...f.action.observations[0], event_id: 'evt-1' }, f.action.observations[1]] },
      { ...f.action, observations: [{ ...f.action.observations[0], video_ms: 2000 }, f.action.observations[1]] },
      { ...f.action, observations: [{ ...f.action.observations[0], uncertainty_ms: -1 }, f.action.observations[1]] },
      { ...f.action, preview_id: '../recording.avi' }, { ...f.action, path: '/private/file' },
    ]) await assert.rejects(runSynchronizationAction(f.library, f.id, action));
    assert.equal((await f.library.manifest(f.id)).synchronization.status, 'unknown');
    assert.equal(readdirSync(f.path).some(name => name.startsWith('synchronization-')), false);
  } finally { await f.library.close(); }
});

test('large uncertainty stays approximate; short span is rejected instead of marked verified', async () => {
  const f = await capture();
  try {
    const observations = f.action.observations.map(item => ({ ...item, uncertainty_ms: 500 }));
    const preview = await runSynchronizationAction(f.library, f.id, { ...f.action, observations });
    assert.equal(preview.measurement.synchronization.status, 'approximate');
    await runSynchronizationAction(f.library, f.id, { ...f.action, observations, action: 'apply', review: preview.review });
    assert.equal((await f.library.manifest(f.id)).synchronization.status, 'approximate');
  } finally { await f.library.close(); }
  const short = await capture();
  try {
    await assert.rejects(runSynchronizationAction(short.library, short.id, { ...short.action, observations: [short.action.observations[0], { ...short.action.observations[1], video_ms: 600 }] }), /one second apart/);
  } finally { await short.library.close(); }
});

test('stale sources, preview tampering, unsafe files and preparation history are refused', async () => {
  for (const mode of ['manifest', 'preview', 'symlink', 'preparation']) {
    const f = await capture();
    try {
      const preview = await runSynchronizationAction(f.library, f.id, f.action);
      if (mode === 'manifest') { f.manifest.project.name += ' changed'; writeFileSync(join(f.path, 'session.json'), JSON.stringify(f.manifest)); }
      if (mode === 'preview') writeFileSync(join(f.path, 'playback', f.action.preview_id, 'clip.mp4'), 'tampered');
      if (mode === 'symlink') { mkdirSync(join(f.path, 'preparations')); symlinkSync('/tmp', join(f.path, 'preparations', randomUUID())); }
      if (mode === 'preparation') { mkdirSync(join(f.path, 'preparations')); mkdirSync(join(f.path, 'preparations', randomUUID())); }
      await assert.rejects(runSynchronizationAction(f.library, f.id, { ...f.action, action: 'apply', review: preview.review }));
      assert.equal((await f.library.manifest(f.id)).synchronization.status, 'unknown');
    } finally { await f.library.close(); }
  }
});

test('calibration and preparation share the same in-process session guard', async () => {
  const f = await capture();
  try {
    await withSessionOperation(f.id, async () => {
      await assert.rejects(runSynchronizationAction(f.library, f.id, f.action), /busy/);
      await assert.rejects(runAnalysisAction(f.library, f.id, { action: 'prepare', start_ms: 0, duration_ms: 2000, reviewed_previous_attempt: false }), /busy/);
    });
    assert.equal((await runSynchronizationAction(f.library, f.id, f.action)).applied, false);
  } finally { await f.library.close(); }
});

test('UUID-only synchronization API enforces local origin, JSON, streamed body limit and safe diagnostics', async () => {
  const id = randomUUID(), url = new URL(`http://localhost/api/sessions/${id}/synchronization`);
  const context = (request: Request) => ({ request, params: { id }, url }) as unknown as Parameters<typeof POST>[0];
  for (const [headers, expected] of [
    [{ origin: 'https://attacker.invalid', 'content-type': 'application/json' }, 403],
    [{ 'content-type': 'application/json' }, 403], [{ origin: url.origin, 'content-type': 'text/plain' }, 415],
  ] as const) assert.equal((await POST(context(new Request(url, { method: 'POST', headers, body: '{}' })))).status, expected);
  const headers = { origin: url.origin, 'content-type': 'application/json' };
  assert.equal((await POST(context(new Request(url, { method: 'POST', headers, body: 'x'.repeat(8193) })))).status, 413);
  assert.equal((await POST(context(new Request(url, { method: 'POST', headers, body: '{' })))).status, 400);
  assert.equal((await GET({ ...context(new Request(url)), params: { id: '../.env' } })).status, 400);
  assert.throws(() => parseSynchronizationAction({}));
});

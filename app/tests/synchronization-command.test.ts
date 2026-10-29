import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMeasurement } from '../scripts/measure-synchronization.ts';
import { validateSessionPackage } from '../src/server/session-contract.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'postplay-sync-'));
  const manifest = JSON.parse(readFileSync(new URL('../../contracts/fixtures/complete/session.json', import.meta.url), 'utf8'));
  manifest.synchronization = { status: 'unknown', anchor: null, estimated_error_ms: null, notes: [] };
  writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'events.jsonl'), readFileSync(new URL('../../contracts/fixtures/complete/events.jsonl', import.meta.url)));
  // Deliberately NOT media: this command measures supplied observations and hashes files;
  // media decode/finalization is tested separately, never claimed by this fixture.
  writeFileSync(join(directory, 'recording.avi'), 'not media: synchronization command fixture');
  const observationFile = join(directory, 'observations.json');
  writeFileSync(observationFile, JSON.stringify([{ event_id: 'evt-1', video_ms: 0, uncertainty_ms: 1 }, { event_id: 'evt-3', video_ms: 1000, uncertainty_ms: 1 }]));
  return { directory, observationFile };
}

test('measurement defaults to read-only; explicit apply preserves original and records provenance', async () => {
  const { directory, observationFile } = fixture();
  const before = readFileSync(join(directory, 'session.json'), 'utf8');
  const media = readFileSync(join(directory, 'recording.avi'));
  const log = readFileSync(join(directory, 'events.jsonl'), 'utf8');
  const preview = await runMeasurement(directory, observationFile, 'process_frame');
  assert.equal(preview.applied, false);
  assert.equal(preview.report.video_sha256.length, 64);
  assert.equal(readFileSync(join(directory, 'session.json'), 'utf8'), before);
  assert.equal(readdirSync(directory).length, 4);
  const result = await runMeasurement(directory, observationFile, 'process_frame', true);
  assert.equal(result.applied, true);
  assert.equal(readFileSync(join(directory, result.backup_directory!, 'session.before.json'), 'utf8'), before);
  const updated = validateSessionPackage(JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8')), log);
  assert.equal(updated.session.synchronization.status, 'verified');
  assert.deepEqual(readFileSync(join(directory, 'recording.avi')), media);
  assert.equal(readFileSync(join(directory, 'events.jsonl'), 'utf8'), log);
  const applied = readFileSync(join(directory, 'session.json'), 'utf8');
  await assert.rejects(runMeasurement(directory, observationFile, 'process_frame', true), /existing measurement/);
  assert.equal(readFileSync(join(directory, 'session.json'), 'utf8'), applied);
});

test('missing/oversized observations, unsafe media symlinks and malformed packages do not change manifests', async () => {
  for (const mode of ['missing', 'oversized', 'symlink', 'malformed'] as const) {
    const { directory, observationFile } = fixture();
    if (mode === 'oversized') writeFileSync(observationFile, ' '.repeat(32_769));
    if (mode === 'malformed') writeFileSync(join(directory, 'events.jsonl'), '{broken');
    if (mode === 'symlink') {
      const manifest = JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8'));
      symlinkSync(join(directory, 'recording.avi'), join(directory, 'linked.avi'));
      manifest.capture.video_path = 'linked.avi';
      writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest));
    }
    const before = readFileSync(join(directory, 'session.json'), 'utf8');
    await assert.rejects(runMeasurement(directory, mode === 'missing' ? join(directory, 'missing.json') : observationFile, 'process_frame', true));
    assert.equal(readFileSync(join(directory, 'session.json'), 'utf8'), before);
  }
});

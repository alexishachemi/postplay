import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, linkSync, renameSync, truncateSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SessionLibrary, sessionRoot, type Inspection } from '../src/server/session-library.ts';
import { CONTRACT_LIMITS } from '../src/server/session-contract.ts';

const id = '11111111-1111-4111-8111-111111111111';
const source = (name: string) => readFileSync(new URL(`../../contracts/fixtures/complete/${name}`, import.meta.url), 'utf8');
// Tiny generated media fixtures, NOT recordings of gameplay or model evaluation.
const mediaRoot = mkdtempSync(join(tmpdir(), 'postplay-ingestion-media-'));
const video = join(mediaRoot, 'fixture.avi');
execFileSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=30', '-t', '2', '-c:v', 'mjpeg', video]);
const bytes = readFileSync(video);

test('seekable descriptor probing supports MP4 with trailing metadata and OGV originals', async () => {
  for (const format of ['mp4', 'ogv']) {
    const f = fixture();
    const output = join(f.directory, `recording.${format}`);
    execFileSync('ffmpeg', ['-v', 'error', '-n', '-i', video, '-an', '-c:v', format === 'mp4' ? 'libx264' : 'libtheora', '-pix_fmt', 'yuv420p', output]);
    f.manifest.capture.format = format; f.manifest.capture.video_path = `recording.${format}`;
    if (format === 'mp4') {
      f.manifest.capture.mode = 'external';
      f.manifest.synchronization = { status: 'unknown', anchor: null, estimated_error_ms: null, notes: [] };
    }
    f.save();
    const result = await inspect(f.root);
    assert.equal(result.ok, true, `${format}: ${JSON.stringify(result)}`);
    if (format === 'ogv' && result.ok) {
      assert.equal(result.media.average_fps, null);
      assert.ok(result.diagnostics.some(message => message.includes('Average video frame rate unavailable')));
    }
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'postplay-ingestion-'));
  const directory = join(root, id);
  mkdirSync(directory);
  const manifest = JSON.parse(source('session.json'));
  manifest.capture.width = 64; manifest.capture.height = 48;
  writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'events.jsonl'), source('events.jsonl'));
  writeFileSync(join(directory, 'recording.avi'), bytes);
  return { root, directory, manifest, save: () => writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest)) };
}
async function inspect(root: string, sessionId: unknown = id): Promise<Inspection> {
  const library = await SessionLibrary.create(root);
  try { return await library.inspect(sessionId); } finally { await library.close(); }
}
function error(result: Inspection, code: string) {
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.error.code, code); assert.ok(result.error.message.length > 10); }
}

test('local storage configuration is absolute, XDG-compatible and independent of CWD/Nix store', async () => {
  assert.equal(sessionRoot({}, '/tmp/example-home'), '/tmp/example-home/.local/share/postplay/sessions');
  assert.equal(sessionRoot({ XDG_DATA_HOME: '/tmp/example-data' }), '/tmp/example-data/postplay/sessions');
  assert.equal(sessionRoot({ POSTPLAY_SESSION_ROOT: '/tmp/explicit' }), '/tmp/explicit');
  assert.equal(sessionRoot({ POSTPLAY_SESSION_ROOT: '/tmp/explicit', XDG_DATA_HOME: 'unused-relative' }), '/tmp/explicit');
  for (const root of ['', 'relative', '/nix/store', '/nix/store/not-writable']) assert.throws(() => sessionRoot({ POSTPLAY_SESSION_ROOT: root }));
  const parent = mkdtempSync(join(tmpdir(), 'postplay-storage-'));
  const library = await SessionLibrary.create(join(parent, 'new', 'sessions'));
  assert.deepEqual(await library.discover(), { ids: [], ignored_entries: 0 });
  await library.close();
  writeFileSync(join(parent, 'file'), 'fixture');
  await assert.rejects(SessionLibrary.create(join(parent, 'file')));
});

test('valid package discovers/loads/probes without mutating originals; unknown sync is not invented', async () => {
  const f = fixture();
  mkdirSync(join(f.root, 'unrelated'));
  writeFileSync(join(f.root, '.env'), 'not a real credential fixture');
  const before = readdirSync(f.directory).map(name => [name, readFileSync(join(f.directory, name))] as const);
  const library = await SessionLibrary.create(f.root);
  try {
    assert.deepEqual(await library.discover(), { ids: [id], ignored_entries: 2 });
    const result = await library.inspect(id);
    assert.equal(result.ok, true);
    if (result.ok) { assert.equal(result.events.length, 3); assert.deepEqual(result.media, { duration_ms: 2000, width: 64, height: 48, fps: 30, average_fps: 30, bytes: bytes.length }); }
    for (const [name, content] of before) assert.deepEqual(readFileSync(join(f.directory, name)), content);
    f.manifest.synchronization = { status: 'unknown', anchor: null, estimated_error_ms: null, notes: [] }; f.save();
    const unknown = await library.inspect(id);
    assert.equal(unknown.ok, true);
    if (unknown.ok) assert.ok(unknown.diagnostics.some(message => message.includes('unknown')));
    // Restore the intentionally changed fixture manifest; ingestion itself never writes it.
    writeFileSync(join(f.directory, 'session.json'), before.find(([name]) => name === 'session.json')![1]);
    for (const [name, content] of before) assert.deepEqual(readFileSync(join(f.directory, name)), content);
  } finally { await library.close(); }
});

test('arbitrary paths, URLs, encoded traversal and invalid IDs are rejected before file access', async () => {
  const { root } = fixture();
  for (const input of ['../session', '/etc/passwd', id + '/..', '%2e%2e', 'file:///etc/passwd', 'http://localhost', '-i', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', null]) error(await inspect(root, input), 'invalid_id');
  error(await inspect(root, '22222222-2222-4222-8222-222222222222'), 'not_found');
});

test('manifest/schema/identity/path/anchor failures remain explicit and do not become clean', async () => {
  for (const mode of ['json', 'utf8', 'version', 'identity', 'traversal', 'absolute', 'url', 'anchor']) {
    const f = fixture();
    if (mode === 'version') f.manifest.schema_version = '2';
    if (mode === 'identity') f.manifest.session_id = '22222222-2222-4222-8222-222222222222';
    if (mode === 'traversal') f.manifest.capture.video_path = '../recording.avi';
    if (mode === 'absolute') f.manifest.capture.video_path = '/tmp/recording.avi';
    if (mode === 'url') f.manifest.capture.video_path = 'https://localhost/recording.avi';
    if (mode === 'anchor') f.manifest.synchronization.anchor.event_id = 'evt-999';
    f.save();
    if (mode === 'json') writeFileSync(join(f.directory, 'session.json'), '{bad');
    if (mode === 'utf8') writeFileSync(join(f.directory, 'session.json'), Buffer.from([0xff]));
    error(await inspect(f.root), mode === 'version' ? 'unsupported_schema' : mode === 'anchor' ? 'invalid_events' : 'invalid_manifest');
  }
});

test('missing, oversized and corrupt files are diagnosed without repairing original data', async () => {
  for (const mode of ['manifest', 'events', 'media', 'big-manifest', 'big-log', 'tail']) {
    const f = fixture();
    const target = join(f.directory, mode === 'manifest' ? 'session.json' : mode === 'events' ? 'events.jsonl' : 'recording.avi');
    if (['manifest', 'events', 'media'].includes(mode)) renameSync(target, target + '.preserved');
    if (mode === 'big-manifest') truncateSync(join(f.directory, 'session.json'), CONTRACT_LIMITS.manifestBytes + 1);
    if (mode === 'big-log') truncateSync(join(f.directory, 'events.jsonl'), CONTRACT_LIMITS.logBytes + 1);
    if (mode === 'tail') writeFileSync(join(f.directory, 'events.jsonl'), source('events.jsonl') + '{truncated');
    error(await inspect(f.root), mode === 'media' ? 'missing_media' : mode.startsWith('big') ? 'size_limit' : mode === 'tail' ? 'invalid_events' : 'not_found');
    if (mode === 'tail') assert.ok(readFileSync(join(f.directory, 'events.jsonl'), 'utf8').endsWith('{truncated'));
  }
});

test('partial captures never pass because a video happens to exist; damaged tails remain invalid', async () => {
  for (const status of ['recording', 'incomplete']) {
    const f = fixture(); f.manifest.status = status; f.manifest.ended_at_utc = null; f.save();
    error(await inspect(f.root), 'partial_capture');
    writeFileSync(join(f.directory, 'events.jsonl'), source('events.jsonl') + '{damaged');
    error(await inspect(f.root), 'invalid_events');
  }
});

test('session/file/intermediate symlinks, hardlinks and special files cannot escape the library', async () => {
  for (const mode of ['directory', 'manifest', 'log', 'video', 'intermediate', 'hardlink', 'fifo']) {
    const f = fixture();
    if (mode === 'directory') { renameSync(f.directory, f.directory + '-outside'); symlinkSync(f.directory + '-outside', f.directory); }
    else if (mode === 'intermediate') {
      symlinkSync(mediaRoot, join(f.directory, 'nested'));
      f.manifest.capture.video_path = 'nested/fixture.avi'; f.save();
    } else {
      const name = mode === 'manifest' ? 'session.json' : mode === 'log' ? 'events.jsonl' : 'recording.avi';
      const path = join(f.directory, name); renameSync(path, path + '.preserved');
      if (mode === 'hardlink') linkSync(path + '.preserved', path);
      else if (mode === 'fifo') execFileSync('mkfifo', [path]);
      else symlinkSync(path + '.preserved', path);
    }
    error(await inspect(f.root), 'unsafe_file');
  }
});

test('nested regular video paths work; open root stays pinned if its pathname is replaced', async () => {
  const f = fixture(); mkdirSync(join(f.directory, 'media'));
  renameSync(join(f.directory, 'recording.avi'), join(f.directory, 'media', 'recording.avi'));
  f.manifest.capture.video_path = 'media/recording.avi'; f.save();
  const library = await SessionLibrary.create(f.root);
  try {
    renameSync(f.root, f.root + '-original'); mkdirSync(f.root);
    writeFileSync(join(f.root, 'replacement'), 'not a package');
    assert.equal((await library.inspect(id)).ok, true);
    assert.deepEqual((await library.discover()).ids, [id]);
  } finally { await library.close(); }
});

test('bad media, disguised playlists and inconsistent metadata remain inspection failures', async () => {
  for (const mode of ['empty', 'bad', 'playlist', 'width', 'fps', 'duration']) {
    const f = fixture();
    if (mode === 'empty') truncateSync(join(f.directory, 'recording.avi'), 0);
    if (mode === 'bad') writeFileSync(join(f.directory, 'recording.avi'), 'not video: fixture');
    if (mode === 'playlist') writeFileSync(join(f.directory, 'recording.avi'), 'ffconcat version 1.0\nfile http://127.0.0.1:9/not-allowed\n');
    if (mode === 'width') f.manifest.capture.width = 65;
    if (mode === 'fps') f.manifest.capture.fps = 25;
    if (mode === 'duration') f.manifest.capture.duration_ms = 3000;
    f.save();
    const result = await inspect(f.root);
    error(result, ['width', 'fps', 'duration'].includes(mode) ? 'media_mismatch' : 'probe_failed');
    assert.ok(!JSON.stringify(result).includes(f.root));
  }
});

test('local CLI lists/inspects the configured library and exits nonzero for invalid sessions', () => {
  const f = fixture(); const env = { ...process.env, POSTPLAY_SESSION_ROOT: f.root };
  const script = new URL('../scripts/sessions.ts', import.meta.url);
  const run = (...args: string[]) => spawnSync(process.execPath, [script.pathname, ...args], { env, encoding: 'utf8', timeout: 20_000 });
  const list = run('list'); assert.equal(list.status, 0); assert.deepEqual(JSON.parse(list.stdout).ids, [id]);
  const valid = run('inspect', id); assert.equal(valid.status, 0); assert.equal(JSON.parse(valid.stdout).event_count, 3);
  const invalid = run('inspect', '../escape'); assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stdout).error.code, 'invalid_id');
  assert.ok(!valid.stdout.includes(f.root)); assert.ok(!valid.stdout.includes('payload'));
  const missingProbe = spawnSync(process.execPath, [script.pathname, 'inspect', id], { env: { ...env, PATH: '/nonexistent-postplay-fixture' }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(missingProbe.status, 1); assert.equal(JSON.parse(missingProbe.stdout).error.code, 'probe_failed');
});

test('discovery limit is explicit, never a silently truncated library', async () => {
  const root = mkdtempSync(join(tmpdir(), 'postplay-discovery-limit-'));
  for (let index = 0; index < 1001; index++) writeFileSync(join(root, `ignored-${index}`), '');
  const library = await SessionLibrary.create(root);
  try { await assert.rejects(library.discover(), /1,000/); } finally { await library.close(); }
});

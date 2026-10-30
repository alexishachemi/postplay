import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { SessionLibrary } from '../src/server/session-library.ts';
import { validateSessionPackage, type Session } from '../src/server/session-contract.ts';
import { validateContext } from '../src/server/analysis-validation.ts';
import { normalizeContext, PREPARATION_LIMITS, PreparationError } from '../src/server/preparation-context.ts';
import { prepareSession } from '../src/server/media-preparation.ts';

const id = '11111111-1111-4111-8111-111111111111';
const fixtureText = (file: string) => readFileSync(new URL(`../../contracts/fixtures/complete/${file}`, import.meta.url), 'utf8');
const raw = () => validateSessionPackage(JSON.parse(fixtureText('session.json')), fixtureText('events.jsonl'));
const timing = { source_start_ms: 0, duration_ms: 2000, conversion_error_ms: 1 };
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

test('normalization preserves safe values, original IDs/expectations/order without project/path/answer metadata', () => {
  const { session, events } = raw();
  session.project.name = 'SECRET_EVALUATION_MODE';
  session.synchronization.notes = ['SECRET_EVALUATION_ANSWER'];
  session.capture.video_path = 'SECRET_EVALUATION_FILENAME.avi';
  const before = JSON.stringify({ session, events });
  const context = normalizeContext(session, events, timing);
  assert.deepEqual(context.events.map(event => [event.id, event.t_ms]), [['evt-2', 500], ['evt-3', 1000]]);
  context.events.forEach(item => {
    const original = events.find(event => event.id === item.id)!;
    assert.deepEqual(item.payload, { label: original.label, value: original.payload });
    assert.equal(item.registration_id, original.registration_id);
  });
  assert.equal(context.registrations[0]!.expected_behavior, session.registrations[0]!.expected_behavior);
  assert.equal(context.coverage.total_events, 3); assert.equal(context.coverage.included_events, 2);
  assert.ok(context.coverage.omissions.some(note => note.includes('lifecycle')));
  assert.ok(!JSON.stringify(context).includes('SECRET_EVALUATION'));
  assert.equal(JSON.stringify({ session, events }), before);
  assert.deepEqual(validateContext(context), context);
});

test('actual trim offsets, missing clock, approximation and truncated coverage remain explicit', () => {
  const { session, events } = raw();
  session.telemetry.truncated = true;
  const context = normalizeContext(session, events, { ...timing, source_start_ms: 700, duration_ms: 600 });
  assert.deepEqual(context.events.map(event => [event.id, event.t_ms]), [['evt-3', 300]]);
  assert.ok(context.coverage.omissions.some(note => note.includes('outside')));
  assert.ok(context.coverage.omissions.some(note => note.includes('truncated')));
  events[1]!.time.process_frame = null;
  const missing = normalizeContext(session, events, timing);
  assert.deepEqual(missing.events.map(event => event.id), ['evt-3']);
  assert.ok(missing.coverage.omissions.some(note => note.includes('lack')));
  session.synchronization.status = 'verified'; session.synchronization.estimated_error_ms = 499;
  const uncertain = normalizeContext(session, events, { ...timing, conversion_error_ms: 2 });
  assert.equal(uncertain.session.synchronization.status, 'approximate');
  assert.equal(uncertain.session.synchronization.estimated_error_ms, 502);
});

test('unmeasured/empty/oversized context and invalid budgets stop rather than guessing or sampling', () => {
  const { session, events } = raw();
  for (const limits of [{ events: 1, context_bytes: 96000 }, { events: 2000, context_bytes: 100 }, { events: 2001, context_bytes: 96000 }]) {
    assert.throws(() => normalizeContext(session, events, timing, limits), PreparationError);
  }
  assert.throws(() => normalizeContext(session, events, { ...timing, duration_ms: 0 }), /Invalid measured/);
  assert.throws(() => normalizeContext(session, events, { ...timing, duration_ms: 120001 }), /Invalid measured/);
  assert.throws(() => normalizeContext(session, events, { ...timing, source_start_ms: 2001 }), /Invalid measured/);
  assert.throws(() => normalizeContext(session, events, { ...timing, conversion_error_ms: Number.MAX_SAFE_INTEGER }), /safe numeric range/);
  assert.throws(() => normalizeContext(session, events, { ...timing, duration_ms: 400 }), /no alignable/);
  session.synchronization = { status: 'unknown', anchor: null, estimated_error_ms: null, notes: [] };
  assert.throws(() => normalizeContext(session, events, timing), /synchronization anchor/);
});

// Actual encoded fixture media, not a human recording or model performance evidence.
const mediaRoot = mkdtempSync(join(tmpdir(), 'postplay-preparation-media-'));
const sourceVideo = join(mediaRoot, 'fixture.avi');
execFileSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=30', '-t', '2', '-c:v', 'mjpeg', sourceVideo]);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'postplay-preparation-'));
  const directory = join(root, id); mkdirSync(directory);
  const manifest: Session = JSON.parse(fixtureText('session.json'));
  manifest.capture.width = 64; manifest.capture.height = 48;
  writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'events.jsonl'), fixtureText('events.jsonl'));
  writeFileSync(join(directory, 'recording.avi'), readFileSync(sourceVideo));
  return { root, directory, manifest };
}
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

test('actual H.264 preparation decodes, measures off-frame trim, preserves evidence and original hashes', async () => {
  const f = fixture(); const library = await SessionLibrary.create(f.root);
  const originals = ['session.json', 'events.jsonl', 'recording.avi'].map(name => ({ name, sha: hash(readFileSync(join(f.directory, name))) }));
  try {
    const result = await prepareSession(library, id, { start_ms: 723, duration_ms: 900 });
    const directory = join(f.directory, result.relative_directory);
    assert.ok(Math.abs(result.report.source_start_ms - 733.3333333) < 0.001);
    assert.ok(result.report.maximum_timestamp_residual_ms <= 1);
    const context = validateContext(readJson(join(directory, 'context.json')));
    assert.deepEqual(context.events.map(event => event.id), ['evt-3']);
    assert.equal(context.events[0]!.t_ms, 266);
    const original = raw().events.find(event => event.id === context.events[0]!.id)!;
    assert.deepEqual(context.events[0]!.payload.value, original.payload);
    assert.equal(hash(readFileSync(join(directory, 'context.json'))), result.report.context_sha256);
    assert.equal(hash(readFileSync(join(directory, 'clip.mp4'))), result.report.clip_sha256);
    assert.equal(result.report.source_manifest_sha256, originals[0]!.sha);
    assert.equal(result.report.source_events_sha256, originals[1]!.sha);
    assert.equal(result.report.source_video_sha256, originals[2]!.sha);
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', join(directory, 'clip.mp4'), '-f', 'null', '-']);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height', '-of', 'json', join(directory, 'clip.mp4')], { encoding: 'utf8' }));
    assert.equal(probe.streams[0].codec_name, 'h264'); assert.equal(probe.streams[0].pix_fmt, 'yuv420p');
    assert.equal(probe.streams[0].width, 64); assert.equal(probe.streams[0].height, 48);
    for (const item of originals) assert.equal(hash(readFileSync(join(f.directory, item.name))), item.sha);
    assert.ok(existsSync(join(directory, 'preparation.json')) && !existsSync(join(directory, 'failure.json')));
  } finally { await library.close(); }
});

test('repeated preparations are exclusive and deterministic in the pinned environment', async () => {
  const f = fixture(); const library = await SessionLibrary.create(f.root);
  try {
    const first = await prepareSession(library, id);
    const second = await prepareSession(library, id);
    assert.notEqual(first.preparation_id, second.preparation_id);
    assert.equal(first.report.clip_sha256, second.report.clip_sha256);
    assert.equal(first.report.context_sha256, second.report.context_sha256);
    assert.equal(readdirSync(join(f.directory, 'preparations')).length, 2);
  } finally { await library.close(); }
});

test('OGV and existing MP4 inputs use the same safe measured conversion path', async () => {
  for (const format of ['ogv', 'mp4'] as const) {
    const f = fixture();
    execFileSync('ffmpeg', ['-v', 'error', '-n', '-i', sourceVideo, '-c:v', format === 'ogv' ? 'libtheora' : 'libx264', '-pix_fmt', 'yuv420p', join(f.directory, `original.${format}`)]);
    f.manifest.capture.format = format; f.manifest.capture.video_path = `original.${format}`;
    if (format === 'mp4') {
      f.manifest.capture.mode = 'external';
      f.manifest.synchronization.anchor = { event_id: 'evt-3', clock: 'simulation_ms', recorded_value: 1000, video_ms: 1000 };
    }
    writeFileSync(join(f.directory, 'session.json'), JSON.stringify(f.manifest));
    const library = await SessionLibrary.create(f.root);
    try { const prepared = await prepareSession(library, id); assert.ok(prepared.report.decoded_frames > 0); }
    finally { await library.close(); }
  }
});

test('duration/context/empty-clip limits fail before job creation, not silently truncated', async () => {
  const f = fixture(); const library = await SessionLibrary.create(f.root);
  try {
    for (const options of [{ duration_ms: 120001 }, { start_ms: -1 }, { start_ms: 1700, duration_ms: 1000 }, { context_bytes: 100 }, { events: 1 }, { duration_ms: 400 }, { video_bytes: PREPARATION_LIMITS.video_bytes + 1 }]) {
      await assert.rejects(prepareSession(library, id, options), PreparationError);
      assert.ok(!existsSync(join(f.directory, 'preparations')));
    }
  } finally { await library.close(); }
});

test('video cap leaves a failed diagnostic artifact, never a completed prepared input', async () => {
  const f = fixture(); const library = await SessionLibrary.create(f.root);
  try {
    await assert.rejects(prepareSession(library, id, { video_bytes: 100 }), PreparationError);
    const entries = readdirSync(join(f.directory, 'preparations'));
    assert.equal(entries.length, 1);
    assert.ok(existsSync(join(f.directory, 'preparations', entries[0]!, 'failure.json')));
    assert.ok(!existsSync(join(f.directory, 'preparations', entries[0]!, 'preparation.json')));
  } finally { await library.close(); }
});

test('output symlinks cannot redirect preparation outside the pinned session', async () => {
  const f = fixture(); symlinkSync(mediaRoot, join(f.directory, 'preparations'));
  const library = await SessionLibrary.create(f.root);
  try { await assert.rejects(prepareSession(library, id)); assert.deepEqual(readdirSync(mediaRoot), ['fixture.avi']); }
  finally { await library.close(); }
});

test('borrowed source callback detects source metadata changes and closes resources', async () => {
  const f = fixture(); const library = await SessionLibrary.create(f.root);
  try {
    await assert.rejects(library.withSource(id, async source => {
      writeFileSync(join(f.directory, 'session.json'), '{}');
      await source.assertUnchanged();
    }), /metadata changed/);
    assert.equal((await library.inspect(id)).ok, false);
  } finally { await library.close(); }
});

test('CLI errors and unavailable FFmpeg never claim a prepared session or expose host paths', () => {
  const f = fixture();
  const script = new URL('../scripts/prepare-session.ts', import.meta.url);
  const env = { ...process.env, POSTPLAY_SESSION_ROOT: f.root };
  const invalid = spawnSync(process.execPath, [script.pathname, id, '0', '120001'], { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stdout).error.code, 'clip_limit');
  assert.ok(!invalid.stdout.includes(f.root));
  const bin = join(f.root, 'probe-only-bin'); mkdirSync(bin);
  const probePath = process.env.PATH!.split(':').map(path => join(path, 'ffprobe')).find(path => existsSync(path));
  assert.ok(probePath); symlinkSync(probePath, join(bin, 'ffprobe'));
  const missing = spawnSync(process.execPath, [script.pathname, id], { env: { ...env, PATH: bin }, encoding: 'utf8', timeout: 20000 });
  assert.equal(missing.status, 1); assert.equal(JSON.parse(missing.stdout).error.code, 'conversion_failed');
  assert.ok(!missing.stdout.includes(f.root));
  const jobs = readdirSync(join(f.directory, 'preparations'));
  assert.ok(jobs.every(job => existsSync(join(f.directory, 'preparations', job, 'failure.json')) && !existsSync(join(f.directory, 'preparations', job, 'preparation.json'))));
});

test('nonzero container origins are rejected instead of silently shifting source evidence', async () => {
  const f = fixture();
  execFileSync('ffmpeg', ['-v', 'error', '-n', '-i', sourceVideo, '-vf', 'setpts=PTS+5/TB', '-c:v', 'libx264', '-fps_mode', 'passthrough', join(f.directory, 'offset.mp4')]);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(f.directory, 'offset.mp4')], { encoding: 'utf8' }));
  f.manifest.capture.mode = 'external'; f.manifest.capture.format = 'mp4'; f.manifest.capture.video_path = 'offset.mp4';
  f.manifest.capture.duration_ms = Math.round(Number(probe.format.duration) * 1000);
  f.manifest.synchronization.anchor = { event_id: 'evt-3', clock: 'simulation_ms', recorded_value: 1000, video_ms: 1000 };
  writeFileSync(join(f.directory, 'session.json'), JSON.stringify(f.manifest));
  const library = await SessionLibrary.create(f.root);
  try { await assert.rejects(prepareSession(library, id), /encoded time zero/); } finally { await library.close(); }
});

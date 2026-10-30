import { constants } from 'node:fs';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { SessionLibrary, openPackageChild, probeVideo } from './session-library.ts';
import { normalizeContext, PREPARATION_LIMITS, requirePreparation, PreparationError } from './preparation-context.ts';

export interface PreparationOptions { start_ms?: number; duration_ms?: number; video_bytes?: number; context_bytes?: number; events?: number }
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

async function hashFile(file: FileHandle, maximum: number): Promise<string> {
  const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  let position = 0;
  for (;;) {
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    position += bytesRead;
    requirePreparation(position <= maximum, 'media_limit', 'Media exceeds the preparation byte limit.');
    hash.update(buffer.subarray(0, bytesRead));
  }
  return hash.digest('hex');
}
async function save(directory: FileHandle, name: string, data: unknown, compact = false): Promise<void> {
  const file = await open(`/proc/self/fd/${directory.fd}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(data, null, compact ? undefined : 2) + '\n'); await file.sync(); } finally { await file.close(); }
}
async function createRun(directory: FileHandle): Promise<{ id: string; directory: FileHandle }> {
  try { await mkdir(`/proc/self/fd/${directory.fd}/preparations`, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const parent = await openPackageChild(directory, 'preparations', true);
  try {
    const id = randomUUID();
    await mkdir(`/proc/self/fd/${parent.fd}/${id}`, { mode: 0o700 });
    return { id, directory: await openPackageChild(parent, id, true) };
  } finally { await parent.close(); }
}
async function ffmpeg(file: FileHandle, args: string[], output?: FileHandle): Promise<string> {
  // Reopen the pinned inode with an independent cursor (prior probes may seek).
  const input = await open(`/proc/self/fd/${file.fd}`, constants.O_RDONLY);
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, { shell: false, stdio: [input.fd, 'pipe', 'pipe', ...(output ? [output.fd] : [])],
        env: { PATH: process.env.PATH, LANG: 'C', AV_LOG_FORCE_NOCOLOR: '1' } });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 180_000); timeout.unref();
      const chunks: Buffer[] = [];
      let bytes = 0, exceeded = false;
      const collect = (chunk: Buffer, stderr: boolean) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 ** 2) { exceeded = true; child.kill('SIGKILL'); }
        else if (stderr) chunks.push(chunk);
      };
      child.stdout!.on('data', chunk => collect(chunk, false)); child.stderr!.on('data', chunk => collect(chunk, true));
      const failure = () => new PreparationError('conversion_failed', 'FFmpeg conversion/verification failed or exceeded its resource budget. Check the tools and source media; partial outputs are not ready for analysis.');
      child.on('error', () => { clearTimeout(timeout); reject(failure()); });
      child.on('close', code => { clearTimeout(timeout); if (code !== 0 || exceeded) reject(failure()); else resolve(Buffer.concat(chunks).toString('utf8')); });
    });
  } finally { await input.close(); }
}
/** showinfo is collected after source PTS rebasing/trim but before output rebasing.
 * Integer PTS + rational time_base avoid guessing from requested -ss or rounded text. */
function timestamps(allLogs: string, filter = 0): number[] {
  const log = allLogs.split('\n').filter(line => line.includes(`[Parsed_showinfo_${filter} @`)).join('\n');
  const base = /config in time_base:\s*(\d+)\/(\d+)/.exec(log);
  requirePreparation(base && Number(base[1]) > 0 && Number(base[2]) > 0, 'timing_failed', 'Could not measure encoded frame timing.');
  const points = [...log.matchAll(/\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:/g)];
  requirePreparation(points.length > 0 && points.length <= 30000, 'timing_failed', 'Missing or excessive decoded frame timestamps.');
  const times = points.map((point, index) => {
    requirePreparation(Number(point[1]) === index, 'timing_failed', 'Decoded frame sequence is incomplete.');
    return Number(point[2]) * Number(base[1]) * 1000 / Number(base[2]);
  });
  requirePreparation(times.every((time, index) => Number.isFinite(time) && time >= 0 && (index === 0 || time > times[index - 1]!)), 'timing_failed', 'Decoded frame timestamps are not strictly ordered.');
  return times;
}
const inputArgs = (format: 'avi' | 'ogv' | 'mp4') => ['-v', 'info', '-xerror', '-copyts', '-protocol_whitelist', 'fd', '-format_whitelist', { avi: 'avi', ogv: 'ogg', mp4: 'mov' }[format],
  '-f', { avi: 'avi', ogv: 'ogg', mp4: 'mov' }[format], '-fd', '0', '-i', 'fd:'];

export async function prepareSession(library: SessionLibrary, id: string, options: PreparationOptions = {}) {
  return await library.withSource(id, async source => {
    const { session, events, media } = source.inspection;
    const start = options.start_ms ?? 0, duration = options.duration_ms ?? media.duration_ms - start;
    const videoLimit = options.video_bytes ?? PREPARATION_LIMITS.video_bytes;
    const contextLimits = { context_bytes: options.context_bytes ?? PREPARATION_LIMITS.context_bytes, events: options.events ?? PREPARATION_LIMITS.events };
    requirePreparation(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(duration) && duration > 0 && duration <= PREPARATION_LIMITS.duration_ms && start + duration <= media.duration_ms,
      'clip_limit', 'Choose a positive clip within the source video, at most 120 seconds; no automatic truncation is performed.');
    requirePreparation(Number.isSafeInteger(videoLimit) && videoLimit > 0 && videoLimit <= PREPARATION_LIMITS.video_bytes, 'invalid_limits', 'Video byte limits may only lower the fixed safety cap.');
    requirePreparation(media.bytes <= PREPARATION_LIMITS.source_bytes, 'media_limit', 'Source media exceeds the 1 GiB preparation limit.');
    // Early validation before allocating a job, then repeat against measured output timing.
    normalizeContext(session, events, { source_start_ms: start, duration_ms: duration, conversion_error_ms: 0 }, contextLimits);
    const videoHash = await hashFile(source.video, PREPARATION_LIMITS.source_bytes);
    const run = await createRun(source.directory);
    try {
      await save(run.directory, 'started.json', { preparation_version: '1', status: 'preparing', session_id: id, requested_start_ms: start, requested_duration_ms: duration });
      const filter = `showinfo,setpts=PTS-STARTPTS,trim=start=${start / 1000}:end=${(start + duration) / 1000},showinfo,setpts=PTS-STARTPTS,scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,format=yuv420p`;
      const args = [...inputArgs(session.capture.format), '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', filter,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-color_range', 'tv', '-threads', '1', '-fps_mode', 'passthrough', '-map_metadata', '-1', '-map_chapters', '-1',
        '-t', String(duration / 1000), '-movflags', '+faststart', '-fs', String(videoLimit + 1), '-f', 'mp4', '-n', '/proc/self/fd/3/clip.mp4'];
      const log = await ffmpeg(source.video, args, run.directory);
      const origin = timestamps(log)[0]!;
      requirePreparation(Math.abs(origin) <= 0.000001, 'timing_failed', 'Source video does not start at encoded time zero; an explicit container-origin mapping is required before this preparation path is safe.');
      const originalTimes = timestamps(log, 3);
      const clip = await openPackageChild(run.directory, 'clip.mp4');
      try {
        const videoBytes = (await clip.stat()).size;
        requirePreparation(videoBytes > 0 && videoBytes <= videoLimit, 'media_limit', 'Prepared MP4 exceeds the byte budget; use a shorter clip.');
        const decoded = timestamps(await ffmpeg(clip, [...inputArgs('mp4'), '-map', '0:v:0', '-an', '-vf', 'showinfo', '-f', 'null', '-']));
        requirePreparation(decoded.length === originalTimes.length, 'timing_failed', 'Conversion lost or duplicated decoded frames.');
        const offset = originalTimes[0]!;
        const timingError = Math.max(...decoded.map((time, index) => Math.abs(time - (originalTimes[index]! - offset))));
        requirePreparation(timingError <= 1 && Math.abs(decoded[0]!) <= 1, 'timing_failed', 'Converted timestamps do not preserve the measured source-video mapping.');
        const info = await probeVideo(clip, 'mp4');
        const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
        requirePreparation(record(info) && Array.isArray(info.streams) && record(info.streams[0]) && record(info.format), 'conversion_failed', 'Prepared video metadata is invalid.');
        const stream = info.streams[0];
        requirePreparation(stream.codec_name === 'h264' && stream.pix_fmt === 'yuv420p' && typeof stream.width === 'number' && stream.width > 0 && stream.width <= 960
          && typeof stream.height === 'number' && stream.height > 0 && stream.height <= 540 && typeof info.format.duration === 'string', 'conversion_failed', 'Prepared video is not a supported bounded H.264/yuv420p MP4.');
        const clipDuration = Math.round(Number(info.format.duration) * 1000);
        requirePreparation(Number.isSafeInteger(clipDuration) && clipDuration > 0 && clipDuration <= PREPARATION_LIMITS.duration_ms && Math.abs(clipDuration - duration) <= 1000 / media.fps + 2,
          'timing_failed', 'Prepared video duration does not match the selected clip.');
        const conversionError = Math.ceil(timingError) + 1;
        const context = normalizeContext(session, events, { source_start_ms: offset, duration_ms: clipDuration, conversion_error_ms: conversionError }, contextLimits);
        const contextJson = JSON.stringify(context) + '\n';
        await source.assertUnchanged();
        requirePreparation(await hashFile(source.video, PREPARATION_LIMITS.source_bytes) === videoHash, 'source_changed', 'Original media changed during preparation; preserve it and retry after capture stops.');
        await save(run.directory, 'context.json', context, true);
        const report = { preparation_version: '1', status: 'prepared', session_id: id, preparation_id: run.id,
          source_manifest_sha256: source.manifest_sha256, source_events_sha256: source.events_sha256, source_video_sha256: videoHash,
          clip_sha256: await hashFile(clip, videoLimit), context_sha256: sha(contextJson), context_hash_encoding: 'file bytes: compact JSON.stringify + LF, UTF-8',
          source_start_ms: offset, source_first_decoded_pts_ms: origin, requested_start_ms: start, requested_duration_ms: duration, clip_duration_ms: clipDuration,
          conversion_error_ms: conversionError, maximum_timestamp_residual_ms: timingError, decoded_frames: decoded.length,
          video_path: 'clip.mp4', context_path: 'context.json', video_bytes: videoBytes, context_bytes: Buffer.byteLength(contextJson),
          ffmpeg_version: /^ffmpeg version (\S+)/m.exec(log)?.[1] ?? 'pinned environment (banner suppressed)',
          conversion: { encoder: 'libx264', pixel_format: 'yuv420p', color_range: 'tv', crf: 23, preset: 'veryfast', threads: 1, audio: 'omitted', maximum_size: [960, 540], pts: 'first decoded source frame rebased to zero; trim; subtract measured first retained PTS' },
          coverage: context.coverage, limits: { ...PREPARATION_LIMITS, ...contextLimits, video_bytes: videoLimit } };
        await save(run.directory, 'preparation.json', report); // Completion marker written last.
        return { preparation_id: run.id, relative_directory: `preparations/${run.id}`, report };
      } finally { await clip.close(); }
    } catch (error) {
      const failure = error instanceof PreparationError ? { code: error.code, message: error.message } : { code: 'preparation_failed', message: 'Preparation failed; inspect tools/source validation and retain partial artifacts. No upload occurred.' };
      await save(run.directory, 'failure.json', { status: 'failed', ...failure });
      throw new PreparationError(failure.code, failure.message);
    } finally { await run.directory.close(); }
  });
}

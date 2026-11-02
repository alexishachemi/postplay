import { constants } from 'node:fs';
import { mkdir, open, opendir, type FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { SessionLibrary, openPackageChild, probeVideo, type SessionSource } from './session-library.ts';
import { withPreparedSession, readPackageBytes } from './session-analysis.ts';
import { ffmpeg, hashFile, inputArgs, timestamps } from './media-preparation.ts';
import { PREPARATION_LIMITS, requirePreparation } from './preparation-context.ts';
import { validSessionId, PRIVATE_HEADERS } from './dashboard.ts';

export interface Playback {
  url: string; kind: 'analysis excerpt' | 'local preview'; duration_ms: number; source_start_ms: number;
  conversion_error_ms: number;
}
export interface PlaybackState { video: Playback | null; message: string }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const base = (id: string) => `/api/sessions/${id}/video`;
const durationLimit = PREPARATION_LIMITS.duration_ms;

async function childRun(directory: FileHandle, parentName: string, id: string) {
  if (!validSessionId(id)) throw new Error('Invalid preview UUID');
  const parent = await openPackageChild(directory, parentName, true);
  try { return await openPackageChild(parent, id, true); } finally { await parent.close(); }
}
async function latestPreview(library: SessionLibrary, id: string): Promise<string | null> {
  return await library.withDirectory(id, async directory => {
    let parent: FileHandle;
    try { parent = await openPackageChild(directory, 'playback', true); }
    catch (error) { if ((error as { code?: string }).code === 'not_found') return null; throw error; }
    try {
      const candidates: { id: string; modified: number }[] = []; let count = 0;
      for await (const entry of await opendir(`/proc/self/fd/${parent.fd}`)) {
        if (++count > 100) throw new Error('Preview discovery limit');
        if (!validSessionId(entry.name)) continue;
        const child = await openPackageChild(parent, entry.name, true);
        try { candidates.push({ id: entry.name, modified: (await child.stat()).mtimeMs }); } finally { await child.close(); }
      }
      return candidates.sort((a, b) => b.modified - a.modified || a.id.localeCompare(b.id))[0]?.id ?? null;
    } finally { await parent.close(); }
  });
}

async function previewBytes(source: SessionSource, id: string, preview: string) {
  const run = await childRun(source.directory, 'playback', preview);
  try {
    const value: unknown = JSON.parse((await readPackageBytes(run, 'preview.json', 8192)).toString('utf8'));
    const m = value as Record<string, unknown> | null;
    requirePreparation(m && typeof m === 'object' && !Array.isArray(m) && m.preview_version === '1' && m.session_id === id && m.preview_id === preview
      && m.source_manifest_sha256 === source.manifest_sha256 && m.source_events_sha256 === source.events_sha256 && m.video_path === 'clip.mp4'
      && m.source_start_ms === 0 && Number.isSafeInteger(m.duration_ms) && (m.duration_ms as number) > 0 && (m.duration_ms as number) <= durationLimit
      && Math.abs((m.duration_ms as number) - source.inspection.media.duration_ms) <= 1000 / source.inspection.media.fps + 2
      && Number.isSafeInteger(m.conversion_error_ms) && (m.conversion_error_ms as number) >= 0 && (m.conversion_error_ms as number) <= 2,
      'invalid_preview', 'Preview metadata no longer matches this recording.');
    const video = await readPackageBytes(run, 'clip.mp4', PREPARATION_LIMITS.video_bytes);
    requirePreparation(m.video_bytes === video.length && m.clip_sha256 === hash(video)
      && m.source_video_sha256 === await hashFile(source.video, PREPARATION_LIMITS.source_bytes), 'invalid_preview', 'Preview/source bytes changed.');
    const clip = await openPackageChild(run, 'clip.mp4');
    try {
      const info = await probeVideo(clip, 'mp4') as { streams?: { codec_name?: string; pix_fmt?: string; width?: number; height?: number }[]; format?: { duration?: string } };
      const stream = info?.streams?.[0];
      requirePreparation(stream?.codec_name === 'h264' && stream.pix_fmt === 'yuv420p' && typeof stream.width === 'number' && stream.width > 0 && stream.width <= 960
        && typeof stream.height === 'number' && stream.height > 0 && stream.height <= 540 && Math.abs(Number(info.format?.duration) * 1000 - (m.duration_ms as number)) <= 1,
        'invalid_preview', 'Preview is not a supported MP4.');
    } finally { await clip.close(); }
    await source.assertUnchanged();
    return { video, metadata: { url: `${base(id)}?preview=${preview}`, kind: 'local preview', duration_ms: m.duration_ms as number,
      source_start_ms: 0, conversion_error_ms: m.conversion_error_ms as number } satisfies Playback };
  } finally { await run.close(); }
}

/** Read-only, bounded byte snapshots; safe even when the original pathname is replaced. */
export async function playbackBytes(library: SessionLibrary, id: string, kind: 'preparation' | 'preview', token: string) {
  if (!validSessionId(id) || !validSessionId(token)) throw new Error('Invalid UUID');
  if (kind === 'preparation') return await withPreparedSession(library, id, token, durationLimit, async (_source, _prepared, input) => ({
    video: input.video, metadata: { url: `${base(id)}?preparation=${token}`, kind: 'analysis excerpt', duration_ms: input.manifest.clip_duration_ms,
      source_start_ms: input.manifest.source_start_ms, conversion_error_ms: input.manifest.conversion_error_ms } satisfies Playback,
  }));
  return await library.withSource(id, async source => await previewBytes(source, id, token));
}
export async function playbackState(library: SessionLibrary, id: string, preparation: string | null): Promise<PlaybackState> {
  if (preparation) {
    try { return { video: (await playbackBytes(library, id, 'preparation', preparation)).metadata, message: '' }; } catch { /* Analysis failure need not prevent local playback. */ }
  }
  try {
    const preview = await latestPreview(library, id);
    if (preview) return { video: (await playbackBytes(library, id, 'preview', preview)).metadata, message: '' };
    const inspection = await library.inspect(id);
    if (!inspection.ok) return { video: null, message: inspection.error.message };
    return { video: null, message: 'Create a local MP4 preview to play this recording. No video or telemetry is uploaded.' };
  } catch { return { video: null, message: 'Saved preview is missing, unfinished or invalid. Restore missing original media, check FFmpeg/FFprobe, then retry local preview creation. Existing artifacts are preserved.' }; }
}

/** Explicit, local-only conversion. A failed/aborted run never receives a completion marker. */
export async function createPlayback(library: SessionLibrary, id: string): Promise<Playback> {
  const previous = await latestPreview(library, id);
  if (previous) {
    try { return (await playbackBytes(library, id, 'preview', previous)).metadata; }
    catch { /* Preserve invalid attempts; a deliberate retry gets a new UUID. */ }
  }
  return await library.withSource(id, async source => {
    const { session, media } = source.inspection;
    requirePreparation(media.duration_ms <= durationLimit && media.bytes <= PREPARATION_LIMITS.source_bytes, 'preview_limit', 'Local previews support recordings up to 120 seconds and 1 GiB. Preserve the original; use an explicitly prepared excerpt for longer recordings.');
    const sourceHash = await hashFile(source.video, PREPARATION_LIMITS.source_bytes);
    try { await mkdir(`/proc/self/fd/${source.directory.fd}/playback`, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const parent = await openPackageChild(source.directory, 'playback', true);
    const preview = randomUUID(); let run: FileHandle;
    try {
      let count = 0;
      for await (const _entry of await opendir(`/proc/self/fd/${parent.fd}`)) {
        requirePreparation(++count < 100, 'preview_limit', 'Preview history reached 100 entries. Preserve/archive old local preview attempts outside this package before retrying.');
      }
      await mkdir(`/proc/self/fd/${parent.fd}/${preview}`, { mode: 0o700 }); run = await openPackageChild(parent, preview, true);
    }
    finally { await parent.close(); }
    try {
      const filter = "showinfo,setpts=PTS-STARTPTS,scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=tv,format=yuv420p";
      const log = await ffmpeg(source.video, [...inputArgs(session.capture.format), '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', filter,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-color_range', 'tv', '-threads', '1', '-fps_mode', 'passthrough', '-map_metadata', '-1', '-map_chapters', '-1',
        '-t', String(durationLimit / 1000), '-movflags', '+faststart', '-fs', String(PREPARATION_LIMITS.video_bytes + 1), '-f', 'mp4', '-n', '/proc/self/fd/3/clip.mp4'], run);
      const original = timestamps(log);
      requirePreparation(Math.abs(original[0]!) <= 0.000001, 'preview_timing', 'Nonzero source PTS requires an explicit timing map; no guessed preview offset is used.');
      const clip = await openPackageChild(run, 'clip.mp4');
      let marker;
      try {
        const bytes = (await clip.stat()).size;
        requirePreparation(bytes > 0 && bytes <= PREPARATION_LIMITS.video_bytes, 'preview_limit', 'Local preview exceeded 20 MiB. Use an explicitly prepared shorter excerpt.');
        const decoded = timestamps(await ffmpeg(clip, [...inputArgs('mp4'), '-map', '0:v:0', '-an', '-vf', 'showinfo', '-f', 'null', '-']));
        requirePreparation(original.length === decoded.length, 'preview_timing', 'Conversion dropped or duplicated frames.');
        const error = Math.max(...decoded.map((time, i) => Math.abs(time - original[i]!)));
        requirePreparation(error <= 1, 'preview_timing', 'Conversion did not preserve encoded timestamps.');
        const info = await probeVideo(clip, 'mp4') as { format?: { duration?: string } };
        const duration = Math.round(Number(info.format?.duration) * 1000);
        requirePreparation(Number.isSafeInteger(duration) && duration > 0 && Math.abs(duration - media.duration_ms) <= 1000 / media.fps + 2, 'preview_timing', 'Preview duration differs from source.');
        await source.assertUnchanged();
        requirePreparation(sourceHash === await hashFile(source.video, PREPARATION_LIMITS.source_bytes), 'source_changed', 'Original media changed during conversion.');
        marker = { preview_version: '1', session_id: id, preview_id: preview, source_manifest_sha256: source.manifest_sha256,
          source_events_sha256: source.events_sha256, source_video_sha256: sourceHash, clip_sha256: await hashFile(clip, PREPARATION_LIMITS.video_bytes),
          video_bytes: bytes, video_path: 'clip.mp4', duration_ms: duration, source_start_ms: 0, conversion_error_ms: Math.ceil(error) + 1,
          conversion: 'full source, first PTS zero, H.264/yuv420p, max 960x540, CRF 23, veryfast, audio omitted', decoded_frames: decoded.length };
      } finally { await clip.close(); }
      const completed = await open(`/proc/self/fd/${run.fd}/preview.json`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await completed.writeFile(JSON.stringify(marker) + '\n'); await completed.sync(); } finally { await completed.close(); }
      return (await previewBytes(source, id, preview)).metadata;
    } finally { await run.close(); }
  });
}

/** One RFC-style byte range; multi-ranges are intentionally unsupported (416). */
export function videoResponse(bytes: Uint8Array, request: Request): Response {
  const headers = new Headers({ ...PRIVATE_HEADERS, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
  let start = 0, end = bytes.length - 1, status = 200;
  const range = request.headers.get('range');
  // With no persistent validators, If-Range requests receive the complete snapshot.
  if (range && !request.headers.has('if-range')) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) { const length = Number(match[2]); start = Math.max(0, bytes.length - length); if (!Number.isSafeInteger(length) || length <= 0) start = bytes.length; }
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
    } else start = bytes.length;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= bytes.length || end < start) {
      headers.set('Content-Range', `bytes */${bytes.length}`); return new Response(null, { status: 416, headers });
    }
    status = 206; headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  return new Response(request.method === 'HEAD' ? null : bytes.slice(start, end + 1), { status, headers });
}

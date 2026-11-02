import { constants } from 'node:fs';
import { mkdir, open, readFile, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SessionLibrary, openPackageChild, probeVideo, type SessionSource } from './session-library.ts';
import { normalizeContext, PREPARATION_LIMITS } from './preparation-context.ts';
import { validateContext, resultSchema, type Context } from './analysis-validation.ts';
import { analyzeMuse, API_LIMITS, MODEL, ModelError, record } from './muse-api.ts';
import { projectAsset } from './project-assets.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ModelError('invalid_preparation', message);
}

/** Trusted local configuration, not browser input. Values can narrow the hard cap. */
export function analysisDuration(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.POSTPLAY_ANALYSIS_MAX_DURATION_MS ?? '30000';
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > PREPARATION_LIMITS.duration_ms) throw new ModelError('analysis_limit', 'POSTPLAY_ANALYSIS_MAX_DURATION_MS must be 1–120000');
  return Number(value);
}
export async function readPackageBytes(directory: FileHandle, name: string, maximum: number): Promise<Buffer> {
  const file = await openPackageChild(directory, name);
  try {
    const before = await file.stat();
    requireValid(before.size > 0 && before.size <= maximum, 'Prepared input exceeds byte limit');
    const result = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < result.length) {
      const read = await file.read(result, size, result.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    const after = await file.stat();
    requireValid(size === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs, 'Prepared input changed while reading');
    return result.subarray(0, size);
  } finally { await file.close(); }
}
async function sourceHash(file: FileHandle): Promise<string> {
  const digest = createHash('sha256'), block = Buffer.alloc(65536);
  let position = 0;
  for (;;) {
    const { bytesRead } = await file.read(block, 0, block.length, position);
    if (!bytesRead) break;
    position += bytesRead;
    requireValid(position <= PREPARATION_LIMITS.source_bytes, 'Source video exceeds byte limit');
    digest.update(block.subarray(0, bytesRead));
  }
  return digest.digest('hex');
}
async function save(directory: FileHandle, name: string, value: unknown, key: string): Promise<void> {
  let json = JSON.stringify(value, null, 2) + '\n';
  if (key) json = json.split(key).join('[REDACTED]');
  const file = await open(`/proc/self/fd/${directory.fd}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(json); await file.sync(); } finally { await file.close(); }
}
export interface AnalysisOptions { upload_to_meta?: boolean; apiKey?: string; max_duration_ms?: number; fetcher?: typeof fetch }

interface PreparedInput { manifest: Record<string, unknown> & { clip_duration_ms: number; source_start_ms: number; conversion_error_ms: number }; manifestBytes: Buffer; contextBytes: Buffer; context: Context; video: Buffer }
/** Borrow pinned files and validated snapshots for this callback only; no upload. */
export async function withPreparedSession<T>(library: SessionLibrary, id: string, preparationId: string, maximum: number,
  use: (source: SessionSource, prepared: FileHandle, input: PreparedInput) => Promise<T>): Promise<T> {
  if (!UUID.test(preparationId)) throw new ModelError('invalid_id', 'Use a preparation UUID, not a filesystem path');
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > PREPARATION_LIMITS.duration_ms) throw new ModelError('analysis_limit', 'Analysis duration limit must be 1–120000 ms');
  return await library.withSource(id, async source => {
    const parent = await openPackageChild(source.directory, 'preparations', true);
    let prepared: FileHandle;
    try { prepared = await openPackageChild(parent, preparationId, true); } finally { await parent.close(); }
    try {
      const manifestBytes = await readPackageBytes(prepared, 'preparation.json', 32768);
      let manifest: unknown;
      try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new ModelError('invalid_preparation', 'Invalid preparation marker'); }
      if (!record(manifest)) throw new ModelError('invalid_preparation', 'Invalid preparation marker');
      requireValid(manifest.preparation_version === '1' && manifest.status === 'prepared' && manifest.preparation_id === preparationId && manifest.session_id === id
        && manifest.video_path === 'clip.mp4' && manifest.context_path === 'context.json', 'Missing or inconsistent preparation identity');
      requireValid(manifest.source_manifest_sha256 === source.manifest_sha256 && manifest.source_events_sha256 === source.events_sha256, 'Source telemetry/manifest changed since preparation');
      requireValid(typeof manifest.clip_duration_ms === 'number' && Number.isSafeInteger(manifest.clip_duration_ms) && manifest.clip_duration_ms > 0 && manifest.clip_duration_ms <= maximum, 'Clip exceeds configured analysis duration');
      requireValid(typeof manifest.source_start_ms === 'number' && Number.isFinite(manifest.source_start_ms) && typeof manifest.conversion_error_ms === 'number', 'Invalid preparation timing');
      const contextBytes = await readPackageBytes(prepared, 'context.json', PREPARATION_LIMITS.context_bytes);
      const video = await readPackageBytes(prepared, 'clip.mp4', API_LIMITS.video_bytes);
      requireValid(manifest.context_sha256 === hash(contextBytes) && manifest.clip_sha256 === hash(video)
        && manifest.context_bytes === contextBytes.length && manifest.video_bytes === video.length, 'Prepared input hashes/lengths changed');
      const context = validateContext(JSON.parse(contextBytes.toString('utf8')));
      const regenerated = normalizeContext(source.inspection.session, source.inspection.events, { source_start_ms: manifest.source_start_ms, duration_ms: manifest.clip_duration_ms, conversion_error_ms: manifest.conversion_error_ms });
      requireValid(isDeepStrictEqual(regenerated, context), 'Prepared context no longer matches original evidence and timing');
      requireValid(manifest.source_video_sha256 === await sourceHash(source.video), 'Source video changed since preparation');
      const clip = await openPackageChild(prepared, 'clip.mp4');
      try {
        const info = await probeVideo(clip, 'mp4');
        requireValid(record(info) && Array.isArray(info.streams) && record(info.streams[0]) && info.streams[0].codec_name === 'h264' && info.streams[0].pix_fmt === 'yuv420p'
          && typeof info.streams[0].width === 'number' && info.streams[0].width > 0 && info.streams[0].width <= 960
          && typeof info.streams[0].height === 'number' && info.streams[0].height > 0 && info.streams[0].height <= 540
          && record(info.format) && Math.abs(Number(info.format.duration) * 1000 - manifest.clip_duration_ms) <= 1, 'Prepared media does not match the declared clip');
      } finally { await clip.close(); }
      await source.assertUnchanged();
      return await use(source, prepared, { manifest: { ...manifest, clip_duration_ms: manifest.clip_duration_ms, source_start_ms: manifest.source_start_ms, conversion_error_ms: manifest.conversion_error_ms }, manifestBytes, contextBytes, context, video });
    } finally { await prepared.close(); }
  });
}

/** Preview is read-only. Consent reserves exactly one attempt per preparation.
 * The loaded byte snapshots, not mutable filenames, are passed to the API. */
export async function analyzeSession(library: SessionLibrary, id: string, preparationId: string, options: AnalysisOptions = {}) {
  const maximum = options.max_duration_ms ?? analysisDuration();
  return await withPreparedSession(library, id, preparationId, maximum, async (_source, prepared, { manifest, manifestBytes, contextBytes, context, video }) => {
      const preview = { session_id: id, preparation_id: preparationId, model: MODEL, data_use_mode: 'Standard',
        video_bytes: video.length, context_bytes: contextBytes.length, events: context.events.length, duration_ms: manifest.clip_duration_ms,
        max_duration_ms: maximum, max_video_bytes: API_LIMITS.video_bytes, max_context_bytes: API_LIMITS.context_bytes,
        max_output_tokens: API_LIMITS.max_output_tokens, automatic_retries: 0,
        disclosure: 'Uploads selected video and telemetry to Meta. Explicit consent required. Dollar cost is unknown; check Meta billing.',
        relative_directory: `preparations/${preparationId}/analysis` };
      if (options.upload_to_meta !== true) return { ...preview, status: 'preview', remote_upload: false };
      const key = options.apiKey ?? process.env.MODEL_API_KEY ?? '';
      if (!key || /[\r\n]/.test(key)) throw new ModelError('credentials_missing', 'A valid MODEL_API_KEY is required');
      const system = await readFile(projectAsset('ai/prompts/muse-analysis.v1.system.md'), 'utf8');
      const userTemplate = await readFile(projectAsset('ai/prompts/muse-analysis.v1.user.md'), 'utf8');
      try { await mkdir(`/proc/self/fd/${prepared.fd}/analysis`, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ModelError('already_started', 'Analysis already reserved for this preparation; inspect saved stages before considering another paid call');
        throw error;
      }
      const run = await openPackageChild(prepared, 'analysis', true);
      const persist = (name: string, value: unknown) => save(run, name, value, key);
      try {
        await persist('started.json', { analysis_version: '1', status: 'started', started_at: new Date().toISOString(), ...preview,
          prompt_version: '1', schema_version: '1', system_sha256: hash(system), user_template_sha256: hash(userTemplate), result_schema_sha256: hash(JSON.stringify(resultSchema)),
          preparation_sha256: hash(manifestBytes), context_sha256: hash(contextBytes), clip_sha256: hash(video), remote_upload: true });
        const result = await analyzeMuse({ apiKey: key, context, video, system, userTemplate, save: persist, fetcher: options.fetcher, max_duration_ms: maximum });
        await persist('completed.json', { analysis_version: '1', status: 'validated_proposal', completed_at: new Date().toISOString(), findings_count: result.findings.length,
          limitation: 'Not an evidence-reviewed findings.json report. Inspect api-result.json and cleanup.json.' });
        return { ...preview, status: 'validated_proposal', remote_upload: true, findings_count: result.findings.length };
      } catch (error) {
        await persist('failure.json', { analysis_version: '1', status: 'failed', failed_at: new Date().toISOString(),
          code: error instanceof ModelError ? error.code : 'local_analysis_failed',
          message: error instanceof ModelError ? error.message : 'Local analysis failed; inspect saved stages. Remote outcome may be unknown. Do not automatically retry.' });
        throw error;
      } finally { await run.close(); }
  });
}

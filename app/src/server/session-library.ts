// Linux-first, server-only local ingestion. No web paths, uploads or media rewriting.
import { constants } from 'node:fs';
import { open, mkdir, realpath, access, opendir, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { CONTRACT_LIMITS, validateSession, validateSessionPackage, type Session, type Event } from './session-contract.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ENTRIES = 1000;
type ErrorCode = 'invalid_id' | 'not_found' | 'unsafe_file' | 'size_limit' | 'invalid_manifest' | 'unsupported_schema'
  | 'invalid_events' | 'partial_capture' | 'missing_media' | 'probe_failed' | 'media_mismatch' | 'storage_unavailable';
export interface Diagnostic { code: ErrorCode; message: string }
export interface MediaInfo { duration_ms: number; fps: number; average_fps: number | null; width: number; height: number; bytes: number }
export type Inspection = { ok: true; session: Session; events: Event[]; media: MediaInfo; diagnostics: string[] }
  | { ok: false; error: Diagnostic };
export class IngestionError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.code = code; }
}
function fail(code: ErrorCode, message: string): never { throw new IngestionError(code, message); }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Trusted server configuration only; never populate this from a browser path. */
export function sessionRoot(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const root = env.POSTPLAY_SESSION_ROOT ?? join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'postplay', 'sessions');
  if (!isAbsolute(root) || root === '/nix/store' || root.startsWith('/nix/store/')) {
    return fail('storage_unavailable', 'Use an absolute writable session root outside the Nix store.');
  }
  return root;
}

/** Pin each directory component via its open FD. Untrusted components cannot
 * redirect traversal between realpath checks and open; /proc is a Linux prerequisite. */
export async function openPackageChild(parent: FileHandle, name: string, directory = false): Promise<FileHandle> {
  if (!name || name === '.' || name === '..' || /[\/\\\x00]/u.test(name)) fail('unsafe_file', 'Invalid package path component.');
  let handle: FileHandle;
  try { handle = await open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0)); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return fail('not_found', 'A required session file or directory is missing.');
    if (['ELOOP', 'ENOTDIR', 'ENXIO'].includes(code ?? '')) return fail('unsafe_file', 'Symlinks and special files are not accepted in a session package.');
    return fail('unsafe_file', 'Cannot safely open the session file or directory.');
  }
  const info = await handle.stat();
  if (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1) {
    await handle.close();
    return fail('unsafe_file', 'Session files must be regular, unshared files; directories must not be symlinks.');
  }
  return handle;
}
async function text(handle: FileHandle, limit: number): Promise<string> {
  const before = await handle.stat();
  if (before.size > limit) fail('size_limit', 'Session metadata exceeds its byte limit.');
  const buffer = Buffer.alloc(limit + 1);
  let size = 0;
  while (size < buffer.length) {
    const result = await handle.read(buffer, size, buffer.length - size, size);
    if (!result.bytesRead) break;
    size += result.bytesRead;
  }
  if (size > limit) fail('size_limit', 'Session metadata exceeds its byte limit.');
  const after = await handle.stat();
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('unsafe_file', 'Session metadata changed while reading; retry after capture stops.');
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
}
async function readText(directory: FileHandle, name: string, limit: number): Promise<string> {
  let file: FileHandle;
  try { file = await openPackageChild(directory, name); }
  catch (error) { if (error instanceof IngestionError && error.code === 'not_found') return fail('not_found', `Required ${name} is missing from the session.`); throw error; }
  try { return await text(file, limit); } finally { await file.close(); }
}
async function mediaFile(directory: FileHandle, path: string): Promise<FileHandle> {
  // Lexical path validation has already passed validateSession.
  const parts = path.split('/');
  let parent = directory;
  try {
    for (const part of parts.slice(0, -1)) {
      const next = await openPackageChild(parent, part, true);
      if (parent !== directory) await parent.close();
      parent = next;
    }
    return await openPackageChild(parent, parts.at(-1)!);
  } finally { if (parent !== directory) await parent.close(); }
}

export async function probeVideo(file: FileHandle, format: Session['capture']['format']): Promise<unknown> {
  const demuxer = { avi: 'avi', ogv: 'ogg', mp4: 'mov' }[format];
  const args = ['-v', 'error', '-protocol_whitelist', 'fd', '-format_whitelist', demuxer, '-f', demuxer,
    '-probesize', '8388608', '-analyzeduration', '5000000', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,codec_name,pix_fmt:format=duration', '-of', 'json', '-fd', '0', '-i', 'fd:'];
  return await new Promise((resolve, reject) => {
    const probeProcess = spawn('ffprobe', args, { shell: false,
      stdio: [file.fd, 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C', AV_LOG_FORCE_NOCOLOR: '1' } });
    // Explicit cleanup also handles ENOENT (no child exit event); don't hold the
    // CLI open for the full timeout when FFprobe is absent.
    const timeout = setTimeout(() => probeProcess.kill('SIGKILL'), 15_000);
    timeout.unref();
    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceeded = false;
    const collect = (chunk: Buffer, save: boolean) => {
      bytes += chunk.length;
      if (bytes > 131072) { exceeded = true; probeProcess.kill('SIGKILL'); }
      else if (save) chunks.push(chunk);
    };
    probeProcess.stdout!.on('data', chunk => collect(chunk, true));
    probeProcess.stderr!.on('data', chunk => collect(chunk, false)); // Never log untrusted stderr/paths.
    const failed = () => new IngestionError('probe_failed', 'Media inspection failed. Check FFprobe on PATH and the original video; no clean result was produced.');
    probeProcess.on('error', () => { clearTimeout(timeout); reject(failed()); });
    probeProcess.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || exceeded) return reject(failed());
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(failed()); }
    });
  });
}
function rate(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+\/\d+$/.test(value)) return NaN;
  const [numerator, denominator] = value.split('/').map(Number);
  return numerator! / denominator!;
}
function mediaInfo(value: unknown, session: Session, bytes: number): MediaInfo {
  if (!object(value) || !Array.isArray(value.streams) || !object(value.streams[0]) || !object(value.format)) return fail('probe_failed', 'No usable video stream or duration was found.');
  const stream = value.streams[0];
  const width = stream.width, height = stream.height;
  const fps = rate(stream.r_frame_rate), average = rate(stream.avg_frame_rate);
  const duration = typeof value.format.duration === 'string' ? Number(value.format.duration) * 1000 : NaN;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 16384 || height > 16384
    || !Number.isFinite(fps) || fps < 1 || fps > 240 || !Number.isFinite(duration) || duration <= 0 || duration > Number.MAX_SAFE_INTEGER) return fail('probe_failed', 'Invalid video dimensions, frame rate or duration.');
  const capture = session.capture;
  if (width !== capture.width || height !== capture.height || Math.abs(fps - capture.fps) > 0.001
    || (capture.mode === 'movie_maker' && Number.isFinite(average) && average > 0 && Math.abs(average - fps) > 0.001)
    || Math.abs(duration - capture.duration_ms!) > Math.max(2, 1000 / fps)) return fail('media_mismatch', 'Video metadata disagrees with the manifest; preserve originals and inspect the capture.');
  return { duration_ms: Math.round(duration), fps, average_fps: Number.isFinite(average) && average > 0 ? average : null, width, height, bytes };
}

export class SessionLibrary {
  #root: FileHandle;
  private constructor(root: FileHandle) { this.#root = root; }

  /** Explicitly creates/checks writable storage. No credentials, cache or data in /nix/store. */
  static async create(root = sessionRoot()): Promise<SessionLibrary> {
    try {
      sessionRoot({ POSTPLAY_SESSION_ROOT: root });
      await mkdir(root, { recursive: true, mode: 0o700 });
      const canonical = await realpath(root);
      sessionRoot({ POSTPLAY_SESSION_ROOT: canonical });
      await access(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
      const handle = await open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      return new SessionLibrary(handle);
    } catch { return fail('storage_unavailable', 'Cannot open writable local session storage. Set POSTPLAY_SESSION_ROOT to an allowed absolute directory.'); }
  }
  async close(): Promise<void> { await this.#root.close(); }

  /** Read-only server callback for bounded stage discovery, never browser paths. */
  async withDirectory<T>(id: unknown, use: (directory: FileHandle) => Promise<T>): Promise<T> {
    if (typeof id !== 'string' || !UUID.test(id)) fail('invalid_id', 'Choose a canonical session UUID from the configured library; paths are not accepted.');
    const directory = await openPackageChild(this.#root, id, true);
    try { return await use(directory); } finally { await directory.close(); }
  }

  /** Bounded metadata is available even for incomplete/unfinalized captures. */
  async manifest(id: string): Promise<Session> {
    return await this.withDirectory(id, async directory => {
      let session: Session;
      try { session = validateSession(JSON.parse(await readText(directory, 'session.json', CONTRACT_LIMITS.manifestBytes))); }
      catch (error) { if (error instanceof IngestionError) throw error; return fail('invalid_manifest', 'Session manifest violates the v1 contract. Preserve the original and inspect capture diagnostics.'); }
      if (session.session_id !== id) fail('invalid_manifest', 'Manifest ID does not match its UUID directory.');
      return session;
    });
  }

  /** Nonrecursive, bounded discovery. Non-UUID entries are counted, not interpreted. */
  async discover(): Promise<{ ids: string[]; ignored_entries: number }> {
    const directory = await opendir(`/proc/self/fd/${this.#root.fd}`);
    const ids: string[] = [];
    let count = 0, ignored = 0;
    for await (const entry of directory) {
      if (++count > MAX_ENTRIES) fail('size_limit', 'Session root contains more than 1,000 entries; choose a smaller library.');
      if (UUID.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) ids.push(entry.name);
      else ignored++;
    }
    return { ids: ids.sort(), ignored_entries: ignored };
  }

  async inspect(id: unknown): Promise<Inspection> {
    try { return await this.withSource(id, async source => source.inspection); }
    catch (error) {
      return { ok: false, error: error instanceof IngestionError ? { code: error.code, message: error.message } : { code: 'unsafe_file', message: 'Session could not be read safely; check files and permissions.' } };
    }
  }

  /** Trusted server operations only. Do not retain/close borrowed handles or expose
   * them to clients. The callback completes before the pinned handles are closed. */
  async withSource<T>(id: unknown, use: (source: SessionSource) => Promise<T>): Promise<T> {
    let directory: FileHandle | undefined;
    try {
      if (typeof id !== 'string' || !UUID.test(id)) fail('invalid_id', 'Choose a canonical session UUID from the configured library; paths are not accepted.');
      directory = await openPackageChild(this.#root, id, true);
      let manifest: unknown;
      let rawManifest: string;
      try { rawManifest = await readText(directory, 'session.json', CONTRACT_LIMITS.manifestBytes); manifest = JSON.parse(rawManifest); }
      catch (error) { if (error instanceof IngestionError) throw error; return fail('invalid_manifest', 'Cannot parse session.json as bounded UTF-8 JSON.'); }
      if (!object(manifest)) fail('invalid_manifest', 'Session manifest must be an object.');
      if (manifest.schema_version !== '1') fail('unsupported_schema', 'Unsupported session schema version; only raw v1 packages can be opened.');
      let session: Session;
      try { session = validateSession(manifest); } catch { return fail('invalid_manifest', 'Session manifest violates the v1 contract (including path, capture or synchronization metadata).'); }
      if (session.session_id !== id) fail('invalid_manifest', 'Manifest ID does not match its UUID directory.');
      let log: string;
      try { log = await readText(directory, 'events.jsonl', CONTRACT_LIMITS.logBytes); }
      catch (error) { if (error instanceof IngestionError) throw error; return fail('invalid_events', 'Cannot read events.jsonl as bounded UTF-8 telemetry.'); }
      let parsed: ReturnType<typeof validateSessionPackage>;
      try { parsed = validateSessionPackage(session, log); } catch { return fail('invalid_events', 'Telemetry or its references are invalid; preserve the original log, including any damaged tail.'); }
      if (session.status !== 'complete') fail('partial_capture', `Capture is ${session.status}, not a finalized session. Preserve it and inspect capture recovery diagnostics.`);
      let file: FileHandle;
      try { file = await mediaFile(directory, session.capture.video_path!); }
      catch (error) { if (error instanceof IngestionError && error.code === 'not_found') return fail('missing_media', 'The manifest video is missing; restore the original recording.'); throw error; }
      try {
        const info = await file.stat();
        if (info.size <= 0) fail('probe_failed', 'The original video is empty.');
        const media = mediaInfo(await probeVideo(file, session.capture.format), session, info.size);
        const after = await file.stat();
        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) fail('media_mismatch', 'Video changed while being inspected; retry after recording has stopped.');
        const diagnostics = [...parsed.diagnostics];
        if (media.average_fps === null) diagnostics.push('Average video frame rate unavailable; only nominal fps was checked, not per-frame cadence.');
        const pinned = directory;
        return await use({ inspection: { ok: true, session, events: parsed.events, media, diagnostics }, directory, video: file,
          manifest_sha256: createHash('sha256').update(rawManifest).digest('hex'), events_sha256: createHash('sha256').update(log).digest('hex'),
          assertUnchanged: async () => {
            if (await readText(pinned, 'session.json', CONTRACT_LIMITS.manifestBytes) !== rawManifest || await readText(pinned, 'events.jsonl', CONTRACT_LIMITS.logBytes) !== log) fail('unsafe_file', 'Source metadata changed during processing; retry with immutable originals.');
          } });
      } finally { await file.close(); }
    } finally { await directory?.close(); }
  }
}

export interface SessionSource {
  inspection: Extract<Inspection, { ok: true }>;
  directory: FileHandle; video: FileHandle;
  manifest_sha256: string; events_sha256: string;
  assertUnchanged(): Promise<void>;
}

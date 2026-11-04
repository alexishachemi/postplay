import { constants } from 'node:fs';
import { mkdir, open, rename, opendir, type FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { SessionLibrary, openPackageChild, IngestionError } from './session-library.ts';
import { measureSynchronization, type VisibleObservation } from './synchronization.ts';
import { playbackBytes } from './playback.ts';
import { hashFile } from './media-preparation.ts';
import { readPackageBytes } from './session-analysis.ts';
import { validSessionId } from './dashboard.ts';
import { withSessionOperation } from './dashboard-analysis.ts';
import { CONTRACT_LIMITS, validateSessionPackage } from './session-contract.ts';

export class SynchronizationError extends Error {
  status: number;
  constructor(message: string, status = 422) { super(message); this.status = status; }
}
function requireSync(value: unknown, message: string, status = 422): asserts value {
  if (!value) throw new SynchronizationError(message, status);
}
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function noPreparations(directory: FileHandle) {
  let parent: FileHandle;
  try { parent = await openPackageChild(directory, 'preparations', true); }
  catch (error) { if (error instanceof IngestionError && error.code === 'not_found') return; throw error; }
  try {
    for await (const _entry of await opendir(`/proc/self/fd/${parent.fd}`)) {
      throw new SynchronizationError('This session already has preparation history. Alignment cannot be changed without invalidating saved evidence.', 409);
    }
  } finally { await parent.close(); }
}

/** Only existing signal observations are offered; no guesses from lifecycle timestamps. */
export async function synchronizationView(library: SessionLibrary, id: string) {
  return await library.withSource(id, async source => {
    const { session, events } = source.inspection;
    const clock = session.capture.mode === 'movie_maker' ? 'process_frame' : 'simulation_ms';
    return {
      synchronization: session.synchronization, fps: session.capture.fps,
      events: events.filter(event => event.kind === 'signal' && event.time[clock] !== null).map(event => ({
        id: event.id, label: event.label, detail: JSON.stringify(event.payload).slice(0, 200),
      })),
    };
  });
}
export interface SynchronizationAction {
  action: 'preview' | 'apply'; preview_id: string; observations: VisibleObservation[]; review: string | null;
}
export function parseSynchronizationAction(input: unknown): SynchronizationAction {
  requireSync(typeof input === 'object' && input !== null && !Array.isArray(input), 'Invalid synchronization request.', 400);
  const value = input as Record<string, unknown>;
  requireSync(Object.keys(value).sort().join(',') === 'action,observations,preview_id,review'
    && (value.action === 'preview' || value.action === 'apply') && validSessionId(value.preview_id)
    && Array.isArray(value.observations) && value.observations.length >= 2 && value.observations.length <= 12
    && (value.action === 'preview' ? value.review === null : typeof value.review === 'string' && /^[a-f0-9]{64}$/.test(value.review)),
  'Choose a local preview and 2–12 matching events, then review the alignment before saving.', 400);
  for (const item of value.observations) {
    requireSync(typeof item === 'object' && item !== null && !Array.isArray(item)
      && Object.keys(item).sort().join(',') === 'event_id,uncertainty_ms,video_ms'
      && typeof item.event_id === 'string' && /^evt-[1-9][0-9]*$/.test(item.event_id)
      && Number.isSafeInteger(item.video_ms) && item.video_ms >= 0
      && Number.isSafeInteger(item.uncertainty_ms) && item.uncertainty_ms >= 0 && item.uncertainty_ms <= 60000,
    'Each observation needs an event, a video time and a nonnegative uncertainty in milliseconds.', 400);
  }
  return value as unknown as SynchronizationAction;
}
async function save(directory: FileHandle, name: string, data: Buffer | string) {
  const file = await open(`/proc/self/fd/${directory.fd}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
}

/** Review is bound to source hashes, preview provenance and exact observations.
 * Apply changes only the manifest, after an exclusive recoverable backup. */
export async function runSynchronizationAction(library: SessionLibrary, id: string, input: unknown) {
  requireSync(validSessionId(id), 'Choose a canonical session UUID.', 400);
  const action = parseSynchronizationAction(input);
  return await withSessionOperation(id, async () => {
    return await library.withSource(id, async source => {
      const { session, events } = source.inspection;
      requireSync(session.synchronization.status === 'unknown', 'This session already has measured alignment; it will not be overwritten.', 409);
      await noPreparations(source.directory);
      const preview = await playbackBytes(library, id, 'preview', action.preview_id);
      const observations = action.observations.map(item => {
        requireSync(item.video_ms < preview.metadata.duration_ms, 'An observation is outside the preview.');
        requireSync(events.some(event => event.id === item.event_id && event.kind === 'signal'), 'Select an existing signal accompanying a visible change.');
        return { ...item, video_ms: Math.round(item.video_ms + preview.metadata.source_start_ms),
          uncertainty_ms: item.uncertainty_ms + preview.metadata.conversion_error_ms };
      });
      const clock = session.capture.mode === 'movie_maker' ? 'process_frame' : 'simulation_ms';
      let measurement;
      try { measurement = measureSynchronization(session, events, clock, observations); }
      catch { throw new SynchronizationError('The selected matches are invalid. Use distinct events in increasing video order, within the recording, with available clocks.'); }
      requireSync(measurement.observed_span_ms >= 1000, 'Choose events at least one second apart.');
      const videoHash = await hashFile(source.video, 1024 ** 3);
      const previews = await openPackageChild(source.directory, 'playback', true);
      try {
        const run = await openPackageChild(previews, action.preview_id, true);
        try {
          const provenance = JSON.parse((await readPackageBytes(run, 'preview.json', 8192)).toString('utf8'));
          requireSync(provenance.source_manifest_sha256 === source.manifest_sha256 && provenance.source_events_sha256 === source.events_sha256
            && provenance.source_video_sha256 === videoHash, 'The preview no longer matches the original recording. Recreate it before measuring.', 409);
        } finally { await run.close(); }
      } finally { await previews.close(); }
      await source.assertUnchanged();
      const review = sha(JSON.stringify({ manifest: source.manifest_sha256, events: source.events_sha256, video: videoHash,
        preview: action.preview_id, measurement }));
      if (action.action === 'preview') return { measurement, review, applied: false, backup_directory: null };
      requireSync(review === action.review, 'The recording or selected matches changed. Review the alignment again before saving.', 409);
      await source.assertUnchanged();
      const original = await readPackageBytes(source.directory, 'session.json', CONTRACT_LIMITS.manifestBytes);
      requireSync(sha(original) === source.manifest_sha256, 'The manifest changed; refresh before saving.', 409);
      const backupName = `synchronization-${randomUUID()}`;
      await mkdir(`/proc/self/fd/${source.directory.fd}/${backupName}`, { mode: 0o700 });
      const backup = await openPackageChild(source.directory, backupName, true);
      try {
        const synchronization = structuredClone(measurement.synchronization);
        synchronization.notes.push(`Measurement and original manifest: ${backupName}/`);
        const updated = { ...session, synchronization };
        validateSessionPackage(updated, events.map(event => JSON.stringify(event) + '\n').join(''));
        await save(backup, 'session.before.json', original);
        await save(backup, 'measurement.json', JSON.stringify({ measurement_version: '1', session_id: id,
          measured_at_utc: new Date().toISOString(), method: 'Browser observer-supplied visible-event timestamps; not inferred from telemetry alone.',
          original_manifest_sha256: source.manifest_sha256, events_sha256: source.events_sha256, video_sha256: videoHash, ...measurement }, null, 2) + '\n');
        await save(backup, 'session.pending.json', JSON.stringify(updated, null, 2) + '\n');
        await source.assertUnchanged();
        requireSync(await hashFile(source.video, 1024 ** 3) === videoHash, 'The original video changed; preserve the backup and refresh.', 409);
        await rename(`/proc/self/fd/${backup.fd}/session.pending.json`, `/proc/self/fd/${source.directory.fd}/session.json`);
      } finally { await backup.close(); }
      return { measurement, review, applied: true, backup_directory: backupName };
    });
  });
}

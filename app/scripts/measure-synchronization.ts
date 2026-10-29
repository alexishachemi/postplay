// Explicit local measurement only. No automatic demo detection, upload or media rewrite.
import { createReadStream } from 'node:fs';
import { readFile, stat, realpath, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, relative, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CONTRACT_LIMITS, validateSessionPackage } from '../src/server/session-contract.ts';
import { measureSynchronization } from '../src/server/synchronization.ts';

async function bounded(path: string, maximum: number): Promise<string> {
  if ((await stat(path)).size > maximum) throw new Error('Measurement input exceeds size limit');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > maximum) throw new Error('Measurement input exceeds size limit');
  return text;
}
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Local CLI helper, not a general session importer. Refuses symlinked package files.
 * --apply updates only synchronization metadata after saving a recoverable original. */
export async function runMeasurement(directory: string, observationFile: string, clock: 'process_frame' | 'simulation_ms' | 'wall_elapsed_ms', apply = false) {
  const root = await realpath(resolve(directory));
  async function packageFile(name: string): Promise<string> {
    const path = resolve(root, name);
    const local = relative(root, path);
    if (!local || local.startsWith(`..${sep}`) || local === '..' || await realpath(path) !== path || !(await stat(path)).isFile()) throw new Error('Package file is not a confined regular file');
    return path;
  }
  const manifestPath = await packageFile('session.json');
  const logPath = await packageFile('events.jsonl');
  const manifest = await bounded(manifestPath, CONTRACT_LIMITS.manifestBytes);
  const log = await bounded(logPath, CONTRACT_LIMITS.logBytes);
  const { session, events } = validateSessionPackage(JSON.parse(manifest), log);
  const input = JSON.parse(await bounded(resolve(observationFile), 32_768));
  const measurement = measureSynchronization(session, events, clock, input);
  const video = await packageFile(session.capture.video_path!);
  const report = {
    measurement_version: '1', session_id: session.session_id, measured_at_utc: new Date().toISOString(),
    method: 'Explicit observer-supplied visible-event timestamps; not inferred from telemetry alone.',
    original_manifest_sha256: createHash('sha256').update(manifest).digest('hex'),
    events_sha256: createHash('sha256').update(log).digest('hex'),
    video_sha256: await hashFile(video), ...measurement,
  };
  if (!apply) return { report, applied: false, backup_directory: null };
  if (session.synchronization.status !== 'unknown') throw new Error('Refusing to replace an existing measurement');
  if (await readFile(manifestPath, 'utf8') !== manifest || await readFile(logPath, 'utf8') !== log) throw new Error('Session changed during measurement');
  const backupName = `synchronization-${randomUUID()}`;
  const backup = join(root, backupName);
  await mkdir(backup, { mode: 0o700 });
  // Never overwrite an earlier report. If interrupted here, the original manifest remains valid.
  await writeFile(join(backup, 'session.before.json'), manifest, { flag: 'wx', mode: 0o600 });
  await writeFile(join(backup, 'measurement.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const synchronization = structuredClone(measurement.synchronization);
  synchronization.notes.push(`Measurement and original manifest: ${backupName}/`);
  const updated = { ...session, synchronization };
  validateSessionPackage(updated, log);
  const pending = join(backup, 'session.pending.json');
  await writeFile(pending, JSON.stringify(updated, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (await readFile(manifestPath, 'utf8') !== manifest) throw new Error('Manifest changed before metadata update');
  await rename(pending, manifestPath);
  return { report, applied: true, backup_directory: backupName };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, observations, clock, option, ...extra] = process.argv.slice(2);
  if (!directory || !observations || !['process_frame', 'simulation_ms', 'wall_elapsed_ms'].includes(clock ?? '') || (option !== undefined && option !== '--apply') || extra.length) {
    console.error('Usage: measure-synchronization.ts SESSION_DIRECTORY OBSERVATIONS_JSON process_frame|simulation_ms|wall_elapsed_ms [--apply]');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await runMeasurement(directory, observations, clock as 'process_frame' | 'simulation_ms' | 'wall_elapsed_ms', option === '--apply'), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Measurement failed'); process.exitCode = 1; }
  }
}

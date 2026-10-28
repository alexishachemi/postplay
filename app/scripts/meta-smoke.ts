import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { analyzeSmoke, record } from '../src/server/meta-smoke.ts';
import { validateContext } from '../src/server/analysis-validation.ts';
import type { Context } from '../src/server/analysis-validation.ts';

const repo = new URL('../../', import.meta.url);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const [command, ...args] = process.argv.slice(2);
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
async function save(directory: string, name: string, value: unknown) {
  let json = JSON.stringify(value, null, 2);
  const key = process.env.MODEL_API_KEY;
  if (key) json = json.split(key).join('[REDACTED]');
  await writeFile(resolve(directory, name), json + '\n', { flag: 'wx', mode: 0o600 });
}

async function main() {
  if (command === 'prepare') {
    const [video, telemetry, output] = args;
    if (!video || !telemetry || !output) throw new Error('Usage: prepare VIDEO SMOKE_JSONL NEW_OUTPUT_DIRECTORY');
    const directory = resolve(output);
    const sourceInfo = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate:format=duration', '-of', 'json', resolve(video)], { encoding: 'utf8' }));
    if (sourceInfo.streams[0]?.r_frame_rate !== '30/1' || Number(sourceInfo.format?.duration) < 60) throw new Error('This smoke adapter requires a 30 fps recording of at least 60 seconds');
    const raw = await readFile(telemetry);
    if (raw.byteLength > 2_000_000) throw new Error('Smoke telemetry too large');
    const rows: unknown[] = raw.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    const events: Context['events'] = [];
    const seen = new Set<string>();
    let previousFrame = -1;
    for (const row of rows) {
      if (!record(row) || row.probe_version !== 'smoke-1' || typeof row.id !== 'string' || seen.has(row.id) || !Number.isInteger(row.process_frame) || typeof row.process_frame !== 'number' || row.process_frame < previousFrame || !record(row.payload)) throw new Error('Invalid smoke observation');
      seen.add(row.id);
      previousFrame = row.process_frame;
      // This smoke adapter uses the frame mapping measured in M0.4 for this capture.
      const t = Math.round(row.process_frame * 1000 / 30) - 30_000;
      if (t < 0 || t >= 30_000 || !['position', 'beacon_activated'].includes(String(row.kind))) continue;
      let payload: Record<string, unknown>;
      if (row.kind === 'position') {
        if (typeof row.payload.x !== 'number' || typeof row.payload.y !== 'number' || !Number.isFinite(row.payload.x) || !Number.isFinite(row.payload.y)) throw new Error('Invalid position');
        payload = { x: row.payload.x, y: row.payload.y };
      } else {
        if (!Number.isInteger(row.payload.activation_count)) throw new Error('Invalid activation count');
        payload = { activation_count: row.payload.activation_count };
      }
      events.push({ id: row.id, t_ms: t, kind: row.kind === 'position' ? 'position' : 'signal', registration_id: null, source_label: row.kind === 'position' ? 'Player' : 'Beacon activation', payload });
    }
    const context: Context = {
      contract_version: '1',
      session: { session_id: randomUUID(), duration_ms: 30_000, video_window: { start_ms: 0, end_ms: 30_000 },
        synchronization: { status: 'approximate', estimated_error_ms: 34 },
        recording_notes: [
          'This is a 30-second excerpt of original encoded video seconds 30–60; all supplied times are excerpt-local.',
          'The original capture has a vertical crop: HUD and top of play area are absent. Do not infer what the missing HUD displayed.',
          'Raw player positions use game coordinates; they are not encoded pixel positions because of the capture crop.',
          'Video/process frame correspondence was measured on nine visible beacon flashes in this exact original recording; 30 fps, one-frame timing uncertainty.',
          'Only position and beacon activation observations are supplied. No recorded expectations, progression states or audio.',
        ] },
      registrations: [], events,
      coverage: { total_events: rows.length, included_events: events.length, truncated: true, omissions: ['Original video outside seconds 30–60 omitted; lifecycle events outside the excerpt omitted.'] },
    };
    validateContext(context);
    if (Buffer.byteLength(JSON.stringify(context)) > 96_000) throw new Error('Context exceeds smoke cap');
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory, { mode: 0o700 }); // Existing directories are never reused.
    execFileSync('ffmpeg', ['-v', 'error', '-n', '-i', resolve(video), '-ss', '30', '-t', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(directory, 'clip.mp4')]);
    const clip = await readFile(resolve(directory, 'clip.mp4'));
    if (clip.byteLength > 20_000_000) throw new Error('Clip exceeds 20 MB smoke cap');
    await save(directory, 'context.json', context);
    await save(directory, 'preparation.json', { version: 'smoke-1', source_video_sha256: hash(await readFile(video)), source_telemetry_sha256: hash(raw), clip_sha256: hash(clip), context_sha256: hash(Buffer.from(JSON.stringify(context))), clip_start_ms: 30_000, clip_duration_ms: 30_000, video_bytes: clip.byteLength, context_bytes: Buffer.byteLength(JSON.stringify(context)), frame_map: 'original process_frame / 30; subtract 30000 ms', limitation: 'Adapter for the measured M0 smoke capture only; not a general M1/M2 importer.' });
    console.log(`Prepared ${events.length} observations and ${clip.byteLength} video bytes; no remote request made.`);
    return;
  }
  if (command === 'analyze' && args.length === 2 && args[1] === '--upload-to-meta') {
    const directory = resolve(args[0]!);
    if (!process.env.MODEL_API_KEY) throw new Error('MODEL_API_KEY is required');
    const context = validateContext(await readJson(resolve(directory, 'context.json')));
    const preparation = await readJson(resolve(directory, 'preparation.json'));
    const video = await readFile(resolve(directory, 'clip.mp4'));
    if (!record(preparation) || preparation.clip_sha256 !== hash(video) || preparation.context_sha256 !== hash(Buffer.from(JSON.stringify(context)))) throw new Error('Prepared media/context changed');
    const system = await readFile(new URL('ai/prompts/muse-analysis.v1.system.md', repo), 'utf8');
    const userTemplate = await readFile(new URL('ai/prompts/muse-analysis.v1.user.md', repo), 'utf8');
    // Exclusive write-ahead lock survives interruption; re-running cannot repeat inference.
    await save(directory, 'run-started.json', { started_at: new Date().toISOString(), model: 'muse-spark-1.3', mode: 'Standard', system_sha256: hash(Buffer.from(system)), user_template_sha256: hash(Buffer.from(userTemplate)), remote_upload: true });
    console.log(`Uploading ${video.byteLength} bytes plus ${context.events.length} telemetry observations to Meta; one inference attempt, no automatic retries.`);
    try {
      const result = await analyzeSmoke({ apiKey: process.env.MODEL_API_KEY, video, context, system, userTemplate, save: (name, value) => save(directory, name, value) });
      console.log(`Validated real Muse proposal with ${result.findings.length} findings. Inspect local artifacts; this is not a final M2 report.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Smoke analysis failed';
      await save(directory, 'failure.json', { status: 'failed', message });
      throw error;
    }
    return;
  }
  throw new Error('Use prepare VIDEO SMOKE_JSONL NEW_OUTPUT_DIRECTORY, or analyze OUTPUT_DIRECTORY --upload-to-meta');
}
main().catch(error => {
  // Never print arbitrary response bodies, headers, request payloads, or credentials.
  let message = error instanceof Error ? error.message : 'Smoke command failed';
  if (process.env.MODEL_API_KEY) message = message.split(process.env.MODEL_API_KEY).join('[REDACTED]');
  console.error(message);
  process.exitCode = 1;
});

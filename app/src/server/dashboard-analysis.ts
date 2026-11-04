import { opendir, type FileHandle } from 'node:fs/promises';
import { SessionLibrary, openPackageChild, IngestionError } from './session-library.ts';
import { latestPreparation, validSessionId } from './dashboard.ts';
import { prepareSession } from './media-preparation.ts';
import { withPreparedSession, analyzeSession, readPackageBytes, analysisDuration, type AnalysisOptions } from './session-analysis.ts';
import { createFindingsReport, loadFindingsReport, ReportError } from './report-storage.ts';
import { ModelError, record } from './muse-api.ts';
import { PreparationError } from './preparation-context.ts';

export class AnalysisControlError extends Error {
  code: string; status: number;
  constructor(code: string, status = 422) { super(code); this.code = code; this.status = status; }
}
export type AnalysisAction = { action: 'prepare'; start_ms: number; duration_ms: number; reviewed_previous_attempt: boolean }
  | { action: 'analyze'; preparation_id: string; upload_to_meta: true }
  | { action: 'report'; preparation_id: string };
export interface AnalysisView {
  phase: 'unprepared' | 'ready' | 'preparing' | 'uploading' | 'reasoning' | 'validating' | 'reporting' | 'finished' | 'failed' | 'interrupted' | 'report_available';
  active: boolean; reserved: boolean; credentials_configured: boolean; max_duration_ms: number;
  preparation: { id: string; duration_ms: number; source_start_ms: number; video_bytes: number; context_bytes: number; events: number; total_events: number } | null;
  code: string | null; message: string; cleanup: string | null;
}
const errors: Record<string, string> = {
  credentials_missing: 'MODEL_API_KEY is not configured on the server. Set it before starting the app; never enter it in the browser.',
  authentication_failed: 'Meta rejected the server credential. Check the key/account; this attempt is not a clean report.',
  credit_exhausted: 'Meta credits/quota are exhausted. Check billing before considering another attempt.',
  rate_limited: 'Meta rate limit reached. This attempt failed; no automatic retry was made.',
  service_unavailable: 'Meta is unavailable. Preserve the attempt and inspect its saved stages before any retry.',
  transport_unknown: 'Meta connection failed or timed out; the remote outcome and charges may be unknown. Inspect saved stages before retrying.',
  invalid_proposal: 'Model output failed schema/evidence validation. No successful or clean report was produced.',
  invalid_response: 'Meta returned an invalid or unexpected response. No successful or clean report was produced.',
  response_limit: 'Meta response exceeded the safety limit. Preserve stages; no successful report is implied.',
  http_error: 'Meta rejected this request. Inspect saved HTTP status and account settings before considering another attempt.',
  model_incomplete: 'Meta returned an incomplete response. No successful report was produced.',
  model_refused: 'The model refused or returned unsupported content. No successful report was produced.',
  invalid_preparation: 'Prepared input failed provenance/media validation. Preserve files and prepare a new clip only after inspecting this attempt.',
  analysis_limit: 'Selected clip exceeds the configured analysis limit. Choose a shorter explicit clip; no automatic trimming is performed.',
  synchronization_unknown: 'Use “Align video and telemetry locally” above to match visible events, review and save alignment before analysis. Local video preview is still available.',
  insufficient_telemetry: 'This clip has no alignable gameplay observations. Choose a recorded interaction or add instrumentation.',
  context_limit: 'Aligned telemetry exceeds the budget. Select a shorter clip; observations are not silently dropped.',
  conversion_failed: 'Local FFmpeg conversion failed. Check FFmpeg/FFprobe and the source media; no upload occurred during preparation.',
  clip_limit: 'Choose a positive clip within the source video and the displayed duration cap.',
  already_started: 'This preparation already has a reserved analysis attempt. Reopen its saved outcome; never repeat automatically.',
  busy: 'An operation for this session is already active. Wait and refresh its status; do not submit again.',
  prior_attempt_review: 'Review the previous attempt and acknowledge it before preparing another potential paid attempt.',
  invalid_request: 'Invalid action, consent, clip range or preparation UUID. Use the displayed controls.',
  invalid_report: 'The saved response/report could not be validated. Preserve stages; do not repeat inference to repair a local report.',
  partial_capture: 'Capture is not finalized. Preserve its files and inspect Godot capture diagnostics before analysis.',
  missing_media: 'Original video is missing. Restore it before preparing or submitting this session.',
  invalid_events: 'Telemetry is invalid or damaged. Preserve the original log; no clean outcome is implied.',
  probe_failed: 'Media inspection failed. Check FFprobe and the source recording before analysis.',
  media_mismatch: 'Recording metadata does not match the video. Inspect the capture; no upload is safe yet.',
  local_failure: 'Local operation failed. Check source files/tools and saved stages. This is not a clean result; no automatic retry was made.',
};
export function controlError(error: unknown) {
  const code = error instanceof ReportError ? 'invalid_report' : error instanceof AnalysisControlError || error instanceof ModelError || error instanceof PreparationError || error instanceof IngestionError ? error.code : 'local_failure';
  const safeCode = Object.hasOwn(errors, code) ? code : 'local_failure';
  return { code: safeCode, message: errors[safeCode]! };
}
const message = (code: string) => errors[code] ?? errors.local_failure!;
const active = new Map<string, { phase: 'preparing' | 'validating' | 'reporting'; preparation_id: string | null }>();
/** One local server per library: calibration must not change provenance during preparation/upload. */
export async function withSessionOperation<T>(id: string, use: () => Promise<T>, phase: 'preparing' | 'validating' | 'reporting' = 'validating', preparation_id: string | null = null): Promise<T> {
  if (active.has(id)) throw new AnalysisControlError('busy', 409);
  active.set(id, { phase, preparation_id });
  try { return await use(); } finally { active.delete(id); }
}
async function has(directory: FileHandle, name: string, folder = false) {
  try { const file = await openPackageChild(directory, name, folder); await file.close(); return true; }
  catch (error) { if (error instanceof IngestionError && error.code === 'not_found') return false; throw error; }
}
async function stages<T>(library: SessionLibrary, id: string, preparation: string, use: (run: FileHandle | null) => Promise<T>) {
  return await library.withDirectory(id, async directory => {
    const parent = await openPackageChild(directory, 'preparations', true);
    let prepared: FileHandle;
    try { prepared = await openPackageChild(parent, preparation, true); } finally { await parent.close(); }
    try {
      if (!await has(prepared, 'analysis', true)) return await use(null);
      const run = await openPackageChild(prepared, 'analysis', true);
      try { return await use(run); } finally { await run.close(); }
    } finally { await prepared.close(); }
  });
}
function keyConfigured(key = process.env.MODEL_API_KEY) { return !!key && !/[\r\n]/.test(key); }

/** Public status DTO only: no raw model prose, provider errors, paths or secrets. */
export async function analysisView(library: SessionLibrary, id: string, preparation?: string | null): Promise<AnalysisView> {
  let maximum = 30000;
  try { maximum = analysisDuration(); } catch { /* Configuration error is shown below. */ }
  const view: AnalysisView = { phase: 'unprepared', active: false, reserved: false, credentials_configured: keyConfigured(), max_duration_ms: maximum,
    preparation: null, code: null, message: 'Select a clip and prepare it locally before consenting to remote analysis.', cleanup: null };
  try {
    analysisDuration();
    const running = active.get(id);
    const selected = preparation ?? running?.preparation_id ?? await latestPreparation(library, id);
    if (running?.phase === 'preparing') return { ...view, phase: 'preparing', active: true, message: 'Validating and converting selected clip locally. No upload yet.' };
    if (!selected) return view;
    if (!validSessionId(selected)) throw new AnalysisControlError('invalid_request', 400);
    // Preserve the reservation even when derived input validation fails, so the
    // recovery UI can require prior-attempt review without offering resubmission.
    view.reserved = await stages(library, id, selected, async run => run !== null);
    view.preparation = await withPreparedSession(library, id, selected, 120000, async (_source, _prepared, input) => ({
      id: selected, duration_ms: input.manifest.clip_duration_ms, source_start_ms: input.manifest.source_start_ms,
      video_bytes: input.video.length, context_bytes: input.contextBytes.length, events: input.context.events.length, total_events: input.context.coverage.total_events,
    }));
    view.phase = 'ready'; view.message = 'Prepared locally. Review sizes and consent below; no upload has occurred for this preparation.';
    await stages(library, id, selected, async run => {
      if (!run) return;
      view.reserved = true;
      if (await has(run, 'cleanup.json')) {
        const cleanup: unknown = JSON.parse((await readPackageBytes(run, 'cleanup.json', 8192)).toString('utf8'));
        if (record(cleanup) && ['deleted', 'delete_failed', 'delete_unconfirmed', 'not_uploaded', 'upload_not_confirmed'].includes(String(cleanup.status))) view.cleanup = String(cleanup.status);
      }
      if (await has(run, 'failure.json')) {
        const failure: unknown = JSON.parse((await readPackageBytes(run, 'failure.json', 8192)).toString('utf8'));
        const code = record(failure) && typeof failure.code === 'string' && Object.hasOwn(errors, failure.code) ? failure.code : 'local_failure';
        view.phase = 'failed'; view.code = code; view.message = message(code); return;
      }
      if (await has(run, 'report-completed.json')) {
        const report = await loadFindingsReport(library, id, selected);
        view.phase = 'finished'; view.message = `Report validated and saved (${report.status}). Model interpretations require review.`; return;
      }
      if (await has(run, 'completed.json')) { view.phase = 'report_available'; view.message = 'A completed response is saved. Build/reopen the report offline; no new inference is needed.'; return; }
      if (!running) { view.phase = 'interrupted'; view.message = 'Saved attempt is unfinished and is not active in this server. Its remote outcome may be unknown. Inspect stages; never retry automatically.'; return; }
      if (await has(run, 'response.json')) { view.phase = 'validating'; view.message = 'Response saved; validating evidence and completing remote-upload cleanup.'; }
      else if (await has(run, 'inference-attempt.json')) { view.phase = 'reasoning'; view.message = 'Inference intent saved; waiting for Muse. No automatic retries.'; }
      else if (await has(run, 'upload-attempt.json')) { view.phase = 'uploading'; view.message = 'Upload intent saved; sending selected video to Meta. Telemetry accompanies the reasoning request.'; }
    });
    if (running) { view.active = true; if (running.phase === 'reporting') { view.phase = 'reporting'; view.message = 'Building and validating the local evidence-linked report.'; } }
    if (!view.reserved && view.preparation.duration_ms > maximum) { view.phase = 'failed'; view.code = 'analysis_limit'; view.message = message('analysis_limit'); }
    return view;
  } catch (error) {
    const running = active.get(id);
    if (running) return { ...view, phase: running.phase, active: true, code: null, message: 'Operation is active; a consistent stage snapshot is not available yet. Waiting for the next status read.' };
    const failure = controlError(error); return { ...view, phase: 'failed', ...failure };
  }
}

export function parseAnalysisAction(value: unknown): AnalysisAction {
  const invalid = () => { throw new AnalysisControlError('invalid_request', 400); };
  if (!record(value)) return invalid();
  const keys = Object.keys(value).sort().join(',');
  if (value.action === 'prepare' && keys === 'action,duration_ms,reviewed_previous_attempt,start_ms' && Number.isSafeInteger(value.start_ms) && (value.start_ms as number) >= 0
    && Number.isSafeInteger(value.duration_ms) && (value.duration_ms as number) > 0 && typeof value.reviewed_previous_attempt === 'boolean') return value as AnalysisAction;
  if (value.action === 'analyze' && keys === 'action,preparation_id,upload_to_meta' && value.upload_to_meta === true && validSessionId(value.preparation_id)) return value as AnalysisAction;
  if (value.action === 'report' && keys === 'action,preparation_id' && validSessionId(value.preparation_id)) return value as AnalysisAction;
  return invalid();
}

/** Synchronous request work, not a queue. On-disk analysis reservation survives restart. */
export async function runAnalysisAction(library: SessionLibrary, id: string, input: AnalysisAction, options: Pick<AnalysisOptions, 'apiKey' | 'fetcher'> = {}) {
  if (!validSessionId(id)) throw new AnalysisControlError('invalid_request', 400);
  const action = parseAnalysisAction(input);
  return await withSessionOperation(id, async () => {
    if (action.action === 'prepare') {
      if (action.duration_ms > analysisDuration()) throw new AnalysisControlError('analysis_limit');
      const latest = await latestPreparation(library, id);
      if (latest && !action.reviewed_previous_attempt && await stages(library, id, latest, async run => run !== null)) throw new AnalysisControlError('prior_attempt_review', 409);
      await library.withDirectory(id, async directory => {
        if (!await has(directory, 'preparations', true)) return;
        const parent = await openPackageChild(directory, 'preparations', true);
        try { let count = 0; for await (const _entry of await opendir(`/proc/self/fd/${parent.fd}`)) if (++count >= 100) throw new AnalysisControlError('local_failure'); }
        finally { await parent.close(); }
      });
      const result = await prepareSession(library, id, { start_ms: action.start_ms, duration_ms: action.duration_ms });
      return { preparation_id: result.preparation_id, remote_upload: false };
    }
    if (action.action === 'report') {
      await createFindingsReport(library, id, action.preparation_id);
      return { preparation_id: action.preparation_id, remote_upload: false };
    }
    // Stop before any remote operation on reserved/failed/interrupted preparations.
    if (await stages(library, id, action.preparation_id, async run => run !== null)) throw new AnalysisControlError('already_started', 409);
    if (!keyConfigured(options.apiKey ?? process.env.MODEL_API_KEY)) throw new AnalysisControlError('credentials_missing');
    await analyzeSession(library, id, action.preparation_id, { ...options, upload_to_meta: true });
    active.set(id, { phase: 'reporting', preparation_id: action.preparation_id });
    await createFindingsReport(library, id, action.preparation_id);
    return { preparation_id: action.preparation_id, remote_upload: true };
  }, action.action === 'prepare' ? 'preparing' : action.action === 'report' ? 'reporting' : 'validating', action.action === 'prepare' ? null : action.preparation_id);
}

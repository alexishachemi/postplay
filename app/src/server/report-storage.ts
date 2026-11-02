import { constants } from 'node:fs';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SessionLibrary, openPackageChild, IngestionError } from './session-library.ts';
import { withPreparedSession, readPackageBytes } from './session-analysis.ts';
import { groundProposal, validateFindingsReport, REPORT_BYTES, type FindingsReport } from './findings-report.ts';
import { resultSchema, validateProposal } from './analysis-validation.ts';
import { MODEL, makeRequest, record } from './muse-api.ts';
import { projectAsset } from './project-assets.ts';

export class ReportError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
function requireReport(value: unknown, message: string): asserts value { if (!value) throw new ReportError('invalid_report_source', message); }
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
async function exists(directory: FileHandle, name: string): Promise<boolean> {
  try { const file = await openPackageChild(directory, name); await file.close(); return true; }
  catch (error) { if (error instanceof IngestionError && error.code === 'not_found') return false; throw error; }
}
async function save(directory: FileHandle, name: string, bytes: string): Promise<void> {
  const file = await open(`/proc/self/fd/${directory.fd}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await directory.sync();
}

/** Entirely offline: no fetch, API key, Godot editor or model service required.
 * Successful saved analysis stages, source hashes and report completion are all required. */
async function reportSession(library: SessionLibrary, id: string, preparationId: string, create: boolean): Promise<FindingsReport> {
  return await withPreparedSession(library, id, preparationId, 120000, async (source, prepared, input) => {
    const run = await openPackageChild(prepared, 'analysis', true);
    try {
      if (await exists(run, 'failure.json')) throw new ReportError('analysis_failed', 'Analysis failed; inspect failure.json. This is not a no-findings outcome');
      if (!await exists(run, 'completed.json')) throw new ReportError('analysis_incomplete', 'Analysis has no completion marker; preserve its stages and do not repeat inference automatically');
      const names = ['started.json', 'upload-attempt.json', 'upload.json', 'inference-attempt.json', 'request.json', 'response.json', 'proposal.json', 'api-result.json', 'cleanup.json', 'completed.json'];
      const data = new Map<string, { bytes: Buffer; value: Record<string, unknown> }>();
      for (const name of names) {
        const bytes = await readPackageBytes(run, name, name === 'response.json' || name === 'api-result.json' ? REPORT_BYTES : 262144);
        let value: unknown;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ReportError('invalid_report_source', 'Malformed saved analysis stage'); }
        requireReport(record(value), 'Saved analysis stage must be an object'); data.set(name, { bytes, value });
      }
      const stage = (name: string) => data.get(name + '.json')!.value;
      const started = stage('started'), done = stage('completed'), result = stage('api-result'), response = stage('response'), cleanup = stage('cleanup'), upload = stage('upload');
      requireReport(started.status === 'started' && started.analysis_version === '1' && started.session_id === id && started.preparation_id === preparationId && started.model === MODEL
        && started.data_use_mode === 'Standard' && started.remote_upload === true && started.prompt_version === '1' && started.schema_version === '1', 'Invalid analysis identity/version');
      requireReport(started.preparation_sha256 === hash(input.manifestBytes) && started.clip_sha256 === hash(input.video) && started.context_sha256 === hash(input.contextBytes), 'Analysis input provenance does not match prepared evidence');
      requireReport(done.status === 'validated_proposal' && done.analysis_version === '1' && result.status === 'validated_proposal' && result.analysis_version === '1'
        && result.model === MODEL && result.prompt_version === '1' && result.schema_version === '1', 'Invalid analysis completion/result');
      requireReport(response.status === 'completed' && (response.model === undefined || response.model === MODEL) && Array.isArray(response.output), 'Invalid saved model response');
      const texts: string[] = [];
      for (const item of response.output) if (record(item) && item.type === 'message' && Array.isArray(item.content)) for (const content of item.content) {
        requireReport(record(content) && content.type === 'output_text' && typeof content.text === 'string', 'Refused or malformed saved model content'); texts.push(content.text);
      }
      requireReport(texts.length === 1, 'Expected one saved structured response');
      let responseProposal: unknown;
      try { responseProposal = JSON.parse(texts[0]!); } catch { throw new ReportError('invalid_report_source', 'Saved model output is not JSON'); }
      const proposal = validateProposal(stage('proposal'), input.context);
      requireReport(isDeepStrictEqual(responseProposal, proposal) && isDeepStrictEqual(result.proposal, proposal) && done.findings_count === proposal.findings.length, 'Saved response/proposal/result disagree');
      requireReport(isDeepStrictEqual(result.usage, response.usage ?? null) && result.cost_usd === null && result.response_id === (typeof response.id === 'string' ? response.id.slice(0, 200) : null), 'Saved usage/response metadata disagree');
      requireReport(typeof started.started_at === 'string' && typeof done.completed_at === 'string' && (record(result.usage) || result.usage === null), 'Invalid saved analysis metadata');
      requireReport(typeof upload.id === 'string' && /^file[-_][a-zA-Z0-9_-]{1,200}$/.test(upload.id)
        && ['deleted', 'delete_failed', 'delete_unconfirmed'].includes(String(cleanup.status)) && cleanup.file_id === upload.id, 'Invalid upload cleanup provenance');
      const system = await readFile(projectAsset('ai/prompts/muse-analysis.v1.system.md'), 'utf8');
      const template = await readFile(projectAsset('ai/prompts/muse-analysis.v1.user.md'), 'utf8');
      requireReport(started.system_sha256 === hash(system) && started.user_template_sha256 === hash(template) && started.result_schema_sha256 === hash(JSON.stringify(resultSchema)), 'Unsupported or changed prompt/schema provenance');
      requireReport(isDeepStrictEqual(stage('request'), makeRequest(input.context, upload.id, system, template)), 'Saved request does not match the analyzed evidence/prompt');
      const grounded = groundProposal(proposal, source.inspection.session, source.inspection.events, { source_start_ms: input.manifest.source_start_ms, duration_ms: input.manifest.clip_duration_ms, conversion_error_ms: input.manifest.conversion_error_ms });
      const makeReport = (createdAt: string): FindingsReport => validateFindingsReport({ schema_version: '1', policy_version: '1', session_id: id, preparation_id: preparationId, created_at: createdAt,
        status: grounded.findings.length ? 'analyzed_with_findings' : grounded.quarantined.length ? 'needs_review' : 'analyzed_no_findings',
        analysis: { model: MODEL, prompt_version: '1', schema_version: '1', started_at: started.started_at, completed_at: done.completed_at,
          response_id: result.response_id, usage: result.usage, cost_usd: null, cleanup_status: cleanup.status },
        provenance: { source_manifest_sha256: input.manifest.source_manifest_sha256, source_events_sha256: input.manifest.source_events_sha256, source_video_sha256: input.manifest.source_video_sha256,
          preparation_sha256: hash(input.manifestBytes), context_sha256: hash(input.contextBytes), clip_sha256: hash(input.video),
          response_sha256: hash(data.get('response.json')!.bytes), proposal_sha256: hash(data.get('proposal.json')!.bytes), request_sha256: hash(data.get('request.json')!.bytes),
          stages_sha256: hash(JSON.stringify(names.map(name => [name, hash(data.get(name)!.bytes)]))),
          system_sha256: started.system_sha256, user_template_sha256: started.user_template_sha256, result_schema_sha256: started.result_schema_sha256,
          video_path: `preparations/${preparationId}/clip.mp4`, events_path: 'events.jsonl' },
        timing: { source_start_ms: input.manifest.source_start_ms, clip_duration_ms: input.manifest.clip_duration_ms, synchronization: input.context.session.synchronization }, ...grounded });
      if (await exists(run, 'report-completed.json')) {
        const bytes = await readPackageBytes(run, 'findings.json', REPORT_BYTES);
        const marker: unknown = JSON.parse((await readPackageBytes(run, 'report-completed.json', 4096)).toString('utf8'));
        requireReport(record(marker) && marker.schema_version === '1' && marker.findings_sha256 === hash(bytes), 'Report completion hash mismatch');
        const saved = validateFindingsReport(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        requireReport(isDeepStrictEqual(saved, makeReport(saved.created_at)), 'Saved report no longer matches source evidence or analysis stages');
        return saved;
      }
      if (!create) throw new ReportError('report_missing', 'No completed findings report; create it locally from the saved analysis first');
      if (await exists(run, 'findings.json')) throw new ReportError('report_incomplete', 'Unmarked findings.json exists; preserve it for inspection, do not overwrite or repeat inference');
      const report = makeReport(new Date().toISOString());
      const serialized = JSON.stringify(report) + '\n';
      requireReport(Buffer.byteLength(serialized) <= REPORT_BYTES, 'Report exceeds storage byte limit');
      requireReport(!process.env.MODEL_API_KEY || !serialized.includes(process.env.MODEL_API_KEY), 'Report contains the loaded credential; remove sensitive instrumentation before analysis');
      await source.assertUnchanged();
      await save(run, 'findings.json', serialized);
      await save(run, 'report-completed.json', JSON.stringify({ schema_version: '1', findings_sha256: hash(serialized) }) + '\n');
      return report;
    } finally { await run.close(); }
  });
}

export const createFindingsReport = (library: SessionLibrary, id: string, preparationId: string) => reportSession(library, id, preparationId, true);
export const loadFindingsReport = (library: SessionLibrary, id: string, preparationId: string) => reportSession(library, id, preparationId, false);

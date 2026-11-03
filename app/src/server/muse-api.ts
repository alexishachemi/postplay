// Shared server-only Meta adapter; never import from browser components.
import { resultSchema, validateContext, validateProposal } from './analysis-validation.ts';
import { PREPARATION_LIMITS } from './preparation-context.ts';

export const MODEL = 'muse-spark-1.3';
export const API_LIMITS = Object.freeze({ video_bytes: 20_000_000, context_bytes: 96_000, response_bytes: 512 * 1024, timeout_ms: 180_000, max_output_tokens: 4096 });
export class ModelError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Explicit server-side override only; default/browsing never increases spend. */
export function outputTokenLimit(value: unknown = API_LIMITS.max_output_tokens): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 512 || value > 8192) throw new ModelError('analysis_limit', 'Output token allowance must be 512–8192');
  return value;
}
export function makeRequest(context: unknown, fileId: string, system: string, userTemplate: string, maxOutputTokens: number = API_LIMITS.max_output_tokens) {
  validateContext(context);
  return {
    model: MODEL, store: false, max_output_tokens: outputTokenLimit(maxOutputTokens),
    input: [
      { role: 'system', content: [{ type: 'input_text', text: system }] },
      { role: 'user', content: [
        { type: 'input_text', text: userTemplate.replace('{{ANALYSIS_CONTEXT_JSON}}', () => JSON.stringify(context)) },
        { type: 'input_file', file_id: fileId },
      ] },
    ],
    text: { format: { type: 'json_schema', name: 'postplay_muse_result_v1', schema: resultSchema, strict: true } },
  };
}

type Save = (name: string, value: unknown) => Promise<void>;
function metaClient(apiKey: string, save: Save, fetcher: typeof fetch = fetch) {
  return async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetcher(`https://api.meta.ai/v1${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(API_LIMITS.timeout_ms),
        headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
      });
    } catch { throw new ModelError('transport_unknown', `Meta transport failed during ${init.method} ${path.split('/')[1]}; outcome may be unknown; inspect run before retrying`); }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      if (Number(response.headers.get('content-length')) > API_LIMITS.response_bytes) throw new ModelError('response_limit', 'Meta response exceeds byte limit');
      if (reader) for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > API_LIMITS.response_bytes) throw new ModelError('response_limit', 'Meta response exceeds byte limit');
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (error instanceof ModelError) throw error;
      throw new ModelError('transport_unknown', 'Meta response body interrupted; outcome may be unknown');
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { body = null; }
    if (!response.ok) {
      const detail = record(body) && record(body.error) ? body.error : {};
      const quota = typeof detail.code === 'string' && /quota|credit|balance|billing/i.test(detail.code);
      const code = response.status === 401 || response.status === 403 ? 'authentication_failed' : response.status === 402 || quota ? 'credit_exhausted' : response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'service_unavailable' : 'http_error';
      await save(`http-error-${init.method}-${path.split('/')[1]}.json`, {
        status: response.status, code,
      });
      throw new ModelError(code, `Meta HTTP ${response.status} during ${init.method} ${path.split('/')[1]}`);
    }
    if (!record(body)) throw new ModelError('invalid_response', 'Invalid Meta response envelope');
    return body;
  };
}

/** Cleanup-only operation: never uploads or invokes inference. */
export async function cleanupUpload(options: { apiKey: string; fileId: string; save: Save; fetcher?: typeof fetch }) {
  if (!options.apiKey || /[\r\n]/.test(options.apiKey)) throw new ModelError('credentials_missing', 'A valid MODEL_API_KEY is required');
  if (!/^file[-_][a-zA-Z0-9_-]{1,200}$/.test(options.fileId)) throw new ModelError('invalid_id', 'Invalid remote upload ID');
  const call = metaClient(options.apiKey, options.save, options.fetcher);
  try {
    const deleted = await call(`/files/${encodeURIComponent(options.fileId)}`, { method: 'DELETE' });
    return { status: deleted.deleted === true ? 'deleted' : 'delete_unconfirmed', file_id: options.fileId };
  } catch { return { status: 'delete_failed', file_id: options.fileId, expiry_requested_seconds: 3600 }; }
}

/** One inference attempt. Persist stages before non-idempotent requests; never retry automatically. */
export async function analyzeMuse(options: {
  apiKey: string; video: Uint8Array; context: unknown; system: string; userTemplate: string;
  save: Save; fetcher?: typeof fetch; max_duration_ms?: number; max_output_tokens?: number;
}) {
  const { apiKey, save } = options;
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new ModelError('credentials_missing', 'A valid MODEL_API_KEY is required');
  const context = validateContext(options.context);
  const maxOutputTokens = outputTokenLimit(options.max_output_tokens);
  const maximum = options.max_duration_ms ?? 30_000;
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > PREPARATION_LIMITS.duration_ms || options.video.byteLength === 0 || options.video.byteLength > API_LIMITS.video_bytes || context.session.duration_ms > maximum || Buffer.byteLength(JSON.stringify(context)) > API_LIMITS.context_bytes) throw new ModelError('analysis_limit', 'Analysis media/context cap exceeded');
  if (!options.system.trim() || options.userTemplate.split('{{ANALYSIS_CONTEXT_JSON}}').length !== 2) throw new ModelError('invalid_prompt', 'Expected a system prompt and exactly one context placeholder');
  const call = metaClient(apiKey, save, options.fetcher);
  let fileId: string | undefined;
  let cleanup: unknown = { status: 'not_uploaded' };
  try {
    await save('upload-attempt.json', { started_at: new Date().toISOString(), expiry_seconds: 3600 });
    const form = new FormData();
    form.append('purpose', 'user_data');
    form.append('expires_after[anchor]', 'created_at');
    form.append('expires_after[seconds]', '3600');
    form.append('file', new Blob([new Uint8Array(options.video)], { type: 'video/mp4' }), 'gameplay.mp4');
    cleanup = { status: 'upload_not_confirmed', expiry_requested_seconds: 3600 };
    const upload = await call('/files', { method: 'POST', body: form });
    if (typeof upload.id !== 'string' || !/^file[-_][a-zA-Z0-9_-]{1,200}$/.test(upload.id)) throw new ModelError('invalid_response', 'Invalid upload file ID');
    fileId = upload.id;
    await save('upload.json', { id: fileId, expires_at: upload.expires_at ?? null, bytes: upload.bytes ?? null });
    const request = makeRequest(context, fileId, options.system, options.userTemplate, maxOutputTokens);
    await save('request.json', request);
    await save('inference-attempt.json', { started_at: new Date().toISOString(), model: MODEL, retries: 0 });
    const response = await call('/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    await save('response.json', response);
    if (response.status !== 'completed' || !Array.isArray(response.output)) throw new ModelError('model_incomplete', 'Meta response incomplete or failed');
    if (response.model !== undefined && response.model !== MODEL) throw new ModelError('invalid_response', 'Unexpected response model');
    const texts: string[] = [];
    for (const item of response.output) {
      if (!record(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (!record(content) || content.type !== 'output_text' || typeof content.text !== 'string') throw new ModelError('model_refused', 'Unexpected or refused model content');
        texts.push(content.text);
      }
    }
    if (texts.length !== 1) throw new ModelError('invalid_response', 'Expected one structured model response');
    let proposal: unknown;
    try { proposal = JSON.parse(texts[0]!); } catch { throw new ModelError('invalid_proposal', 'Model output is not JSON'); }
    await save('proposal.json', proposal);
    let validated;
    try { validated = validateProposal(proposal, context); } catch { throw new ModelError('invalid_proposal', 'Model proposal failed local schema/evidence validation'); }
    await save('api-result.json', { analysis_version: '1', status: 'validated_proposal', model: MODEL, prompt_version: '1', schema_version: '1',
      response_id: typeof response.id === 'string' ? response.id.slice(0, 200) : null,
      usage: response.usage ?? null, cost_usd: null, cost_note: 'No monetary cost returned; inspect Meta billing. Token usage is not a dollar estimate.', proposal,
      limitation: 'Contract-valid proposal only; not an evidence-reviewed findings.json report.' });
    return validated;
  } finally {
    if (fileId) cleanup = await cleanupUpload({ apiKey, fileId, save, fetcher: options.fetcher });
    await save('cleanup.json', cleanup);
  }
}

/** Compatibility wrapper for the measured M0 excerpt, not a portable-session loader. */
export async function analyzeSmoke(options: Parameters<typeof analyzeMuse>[0]) {
  return await analyzeMuse({ ...options, max_duration_ms: 30_050, save: async (name, value) => {
    await options.save(name, value);
    if (name === 'api-result.json') await options.save('validated.json', { ...(value as object), schema_version: 'smoke-1',
      limitation: 'M0 compatibility smoke only; proposed claims still need human evidence review, not an M2 saved report.' });
  } });
}

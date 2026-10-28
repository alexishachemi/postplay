import { resultSchema, validateContext, validateProposal } from './analysis-validation.ts';

export const MODEL = 'muse-spark-1.3';
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function makeRequest(context: unknown, fileId: string, system: string, userTemplate: string) {
  validateContext(context);
  return {
    model: MODEL, store: false, max_output_tokens: 4096,
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

/** One inference attempt. Persist stages before non-idempotent requests; never retry automatically. */
export async function analyzeSmoke(options: {
  apiKey: string; video: Uint8Array; context: unknown; system: string; userTemplate: string;
  save: (name: string, value: unknown) => Promise<void>;
  fetcher?: typeof fetch;
}) {
  const { apiKey, save } = options;
  if (!apiKey) throw new Error('MODEL_API_KEY is required');
  const context = validateContext(options.context);
  if (options.video.byteLength > 20_000_000 || context.session.duration_ms > 30_050 || new TextEncoder().encode(JSON.stringify(context)).byteLength > 96_000) throw new Error('Smoke media/context cap exceeded');
  const fetcher = options.fetcher ?? fetch;
  async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetcher(`https://api.meta.ai/v1${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(180_000),
        headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
      });
    } catch { throw new Error(`Meta transport failed during ${init.method} ${path.split('/')[1]}; outcome may be unknown; inspect run before retrying`); }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = record(body) && record(body.error) ? body.error : {};
      await save(`http-error-${init.method}-${path.split('/')[1]}.json`, {
        status: response.status,
        code: typeof detail.code === 'string' ? detail.code.slice(0, 100) : null,
        param: typeof detail.param === 'string' ? detail.param.slice(0, 100) : null,
        message: typeof detail.message === 'string' ? detail.message.split(apiKey).join('[REDACTED]').slice(0, 500) : null,
      });
      throw new Error(`Meta HTTP ${response.status} during ${init.method} ${path.split('/')[1]}`);
    }
    const value: unknown = await response.json();
    if (!record(value)) throw new Error('Invalid Meta response envelope');
    return value;
  }
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
    if (typeof upload.id !== 'string' || !/^file[-_][a-zA-Z0-9_-]+$/.test(upload.id)) throw new Error('Invalid upload file ID');
    fileId = upload.id;
    await save('upload.json', { id: fileId, expires_at: upload.expires_at ?? null, bytes: upload.bytes ?? null });
    const request = makeRequest(context, fileId, options.system, options.userTemplate);
    await save('request.json', request);
    await save('inference-attempt.json', { started_at: new Date().toISOString(), model: MODEL, retries: 0 });
    const response = await call('/responses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    await save('response.json', response);
    if (response.status !== 'completed' || !Array.isArray(response.output)) throw new Error('Meta response incomplete or failed');
    const texts: string[] = [];
    for (const item of response.output) {
      if (!record(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (!record(content) || content.type !== 'output_text' || typeof content.text !== 'string') throw new Error('Unexpected or refused model content');
        texts.push(content.text);
      }
    }
    if (texts.length !== 1) throw new Error('Expected one structured model response');
    const proposal: unknown = JSON.parse(texts[0]!);
    await save('proposal.json', proposal);
    const validated = validateProposal(proposal, context);
    await save('validated.json', { schema_version: 'smoke-1', status: 'validated_proposal', model: MODEL, prompt_version: '1', usage: response.usage ?? null, proposal,
      limitation: 'M0 compatibility smoke only; proposed claims still need human evidence review, not an M2 saved report.' });
    return validated;
  } finally {
    if (fileId) {
      try {
        const deleted = await call(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
        cleanup = deleted.deleted === true ? { status: 'deleted', file_id: fileId } : { status: 'delete_unconfirmed', file_id: fileId };
      } catch { cleanup = { status: 'delete_failed', file_id: fileId, expiry_requested_seconds: 3600 }; }
    }
    await save('cleanup.json', cleanup);
  }
}

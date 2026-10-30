import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeMuse, cleanupUpload, API_LIMITS, ModelError } from '../src/server/muse-api.ts';
import { validateContext } from '../src/server/analysis-validation.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../ai/examples/${name}.json`, import.meta.url), 'utf8'));
const clean = fixture('muse-result.clean.example');
const envelope = () => ({ id: 'resp-fixture', model: 'muse-spark-1.3', status: 'completed', usage: { input_tokens: 15, output_tokens: 8, total_tokens: 23 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(clean) }] }] });
function options(fetcher: typeof fetch) {
  const saves = new Map<string, unknown>();
  return { apiKey: 'fixture-sensitive-key', video: new Uint8Array([1]), context: validateContext(fixture('analysis-input.example')), system: 'System fixture',
    userTemplate: '{{ANALYSIS_CONTEXT_JSON}}', max_duration_ms: 42_000, fetcher, save: async (name: string, value: unknown) => { saves.set(name, value); }, saves };
}
function client(inference: () => Response | Promise<Response>, calls: string[]): typeof fetch {
  return async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(`${init?.method} ${path}`);
    assert.equal(init?.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer fixture-sensitive-key');
    if (init.method === 'DELETE') return Response.json({ deleted: true });
    if (path === '/v1/files') {
      const form = init.body as FormData;
      assert.equal(form.get('purpose'), 'user_data'); assert.equal(form.get('expires_after[seconds]'), '3600');
      assert.equal((form.get('file') as File).name, 'gameplay.mp4');
      return Response.json({ id: 'file-fixture', expires_at: 123456 });
    }
    const request = JSON.parse(String(init.body));
    assert.equal(request.store, false); assert.equal(request.max_output_tokens, 4096); assert.equal(request.model, 'muse-spark-1.3');
    return await inference();
  };
}

test('shared Muse adapter records contract-valid empty proposals, usage and honest unknown cost', async () => {
  const calls: string[] = []; const o = options(client(() => Response.json(envelope()), calls));
  assert.equal((await analyzeMuse(o)).findings.length, 0);
  const result = o.saves.get('api-result.json') as Record<string, unknown>;
  assert.equal(result.status, 'validated_proposal'); assert.equal(result.cost_usd, null);
  assert.deepEqual(result.usage, envelope().usage);
  assert.equal(o.saves.has('validated.json'), false); assert.equal(o.saves.has('findings.json'), false);
  assert.deepEqual(calls, ['POST /v1/files', 'POST /v1/responses', 'DELETE /v1/files/file-fixture']);
});

for (const [status, apiCode, expected] of [[401, 'bad_key', 'authentication_failed'], [402, 'balance', 'credit_exhausted'], [429, 'insufficient_quota', 'credit_exhausted'], [429, 'rate_limit', 'rate_limited'], [503, 'busy', 'service_unavailable']] as const) {
  test(`HTTP ${status}/${apiCode} stays ${expected}, never empty success or retry`, async () => {
    const calls: string[] = []; const o = options(client(() => Response.json({ error: { code: apiCode, message: 'fixture-sensitive-key must never be logged' } }, { status }), calls));
    await assert.rejects(analyzeMuse(o), (error: unknown) => error instanceof ModelError && error.code === expected);
    assert.equal(o.saves.has('api-result.json'), false);
    assert.ok(!JSON.stringify([...o.saves]).includes('fixture-sensitive-key'));
    assert.equal(calls.filter(c => c.includes('/responses')).length, 1);
    assert.equal(calls.at(-1), 'DELETE /v1/files/file-fixture');
  });
}

test('oversized advertised and streamed bodies are bounded before parsing, cleanup still happens', async () => {
  for (const response of [new Response('{}', { headers: { 'content-length': String(API_LIMITS.response_bytes + 1) } }),
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(API_LIMITS.response_bytes)); controller.enqueue(new Uint8Array(1)); controller.close(); } }))]) {
    const calls: string[] = []; const o = options(client(() => response, calls));
    await assert.rejects(analyzeMuse(o), (e: unknown) => e instanceof ModelError && e.code === 'response_limit');
    assert.equal(o.saves.has('response.json'), false); assert.equal(calls.at(-1), 'DELETE /v1/files/file-fixture');
  }
});

test('transport uncertainty, refusal, incomplete and invalid proposals remain distinct failures', async () => {
  const refused = envelope(); refused.output[0]!.content[0]!.type = 'refusal';
  const incomplete = envelope(); incomplete.status = 'incomplete';
  const invalid = envelope(); invalid.output[0]!.content[0]!.text = '{"findings":[]}';
  for (const [fn, expected] of [[() => { throw new Error('fixture-sensitive-key'); }, 'transport_unknown'], [() => Response.json(refused), 'model_refused'], [() => Response.json(incomplete), 'model_incomplete'], [() => Response.json(invalid), 'invalid_proposal']] as const) {
    const calls: string[] = []; const o = options(client(fn, calls));
    await assert.rejects(analyzeMuse(o), (e: unknown) => e instanceof ModelError && e.code === expected);
    assert.equal(o.saves.has('api-result.json'), false); assert.equal(calls.at(-1), 'DELETE /v1/files/file-fixture');
  }
});

test('failed upload never reaches inference, keeps unknown upload state; cleanup-only cannot invoke inference', async () => {
  let calls = 0;
  const o = options(async () => { calls++; throw new Error('fixture-sensitive-key'); });
  await assert.rejects(analyzeMuse(o), /outcome may be unknown/);
  assert.equal(calls, 1); assert.equal(o.saves.has('inference-attempt.json'), false);
  assert.deepEqual(o.saves.get('cleanup.json'), { status: 'upload_not_confirmed', expiry_requested_seconds: 3600 });
  const deleted = await cleanupUpload({ apiKey: 'fixture-sensitive-key', fileId: 'file-fixture', save: async () => {}, fetcher: async (url, init) => {
    assert.equal(init?.method, 'DELETE'); assert.ok(String(url).endsWith('/files/file-fixture')); return Response.json({ deleted: true });
  } });
  assert.equal(deleted.status, 'deleted');
  await assert.rejects(cleanupUpload({ apiKey: 'fixture', fileId: '../responses', save: async () => {} }), /upload ID/);
});

test('duration, media, key and prompt guards fail before upload', async () => {
  let calls = 0; const o = options(async () => { calls++; return Response.json({}); });
  for (const changed of [{ max_duration_ms: 1 }, { max_duration_ms: 120001 }, { video: new Uint8Array(20_000_001) }, { video: new Uint8Array() }, { apiKey: '' }, { userTemplate: 'no placeholder' }]) await assert.rejects(analyzeMuse({ ...o, ...changed }));
  assert.equal(calls, 0);
});

test('stage persistence precedes requests; a failed inference checkpoint prevents spending', async () => {
  const calls: string[] = []; const o = options(client(() => Response.json(envelope()), calls));
  const save = o.save;
  o.save = async (name, value) => {
    if (name === 'inference-attempt.json') throw new Error('Fixture disk full');
    await save(name, value);
  };
  await assert.rejects(analyzeMuse(o), /disk full/);
  assert.deepEqual(calls, ['POST /v1/files', 'DELETE /v1/files/file-fixture']);
  assert.equal(o.saves.has('api-result.json'), false);
});

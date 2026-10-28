import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSmoke, makeRequest } from '../src/server/meta-smoke.ts';
import { validateContext, validateProposal } from '../src/server/analysis-validation.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../ai/examples/${name}`, import.meta.url), 'utf8'));
const context = validateContext(fixture('analysis-input.example.json'));
const clean = fixture('muse-result.clean.example.json');
const finding = fixture('muse-result.finding.example.json');
test('approved finding and empty fixtures validate; invalid schema/references/times fail', () => {
  validateProposal(clean, context);
  validateProposal(finding, context);
  assert.throws(() => validateProposal({ findings: [] }, context), /schema/);
  for (const mutation of [
    (r: typeof finding) => { r.findings[0].start_ms = 999999; },
    (r: typeof finding) => { r.findings[0].evidence = []; },
    (r: typeof finding) => { r.findings[0].evidence[0].event_id = 'missing'; },
    (r: typeof finding) => { r.findings[0].expected_source_ref = 'missing'; },
    (r: typeof finding) => { r.findings.push(structuredClone(r.findings[0])); },
    (r: typeof finding) => { r.findings[0].certainty = 'high'; },
  ]) {
    const value = structuredClone(finding);
    mutation(value);
    assert.throws(() => validateProposal(value, context));
  }
  const badContext = structuredClone(context);
  badContext.events.reverse();
  assert.throws(() => validateContext(badContext), /time/);
});
test('request uses Standard model, same user message, strict Responses format and no response storage', () => {
  const request = makeRequest(context, 'file-fixture', 'SYSTEM', '{{ANALYSIS_CONTEXT_JSON}}');
  assert.equal(request.model, 'muse-spark-1.3');
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input[1]?.content.length, 2);
  assert.equal(JSON.stringify(request).includes('response_format'), false);
});
const shortContext = () => {
  const value = structuredClone(context);
  value.session.duration_ms = 30000;
  value.session.video_window.end_ms = 30000;
  return value;
};
test('mock upload + response saves a validated empty proposal and deletes upload', async () => {
  const saves = new Map<string, unknown>();
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(`${init?.method} ${path}`);
    if (path === '/v1/files') {
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get('expires_after[seconds]'), '3600');
      return Response.json({ id: 'file-fixture', expires_at: 123 });
    }
    if (init?.method === 'DELETE') return Response.json({ deleted: true });
    return Response.json({ status: 'completed', usage: { input_tokens: 42, output_tokens: 12 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(clean) }] }] });
  };
  const result = await analyzeSmoke({ apiKey: 'fixture-key', context: shortContext(), video: new Uint8Array([1]), system: 'system', userTemplate: '{{ANALYSIS_CONTEXT_JSON}}', fetcher, save: async (name, value) => { saves.set(name, value); } });
  assert.equal(result.findings.length, 0);
  assert.ok(saves.has('validated.json'));
  assert.deepEqual(saves.get('cleanup.json'), { status: 'deleted', file_id: 'file-fixture' });
  assert.deepEqual(calls, ['POST /v1/files', 'POST /v1/responses', 'DELETE /v1/files/file-fixture']);
});
for (const failure of ['http', 'incomplete', 'invalid-json', 'cleanup']) {
  test(`mock ${failure} outcome remains truthful and inference is never retried`, async () => {
    const saves = new Map<string, unknown>();
    let inferenceCount = 0;
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/files')) return Response.json({ id: 'file-fixture' });
      if (init?.method === 'DELETE') return failure === 'cleanup' ? new Response(null, { status: 503 }) : Response.json({ deleted: true });
      inferenceCount++;
      if (failure === 'http') return new Response(null, { status: 401 });
      return Response.json({ status: failure === 'incomplete' ? 'incomplete' : 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: failure === 'invalid-json' ? '{}' : JSON.stringify(clean) }] }] });
    };
    const promise = analyzeSmoke({ apiKey: 'fixture-key', context: shortContext(), video: new Uint8Array([1]), system: 'system', userTemplate: '{{ANALYSIS_CONTEXT_JSON}}', fetcher, save: async (name, value) => { saves.set(name, value); } });
    if (failure === 'cleanup') {
      await promise;
      assert.deepEqual(saves.get('cleanup.json'), { status: 'delete_failed', file_id: 'file-fixture', expiry_requested_seconds: 3600 });
    } else {
      await assert.rejects(promise);
      assert.equal(saves.has('validated.json'), false);
      assert.deepEqual(saves.get('cleanup.json'), { status: 'deleted', file_id: 'file-fixture' });
    }
    assert.equal(inferenceCount, 1);
  });
}
test('caps and missing credentials prevent any remote request', async () => {
  let calls = 0;
  const options = { apiKey: '', context: shortContext(), video: new Uint8Array([1]), system: '', userTemplate: '', fetcher: async () => { calls++; return Response.json({}); }, save: async () => {} };
  await assert.rejects(analyzeSmoke(options), /MODEL_API_KEY/);
  await assert.rejects(analyzeSmoke({ ...options, apiKey: 'fixture-key', video: new Uint8Array(20_000_001) }), /cap/);
  assert.equal(calls, 0);
});

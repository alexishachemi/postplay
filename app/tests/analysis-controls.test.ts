import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

// Execute the actual Astro client script with a small DOM/transport fixture.
// These are UI failure regressions, not real model or video evidence.
const component = readFileSync(new URL('../src/components/AnalysisControls.astro', import.meta.url), 'utf8');
const script = transpileModule(component.split('<script>')[1]!.split('</script>')[0]!, {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
}).outputText;

function harness(fetcher: typeof fetch) {
  const controls = [{ disabled: false }, { disabled: false }, { disabled: true }];
  let focused = false, scrolled = false, reloads = 0;
  const status = { textContent: '', append() {}, focus() { focused = true; }, scrollIntoView() { scrolled = true; } };
  const listeners = new Map<string, (event: object) => void>();
  const start = { valueAsNumber: 0 }, duration = { valueAsNumber: 30 };
  const form = (name: string) => ({
    addEventListener(_type: string, listener: (event: object) => void) { listeners.set(name, listener); },
    querySelector(selector: string) { return selector === '[name=start]' ? start : selector === '[name=duration]' ? duration : null; },
  });
  const prepare = form('prepare'), upload = form('analyze'), report = form('report');
  const section = {
    dataset: { endpoint: '/fixture/analysis', preparation: 'fixture-preparation', active: 'false' },
    querySelector(selector: string) {
      return ({ '[data-analysis-status]': status, '[data-prepare]': prepare, '[data-upload]': upload,
        '[data-report]': report, '[data-consent]': { checked: true } } as Record<string, object>)[selector];
    },
    querySelectorAll() { return controls; },
  };
  const timers = new Map<number, () => Promise<void>>(); let nextTimer = 0;
  runInNewContext(script, {
    document: { querySelectorAll: () => [section], createElement: () => ({}) },
    window: { location: { href: '/fixture', reload() { reloads++; } }, addEventListener() {} },
    fetch: fetcher,
    setTimeout(callback: () => Promise<void>) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  return {
    controls, status, start, duration, timers,
    get focused() { return focused; }, get scrolled() { return scrolled; }, get reloads() { return reloads; },
    submit(action = 'prepare') { listeners.get(action)!({ preventDefault() {}, currentTarget: prepare }); },
  };
}
const rejection = (code = 'synchronization_unknown', status = 422) => Response.json({ error: {
  code, message: 'Measure a visible-event synchronization anchor before analysis. Local video preview is still available.',
} }, { status });

test('local 422 preparation failure exposes error and restores only previously enabled controls; user can edit and retry', async () => {
  const requests: unknown[] = [];
  const h = harness(async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return rejection(); });
  h.submit(); h.submit();
  assert.ok(h.controls.every(control => control.disabled));
  await setImmediate();
  assert.equal(requests.length, 1);
  assert.match(h.status.textContent, /visible-event synchronization/);
  assert.deepEqual(h.controls.map(control => control.disabled), [false, false, true]);
  assert.ok(h.focused && h.scrolled);
  assert.equal(h.timers.size, 0); assert.equal(h.reloads, 0);
  h.start.valueAsNumber = 1; h.duration.valueAsNumber = 4; h.submit();
  await setImmediate();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], { action: 'prepare', start_ms: 1000, duration_ms: 4000, reviewed_previous_attempt: false });
});

test('remote errors, busy responses and ambiguous transport failures retain conservative locks and never retry', async () => {
  for (const scenario of [
    { action: 'analyze', response: () => Promise.resolve(rejection()) },
    { action: 'prepare', response: () => Promise.resolve(rejection('busy', 409)) },
    { action: 'prepare', response: () => Promise.resolve(rejection('local_failure', 500)) },
    { action: 'prepare', response: () => Promise.resolve(new Response('not JSON', { status: 422 })) },
    { action: 'prepare', response: () => Promise.reject(new Error('Connection lost')) },
  ]) {
    let calls = 0;
    const h = harness(async () => { calls++; return await scenario.response(); });
    h.submit(scenario.action); await setImmediate();
    assert.ok(h.controls.every(control => control.disabled));
    assert.equal(calls, 1); assert.ok(h.focused && h.scrolled); assert.equal(h.timers.size, 0);
  }
});

test('a poll already in flight cannot overwrite a completed preparation error or reload the form', async () => {
  let finishPost!: (response: Response) => void, finishPoll!: (response: Response) => void;
  const h = harness(async (_url, init) => await new Promise<Response>(resolve => {
    if (init?.method === 'POST') finishPost = resolve; else finishPoll = resolve;
  }));
  h.submit();
  const polling = [...h.timers.values()][0]!();
  finishPost(rejection()); await setImmediate();
  finishPoll(Response.json({ active: false, message: 'Select a clip' }));
  await polling;
  assert.match(h.status.textContent, /visible-event synchronization/);
  assert.equal(h.reloads, 0); assert.deepEqual(h.controls.map(control => control.disabled), [false, false, true]);
});

test('successful preparation reloads the saved state without prematurely unlocking controls', async () => {
  const h = harness(async () => Response.json({ preparation_id: 'fixture' }));
  h.submit(); await setImmediate();
  assert.equal(h.reloads, 1); assert.ok(h.controls.every(control => control.disabled));
});

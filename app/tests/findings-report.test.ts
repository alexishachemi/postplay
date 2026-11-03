import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { SessionLibrary } from '../src/server/session-library.ts';
import { prepareSession } from '../src/server/media-preparation.ts';
import { analyzeSession } from '../src/server/session-analysis.ts';
import { groundProposal, validateFindingsReport, type FindingsReport } from '../src/server/findings-report.ts';
import { createFindingsReport, loadFindingsReport } from '../src/server/report-storage.ts';
import { validateSessionPackage } from '../src/server/session-contract.ts';
import type { Proposal } from '../src/server/analysis-validation.ts';

const id = '11111111-1111-4111-8111-111111111111';
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const fixtureText = (name: string) => readFileSync(new URL(`../../contracts/fixtures/complete/${name}`, import.meta.url), 'utf8');
const raw = () => validateSessionPackage(JSON.parse(fixtureText('session.json')), fixtureText('events.jsonl'));
const clean = (): Proposal => ({ schema_version: '1', coverage_summary: 'Synthetic contract fixture only; not empirical model evidence', coverage_limitations: [], findings: [] });
function finding(): Proposal {
  const proposal = JSON.parse(readFileSync(new URL('../../ai/examples/muse-result.finding.example.json', import.meta.url), 'utf8')) as Proposal;
  proposal.coverage_summary = 'Synthetic candidate only, not a real recorded defect';
  const f = proposal.findings[0]!;
  f.start_ms = 500; f.end_ms = 600; f.expected_source = 'model_inference'; f.expected_source_ref = null;
  f.title = 'Fixture candidate'; f.observed_behavior = 'Unverified fixture description; inspect raw snapshots rather than trusting this text';
  f.expected_behavior = 'An explicitly inferred fixture expectation';
  f.evidence = [{ type: 'telemetry', event_id: 'evt-2', video_ms: null, observation: 'Unverified fixture position description' }, { type: 'video', event_id: null, video_ms: 500, observation: 'Unverified fixture video description' }];
  return proposal;
}
const timing = { source_start_ms: 0, duration_ms: 2000, conversion_error_ms: 1 };
const mediaRoot = mkdtempSync(join(tmpdir(), 'postplay-report-media-'));
const media = join(mediaRoot, 'fixture.avi');
execFileSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=30', '-t', '2', '-c:v', 'mjpeg', media]);
async function fixture(proposal: Proposal = clean(), failure = false, outputTokens = 4096) {
  const root = mkdtempSync(join(tmpdir(), 'postplay-report-')); const directory = join(root, id); mkdirSync(directory);
  const manifest = JSON.parse(fixtureText('session.json')); manifest.capture.width = 64; manifest.capture.height = 48;
  manifest.registrations[0].expected_behavior = 'Fixture developer expectation, not proof of a defect';
  writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest)); writeFileSync(join(directory, 'events.jsonl'), fixtureText('events.jsonl')); writeFileSync(join(directory, 'recording.avi'), readFileSync(media));
  const library = await SessionLibrary.create(root); const preparation = await prepareSession(library, id);
  const run = join(directory, preparation.relative_directory, 'analysis');
  const fetcher: typeof fetch = async (url, init) => {
    if (init?.method === 'DELETE') return Response.json({ deleted: true });
    if (String(url).endsWith('/files')) return Response.json({ id: 'file-fixture', expires_at: 123 });
    if (failure) return Response.json({ error: { code: 'bad_key' } }, { status: 401 });
    return Response.json({ id: 'resp-fixture', model: 'muse-spark-1.3', status: 'completed', usage: { input_tokens: 10, output_tokens: 3 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] });
  };
  const analysis = analyzeSession(library, id, preparation.preparation_id, { upload_to_meta: true, apiKey: 'fixture-sensitive-key', fetcher, max_output_tokens: outputTokens });
  if (failure) await assert.rejects(analysis); else await analysis;
  return { root, directory, library, preparation, run };
}
const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8'));

test('nondefault output allowance reopens offline while started/request caps must agree', async () => {
  const f = await fixture(clean(), false, 8192);
  try {
    const report = await createFindingsReport(f.library, id, f.preparation.preparation_id);
    assert.equal(json(join(f.run, 'request.json')).max_output_tokens, 8192);
    assert.equal(json(join(f.run, 'started.json')).max_output_tokens, 8192);
    assert.deepEqual(await loadFindingsReport(f.library, id, f.preparation.preparation_id), report);
    const started = json(join(f.run, 'started.json')); started.max_output_tokens = 4096;
    writeFileSync(join(f.run, 'started.json'), JSON.stringify(started));
    await assert.rejects(loadFindingsReport(f.library, id, f.preparation.preparation_id));
  } finally { await f.library.close(); }
});

test('grounding resolves original values and IDs without converting model descriptions into facts', () => {
  const { session, events } = raw(); const proposal = finding(); proposal.findings[0]!.evidence[0]!.observation = 'Invented x=999 in unverified prose';
  const grounded = groundProposal(proposal, session, events, timing);
  assert.equal(grounded.findings.length, 1); assert.equal(grounded.quarantined.length, 0);
  assert.deepEqual(grounded.evidence_snapshots, [{ event: events[1], clip_ms: 500 }]);
  assert.deepEqual(grounded.evidence_snapshots[0]!.event.payload, { type: 'Vector2', x: 160, y: 330 });
  assert.ok(grounded.findings[0]!.issues.includes('model_text_unverified'));
  assert.ok(grounded.findings[0]!.issues.includes('visual_claim_unverified'));
  assert.ok(grounded.findings[0]!.issues.includes('expected_behavior_inferred'));
  assert.ok(grounded.limitations.some(l => l.includes('unverified')));
  assert.equal(grounded.findings[0]!.model_claim.evidence[0]!.observation, 'Invented x=999 in unverified prose');
});

test('high certainty and unsupported evidence are quarantined, softlocks remain suspected', () => {
  const { session, events } = raw(); session.registrations[0]!.expected_behavior = 'Supplied fixture expectation';
  const high = finding(); const f = high.findings[0]!; f.certainty = 'high'; f.expected_source = 'developer_expectation'; f.expected_source_ref = 'reg-1'; f.category = 'softlock';
  const grounded = groundProposal(high, session, events, timing);
  assert.equal(grounded.findings.length, 0); assert.equal(grounded.quarantined[0]!.model_claim.certainty, 'high');
  assert.ok(grounded.quarantined[0]!.issues.includes('high_certainty_requires_review')); assert.ok(grounded.quarantined[0]!.issues.includes('suspected_softlock_only'));
  assert.equal(grounded.registrations[0]!.expected_behavior, 'Supplied fixture expectation');
  const unsupported = finding(); unsupported.findings[0]!.evidence[0]!.event_id = 'evt-3';
  assert.ok(groundProposal(unsupported, session, events, timing).quarantined[0]!.issues.includes('unsupported_evidence_values'));
});

test('missing IDs, out-of-window times and invented expectations are rejected, never synthesized', () => {
  const { session, events } = raw();
  for (const mutate of [(p: Proposal) => { p.findings[0]!.evidence[0]!.event_id = 'evt-999'; }, (p: Proposal) => { p.findings[0]!.start_ms = 2001; },
    (p: Proposal) => { p.findings[0]!.expected_source = 'developer_expectation'; p.findings[0]!.expected_source_ref = 'reg-1'; }]) {
    const p = finding(); mutate(p); assert.throws(() => groundProposal(p, session, events, timing));
  }
  assert.equal(groundProposal(clean(), session, events, timing).findings.length, 0);
});

test('saved candidate reopens offline, idempotent creation preserves bytes and original recordings', async () => {
  const f = await fixture(finding());
  const originals = ['session.json', 'events.jsonl', 'recording.avi'].map(name => sha(readFileSync(join(f.directory, name))));
  try {
    const created = await createFindingsReport(f.library, id, f.preparation.preparation_id);
    assert.equal(created.status, 'analyzed_with_findings'); assert.equal(created.findings.length, 1);
    assert.equal(created.findings[0]!.model_claim.certainty, 'medium');
    const before = readFileSync(join(f.run, 'findings.json'));
    const savedFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Network disabled in offline fixture'); };
    try { assert.deepEqual(await loadFindingsReport(f.library, id, f.preparation.preparation_id), created); }
    finally { globalThis.fetch = savedFetch; }
    assert.deepEqual(await createFindingsReport(f.library, id, f.preparation.preparation_id), created);
    assert.deepEqual(readFileSync(join(f.run, 'findings.json')), before);
    assert.equal(statSync(join(f.run, 'findings.json')).mode & 0o777, 0o600);
    assert.deepEqual(['session.json', 'events.jsonl', 'recording.avi'].map(name => sha(readFileSync(join(f.directory, name)))), originals);
    const script = new URL('../scripts/session-report.ts', import.meta.url).pathname;
    const output = spawnSync(process.execPath, [script, 'read', id, f.preparation.preparation_id], { encoding: 'utf8', env: { ...process.env, MODEL_API_KEY: '', POSTPLAY_SESSION_ROOT: f.root }, timeout: 20000 });
    assert.equal(output.status, 0); assert.deepEqual(JSON.parse(output.stdout), created);
    assert.ok(!output.stdout.includes(f.root) && !output.stdout.includes('fixture-sensitive-key'));
  } finally { await f.library.close(); }
});

test('valid empty reports, all-quarantined reports and failed analyses are different outcomes', async () => {
  const empty = await fixture(); const high = finding(); high.findings[0]!.certainty = 'high'; high.findings[0]!.expected_source = 'developer_expectation'; high.findings[0]!.expected_source_ref = 'reg-1';
  const review = await fixture(high); const failed = await fixture(clean(), true);
  try {
    assert.equal((await createFindingsReport(empty.library, id, empty.preparation.preparation_id)).status, 'analyzed_no_findings');
    const report = await createFindingsReport(review.library, id, review.preparation.preparation_id);
    assert.equal(report.status, 'needs_review'); assert.equal(report.findings.length, 0); assert.equal(report.quarantined.length, 1);
    await assert.rejects(createFindingsReport(failed.library, id, failed.preparation.preparation_id), /Analysis failed/);
    assert.ok(!existsSync(join(failed.run, 'findings.json')));
    const bad = structuredClone(report); bad.status = 'analyzed_no_findings'; assert.throws(() => validateFindingsReport(bad), /contradicts/);
  } finally { await empty.library.close(); await review.library.close(); await failed.library.close(); }
});

test('altered saved proposal, request, usage, completion or prompt hashes cannot produce a trusted report', async () => {
  for (const name of ['proposal', 'request', 'usage', 'completion', 'prompt', 'response'] as const) {
    const f = await fixture();
    try {
      const file = name === 'proposal' ? 'proposal.json' : name === 'request' ? 'request.json' : name === 'usage' ? 'api-result.json' : name === 'completion' ? 'completed.json' : name === 'prompt' ? 'started.json' : 'response.json';
      const value = json(join(f.run, file));
      if (name === 'proposal') value.coverage_summary = 'Fabricated replacement';
      if (name === 'request') value.store = true;
      if (name === 'usage') value.usage = { input_tokens: 999 };
      if (name === 'completion') value.findings_count = 99;
      if (name === 'prompt') value.system_sha256 = '0'.repeat(64);
      if (name === 'response') value.status = 'incomplete';
      writeFileSync(join(f.run, file), JSON.stringify(value));
      await assert.rejects(createFindingsReport(f.library, id, f.preparation.preparation_id));
      assert.ok(!existsSync(join(f.run, 'findings.json')));
    } finally { await f.library.close(); }
  }
});

test('corrupt or rehashed forged report values and paths are rejected on offline reopening', async () => {
  const f = await fixture(finding());
  try {
    const report = await createFindingsReport(f.library, id, f.preparation.preparation_id);
    const original = readFileSync(join(f.run, 'findings.json')); const marker = readFileSync(join(f.run, 'report-completed.json'));
    for (const mutate of [(r: FindingsReport) => { r.evidence_snapshots[0]!.event.payload = { type: 'Vector2', x: 999, y: 330 }; },
      (r: FindingsReport) => { r.provenance.video_path = '../../private.mp4'; }, (r: FindingsReport) => { r.findings[0]!.model_claim.evidence[0]!.event_id = 'evt-999'; }]) {
      const changed = structuredClone(report); mutate(changed); const bytes = JSON.stringify(changed) + '\n';
      writeFileSync(join(f.run, 'findings.json'), bytes); writeFileSync(join(f.run, 'report-completed.json'), JSON.stringify({ schema_version: '1', findings_sha256: sha(bytes) }));
      await assert.rejects(loadFindingsReport(f.library, id, f.preparation.preparation_id));
    }
    writeFileSync(join(f.run, 'findings.json'), original); writeFileSync(join(f.run, 'report-completed.json'), marker);
    assert.deepEqual(await loadFindingsReport(f.library, id, f.preparation.preparation_id), report);
    const altered = json(join(f.run, 'cleanup.json')); altered.status = 'delete_failed'; writeFileSync(join(f.run, 'cleanup.json'), JSON.stringify(altered));
    await assert.rejects(loadFindingsReport(f.library, id, f.preparation.preparation_id), /no longer matches/);
  } finally { await f.library.close(); }
});

test('partial report and symlink writes are not overwritten or interpreted as completed', async () => {
  for (const mode of ['partial', 'symlink'] as const) {
    const f = await fixture();
    try {
      if (mode === 'partial') writeFileSync(join(f.run, 'findings.json'), '{');
      else symlinkSync(join(mediaRoot, 'outside.json'), join(f.run, 'findings.json'));
      await assert.rejects(createFindingsReport(f.library, id, f.preparation.preparation_id));
      await assert.rejects(loadFindingsReport(f.library, id, f.preparation.preparation_id));
      assert.ok(!existsSync(join(f.run, 'report-completed.json'))); assert.ok(!existsSync(join(mediaRoot, 'outside.json')));
    } finally { await f.library.close(); }
  }
});

test('report schema rejects unknown fields, excessive recursion and unsupported high certainty', async () => {
  const f = await fixture(finding());
  try {
    const report = await createFindingsReport(f.library, id, f.preparation.preparation_id);
    assert.throws(() => validateFindingsReport({ ...report, unknown: true }), /schema/);
    const high = structuredClone(report); high.findings[0]!.model_claim.certainty = 'high'; assert.throws(() => validateFindingsReport(high), /cannot be accepted/);
    const cyclic = structuredClone(report); cyclic.analysis.usage = {}; cyclic.analysis.usage.self = cyclic.analysis.usage;
    assert.throws(() => validateFindingsReport(cyclic), /structural/);
    assert.ok(readdirSync(f.run).includes('report-completed.json'));
  } finally { await f.library.close(); }
});

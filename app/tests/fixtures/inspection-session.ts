// Synthetic UI fixture ONLY. Mocked model stages are not empirical inference.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { SessionLibrary } from '../../src/server/session-library.ts';
import { prepareSession } from '../../src/server/media-preparation.ts';
import { analyzeSession } from '../../src/server/session-analysis.ts';
import { createFindingsReport } from '../../src/server/report-storage.ts';
import type { Proposal } from '../../src/server/analysis-validation.ts';

export const inspectionOutcomes = ['populated', 'empty', 'quarantined', 'failed', 'malformed'] as const;
export type InspectionOutcome = typeof inspectionOutcomes[number];
export async function createInspectionFixture(root: string, outcome: InspectionOutcome = 'populated') {
  const id = randomUUID(), directory = join(root, id); mkdirSync(directory);
  const read = (name: string) => readFileSync(new URL(`../../../contracts/fixtures/complete/${name}`, import.meta.url), 'utf8');
  const manifest = JSON.parse(read('session.json')); manifest.session_id = id; manifest.project.name = 'SYNTHETIC INSPECTION FIXTURE — not real inference';
  manifest.capture.width = 64; manifest.capture.height = 48;
  manifest.registrations[0].expected_behavior = 'Fixture expectation <b>not a demonstrated defect</b>';
  writeFileSync(join(directory, 'session.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'events.jsonl'), read('events.jsonl').replaceAll('11111111-1111-4111-8111-111111111111', id));
  execFileSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=30', '-t', '2', '-c:v', 'mjpeg', join(directory, 'recording.avi')]);
  const proposal: Proposal = JSON.parse(readFileSync(new URL('../../../ai/examples/muse-result.finding.example.json', import.meta.url), 'utf8'));
  proposal.coverage_summary = 'SYNTHETIC UI fixture using mocked model stages. Not empirical bug-detection evidence.';
  const claim = proposal.findings[0]!;
  Object.assign(claim, { id: 'f-1"><script>globalThis.pwned=1</script>', title: 'Fixture position hypothesis <img src=x onerror="globalThis.pwned=1">',
    category: 'out_of_bounds', severity: 'high', certainty: 'medium', start_ms: 300, end_ms: 600, expected_source: 'model_inference', expected_source_ref: null,
    observed_behavior: 'UNVERIFIED MODEL CLAIM: x=999. Compare with recorded Vector2 x=160, y=330.', expected_behavior: 'An inferred fixture expectation, not a rule.',
    explanation: 'javascript:alert(1) and https://example.invalid are text, never executable links.', benign_alternatives: ['Synthetic benign explanation; no real defect is claimed.'], reproduction_steps: ['Unverified fixture suggestion, not demonstrated.'], limitations: ['Synthetic evidence only.'] });
  claim.evidence = [{ type: 'telemetry', event_id: 'evt-2', video_ms: null, observation: 'Unverified x=999 description' }, { type: 'video', event_id: null, video_ms: 600, observation: 'Unverified fixture video description' }];
  const high = structuredClone(claim);
  Object.assign(high, { id: 'fixture-quarantine', title: 'Fixture suspected softlock', category: 'softlock', severity: 'low', certainty: 'high', start_ms: 600, end_ms: 900, expected_source: 'developer_expectation', expected_source_ref: 'reg-1' });
  high.evidence[0]!.event_id = 'evt-3';
  const end = structuredClone(claim);
  Object.assign(end, { id: 'fixture-end', title: 'Fixture end-boundary reference', category: 'other_technical', start_ms: 1200, end_ms: null, benign_alternatives: [], reproduction_steps: [], limitations: [] });
  end.evidence = [{ type: 'video', event_id: null, video_ms: 1200, observation: 'End boundary, not a decoded frame.' }];
  proposal.findings.push(high, end);
  if (outcome === 'empty') proposal.findings = [];
  if (outcome === 'quarantined') proposal.findings = [high];
  const library = await SessionLibrary.create(root);
  try {
    const preparation = await prepareSession(library, id, { start_ms: 500, duration_ms: 1200 });
    const analysis = analyzeSession(library, id, preparation.preparation_id, { upload_to_meta: true, apiKey: 'synthetic-inspection-secret', fetcher: async (url, init) => {
      if (init?.method === 'DELETE') return Response.json({ deleted: true });
      if (outcome === 'failed') return Response.json({ error: { code: 'bad_key' } }, { status: 401 });
      if (String(url).endsWith('/files')) return Response.json({ id: 'file-synthetic-ui' });
      return Response.json({ status: 'completed', model: 'muse-spark-1.3', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] });
    } });
    if (outcome === 'failed') await assert.rejects(analysis); else await analysis;
    const report = outcome === 'failed' ? null : await createFindingsReport(library, id, preparation.preparation_id);
    if (outcome === 'malformed') writeFileSync(join(directory, 'preparations', preparation.preparation_id, 'analysis', 'findings.json'), '{');
    return { id, directory, preparation_id: preparation.preparation_id, report };
  } finally { await library.close(); }
}

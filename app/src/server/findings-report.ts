import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { normalizeContext, type ClipTiming } from './preparation-context.ts';
import { validateProposal, type Proposal } from './analysis-validation.ts';
import { validateSessionPackage, type Event, type Session, type SafeValue } from './session-contract.ts';

export interface Candidate { model_claim: Proposal['findings'][number]; issues: string[] }
export interface FindingsReport {
  schema_version: '1'; policy_version: '1'; session_id: string; preparation_id: string; created_at: string;
  status: 'analyzed_with_findings' | 'analyzed_no_findings' | 'needs_review';
  analysis: { model: 'muse-spark-1.3'; prompt_version: '1'; schema_version: '1'; started_at: string; completed_at: string; response_id: string | null; usage: Record<string, unknown> | null; cost_usd: number | null; cleanup_status: string };
  provenance: Record<'source_manifest_sha256' | 'source_events_sha256' | 'source_video_sha256' | 'preparation_sha256' | 'context_sha256' | 'clip_sha256' | 'response_sha256' | 'proposal_sha256' | 'request_sha256' | 'stages_sha256' | 'system_sha256' | 'user_template_sha256' | 'result_schema_sha256' | 'video_path' | 'events_path', string>;
  timing: { source_start_ms: number; clip_duration_ms: number; synchronization: { status: string; estimated_error_ms: number | null } };
  coverage_summary: string; limitations: string[]; findings: Candidate[]; quarantined: Candidate[];
  evidence_snapshots: { event: Event; clip_ms: number }[]; registrations: Session['registrations'];
}
const schema = (name: string) => JSON.parse(readFileSync(new URL(`../../../contracts/${name}.v1.schema.json`, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true });
for (const name of ['safe-value', 'session', 'event']) ajv.addSchema(schema(name));
for (const name of ['analysis-input', 'muse-result']) ajv.addSchema(JSON.parse(readFileSync(new URL(`../../../ai/schemas/${name}.v1.schema.json`, import.meta.url), 'utf8')), `https://postplay.local/contracts/${name}.v1`);
const validator = ajv.compile<FindingsReport>(schema('findings'));
export const REPORT_BYTES = 1024 * 1024;
function requireReport(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** Bounded, local-only schema validation. Source/stage integrity is checked by report storage. */
export function validateFindingsReport(value: unknown): FindingsReport {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    requireReport(++nodes <= 100000 && item.depth <= 24, 'Report JSON exceeds structural limits');
    if (typeof item.value === 'object' && item.value !== null) {
      for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 });
    }
  }
  requireReport(validator(value), 'Invalid findings report schema');
  requireReport(Buffer.byteLength(JSON.stringify(value)) <= REPORT_BYTES, 'Report exceeds byte limit');
  for (const date of [value.created_at, value.analysis.started_at, value.analysis.completed_at]) requireReport(Number.isFinite(Date.parse(date)) && new Date(date).toISOString() === date, 'Invalid report UTC timestamp');
  requireReport(Date.parse(value.analysis.completed_at) >= Date.parse(value.analysis.started_at), 'Invalid analysis date order');
  const expected = value.findings.length ? 'analyzed_with_findings' : value.quarantined.length ? 'needs_review' : 'analyzed_no_findings';
  requireReport(value.status === expected, 'Report status contradicts findings/quarantine');
  requireReport(value.provenance.video_path === `preparations/${value.preparation_id}/clip.mp4`, 'Invalid report video path');
  const ids = new Set<string>();
  const snapshots = new Map(value.evidence_snapshots.map(snapshot => [snapshot.event.id, snapshot]));
  requireReport(snapshots.size === value.evidence_snapshots.length, 'Duplicate evidence snapshot');
  for (const snapshot of value.evidence_snapshots) requireReport(snapshot.event.session_id === value.session_id && snapshot.clip_ms < value.timing.clip_duration_ms, 'Invalid evidence snapshot identity/time');
  for (const [quarantined, candidates] of [[false, value.findings], [true, value.quarantined]] as const) for (const candidate of candidates) {
    const finding = candidate.model_claim;
    requireReport(!ids.has(finding.id), 'Duplicate report finding ID'); ids.add(finding.id);
    requireReport(candidate.issues.includes('model_text_unverified'), 'Missing model interpretation warning');
    requireReport(quarantined || (finding.certainty !== 'high' && !candidate.issues.includes('unsupported_evidence_values')), 'Unsupported finding cannot be accepted');
    requireReport(finding.start_ms >= 0 && finding.start_ms <= value.timing.clip_duration_ms && (finding.end_ms === null || finding.end_ms >= finding.start_ms && finding.end_ms <= value.timing.clip_duration_ms), 'Invalid report finding time');
    requireReport(finding.evidence.length > 0, 'Missing report evidence');
    for (const evidence of finding.evidence) {
      if (evidence.type === 'telemetry') requireReport(evidence.event_id !== null && snapshots.has(evidence.event_id) && evidence.video_ms === null, 'Unresolved report event');
      else requireReport(evidence.event_id === null && evidence.video_ms !== null && evidence.video_ms >= 0 && evidence.video_ms <= value.timing.clip_duration_ms, 'Invalid report video evidence');
    }
    if (finding.expected_source === 'developer_expectation') requireReport(value.registrations.some(r => r.id === finding.expected_source_ref && r.expected_behavior?.trim()), 'Missing report expected-behavior source');
    else requireReport(finding.expected_source_ref === null, 'Unexpected report expected-behavior reference');
  }
  return value;
}
function unsupported(value: SafeValue): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(unsupported);
  return value.type === 'unsupported' || value.type === 'dictionary' && Object.values(value.entries).some(unsupported);
}

/** Resolve IDs/values deterministically, never infer defects from demo categories or prose. */
export function groundProposal(input: unknown, session: Session, events: Event[], timing: ClipTiming) {
  validateSessionPackage(session, events.map(event => JSON.stringify(event)).join('\n'));
  const context = normalizeContext(session, events, timing);
  const proposal = validateProposal(input, context);
  const raw = new Map(events.map(event => [event.id, event]));
  const referenced = new Set<string>(); const registrations = new Set<string>();
  const findings: Candidate[] = [], quarantined: Candidate[] = [];
  for (const finding of proposal.findings) {
    const issues = ['model_text_unverified'];
    if (context.coverage.truncated) issues.push('coverage_incomplete');
    if (context.session.synchronization.estimated_error_ms !== 0) issues.push('synchronization_uncertainty');
    if (finding.expected_source === 'model_inference') issues.push('expected_behavior_inferred');
    if (finding.expected_source === 'observed_precedent') issues.push('observed_precedent_unverified');
    if (finding.expected_source_ref) registrations.add(finding.expected_source_ref);
    if (finding.category === 'softlock') issues.push('suspected_softlock_only');
    if (finding.certainty === 'high') issues.push('high_certainty_requires_review');
    for (const evidence of finding.evidence) {
      if (evidence.type === 'video') issues.push('visual_claim_unverified');
      else {
        const event = raw.get(evidence.event_id!)!;
        referenced.add(event.id);
        if (event.registration_id) registrations.add(event.registration_id);
        if (unsupported(event.payload)) issues.push('unsupported_evidence_values');
      }
    }
    const candidate = { model_claim: structuredClone(finding), issues: [...new Set(issues)] };
    (finding.certainty === 'high' || issues.includes('unsupported_evidence_values') ? quarantined : findings).push(candidate);
  }
  return { findings, quarantined,
    evidence_snapshots: context.events.filter(event => referenced.has(event.id)).map(event => ({ event: structuredClone(raw.get(event.id)!), clip_ms: event.t_ms })),
    registrations: structuredClone(session.registrations.filter(r => registrations.has(r.id))),
    coverage_summary: proposal.coverage_summary,
    limitations: [...new Set(['Findings are model hypotheses, not demonstrated facts. Evidence snapshots are recorded values; model descriptions and reproduction steps are unverified.',
      'Video timestamps resolve to playable moments, not automatically verified visual observations. Suspected softlocks are not proven unrecoverable.',
      'High-certainty interpretations and unsupported evidence values are quarantined pending human review; no automatic semantic truth verifier is implemented.',
      'No supported findings is not proof of a bug-free game.', ...context.session.recording_notes, ...context.coverage.omissions, ...proposal.coverage_limitations])] };
}

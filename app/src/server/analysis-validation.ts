import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

export interface Context {
  contract_version: string;
  session: { session_id: string; duration_ms: number; video_window: { start_ms: number; end_ms: number }; synchronization: { status: string; estimated_error_ms: number | null }; recording_notes: string[] };
  registrations: { id: string; kind: string; source_label: string; description: string; expected_behavior: string | null }[];
  events: { id: string; t_ms: number; kind: string; registration_id: string | null; source_label: string; payload: Record<string, unknown> }[];
  coverage: { total_events: number; included_events: number; truncated: boolean; omissions: string[] };
}
export interface Proposal {
  schema_version: string;
  coverage_summary: string;
  coverage_limitations: string[];
  findings: {
    id: string; certainty: string; start_ms: number; end_ms: number | null;
    expected_source: string; expected_source_ref: string | null;
    evidence: { type: string; event_id: string | null; video_ms: number | null; observation: string }[];
  }[];
}
const ajv = new Ajv2020({ allErrors: true, strict: true });
export const resultSchema: object = JSON.parse(readFileSync(new URL('../../../ai/schemas/muse-result.v1.schema.json', import.meta.url), 'utf8'));
const inputSchema = JSON.parse(readFileSync(new URL('../../../ai/schemas/analysis-input.v1.schema.json', import.meta.url), 'utf8'));
const inputValidator = ajv.compile<Context>(inputSchema);
const resultValidator = ajv.compile<Proposal>(resultSchema);
function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function validateContext(value: unknown): Context {
  requireCondition(inputValidator(value), 'Invalid analysis context schema');
  const { start_ms: start, end_ms: end } = value.session.video_window;
  requireCondition(start <= end && end <= value.session.duration_ms, 'Invalid context video window');
  const ids = new Set<string>();
  const registrationIds = new Set(value.registrations.map(r => r.id));
  requireCondition(registrationIds.size === value.registrations.length, 'Duplicate registration ID');
  let previous = start;
  for (const event of value.events) {
    requireCondition(!ids.has(event.id), 'Duplicate event ID');
    ids.add(event.id);
    requireCondition(event.t_ms >= previous && event.t_ms <= end, 'Invalid event time/order');
    requireCondition(event.registration_id === null || registrationIds.has(event.registration_id), 'Unknown registration');
    previous = event.t_ms;
  }
  requireCondition(value.coverage.included_events === value.events.length && value.coverage.total_events >= value.events.length, 'Invalid coverage counts');
  return value;
}
export function validateProposal(value: unknown, context: Context): Proposal {
  requireCondition(resultValidator(value), 'Invalid Muse result schema');
  const eventIds = new Set(context.events.map(e => e.id));
  const ids = new Set<string>();
  const inWindow = (time: number) => time >= context.session.video_window.start_ms && time <= context.session.video_window.end_ms;
  for (const finding of value.findings) {
    requireCondition(!ids.has(finding.id), 'Duplicate finding ID');
    ids.add(finding.id);
    requireCondition(inWindow(finding.start_ms) && (finding.end_ms === null || (finding.end_ms >= finding.start_ms && inWindow(finding.end_ms))), 'Finding time outside window');
    if (finding.expected_source === 'developer_expectation') {
      requireCondition(context.registrations.some(r => r.id === finding.expected_source_ref && r.expected_behavior), 'Missing expected-behavior source');
    } else requireCondition(finding.expected_source_ref === null, 'Unexpected expected-behavior reference');
    requireCondition(finding.evidence.length > 0, 'Missing evidence');
    for (const evidence of finding.evidence) {
      if (evidence.type === 'telemetry') requireCondition(evidence.event_id !== null && eventIds.has(evidence.event_id) && evidence.video_ms === null, 'Invalid telemetry evidence');
      else requireCondition(evidence.event_id === null && evidence.video_ms !== null && inWindow(evidence.video_ms), 'Invalid video evidence');
    }
    if (finding.certainty === 'high') {
      requireCondition(finding.expected_source !== 'model_inference' && context.session.synchronization.status !== 'unknown' && new Set(finding.evidence.map(e => e.type)).size === 2, 'High-certainty proposal needs sourced cross-modal support');
    }
  }
  return value;
}

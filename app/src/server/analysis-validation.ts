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
    id: string; category: 'ui_state_mismatch' | 'out_of_bounds' | 'softlock' | 'other_technical';
    title: string; severity: 'low' | 'medium' | 'high'; certainty: 'low' | 'medium' | 'high';
    start_ms: number; end_ms: number | null;
    observed_behavior: string; expected_behavior: string;
    expected_source: 'developer_expectation' | 'observed_precedent' | 'model_inference'; expected_source_ref: string | null;
    explanation: string; benign_alternatives: string[]; reproduction_steps: string[]; limitations: string[];
    evidence: { type: 'telemetry' | 'video'; event_id: string | null; video_ms: number | null; observation: string }[];
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

// Local resource policy, independent of the released strict-output wire schema.
export const ANALYSIS_VALIDATION_LIMITS = Object.freeze({ bytes: 256 * 1024, depth: 16, nodes: 20_000 });
function requireBoundedJson(value: unknown): void {
  let nodes = 0;
  let stringBytes = 0;
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    requireCondition(++nodes <= ANALYSIS_VALIDATION_LIMITS.nodes && depth <= ANALYSIS_VALIDATION_LIMITS.depth, 'Analysis JSON exceeds structural limits');
    if (typeof item === 'string') {
      stringBytes += Buffer.byteLength(item);
      requireCondition(stringBytes <= ANALYSIS_VALIDATION_LIMITS.bytes, 'Analysis JSON exceeds byte limit');
    } else if (typeof item === 'number') requireCondition(Number.isFinite(item), 'Analysis JSON contains non-finite number');
    else if (typeof item === 'object' && item !== null) {
      requireCondition(!ancestors.has(item), 'Analysis JSON contains a cycle');
      requireCondition(Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'Analysis JSON contains non-JSON object');
      ancestors.add(item);
      if (Array.isArray(item)) {
        requireCondition(item.length <= ANALYSIS_VALIDATION_LIMITS.nodes, 'Analysis JSON exceeds structural limits');
        for (const child of item) visit(child, depth + 1);
      } else {
        for (const [key, child] of Object.entries(item)) {
          visit(key, depth + 1);
          visit(child, depth + 1);
        }
      }
      ancestors.delete(item);
    } else requireCondition(item === null || typeof item === 'boolean', 'Analysis JSON contains non-JSON value');
  };
  visit(value, 0);
  requireCondition(Buffer.byteLength(JSON.stringify(value)) <= ANALYSIS_VALIDATION_LIMITS.bytes, 'Analysis JSON exceeds byte limit');
}
function requireText(value: string): void {
  requireCondition(value.trim().length > 0, 'Blank analysis text or ID');
}
function requireSafeCount(value: number): void {
  requireCondition(Number.isSafeInteger(value) && value >= 0, 'Invalid safe integer/time');
}
export function validateContext(value: unknown): Context {
  requireBoundedJson(value);
  requireCondition(inputValidator(value), 'Invalid analysis context schema');
  const { start_ms: start, end_ms: end } = value.session.video_window;
  for (const time of [start, end, value.session.duration_ms]) requireSafeCount(time);
  requireText(value.session.session_id);
  requireCondition(start < end && end <= value.session.duration_ms, 'Invalid context video window');
  const sync = value.session.synchronization;
  requireCondition((sync.status === 'unknown') === (sync.estimated_error_ms === null), 'Inconsistent synchronization estimate');
  if (sync.estimated_error_ms !== null) requireSafeCount(sync.estimated_error_ms);
  const ids = new Set<string>();
  const registrationIds = new Set(value.registrations.map(r => r.id));
  requireCondition(registrationIds.size === value.registrations.length, 'Duplicate registration ID');
  for (const registration of value.registrations) requireText(registration.id);
  let previous = start;
  for (const event of value.events) {
    requireText(event.id);
    requireSafeCount(event.t_ms);
    requireCondition(!ids.has(event.id), 'Duplicate event ID');
    ids.add(event.id);
    requireCondition(event.t_ms >= previous && event.t_ms <= end, 'Invalid event time/order');
    requireCondition(event.registration_id === null || registrationIds.has(event.registration_id), 'Unknown registration');
    previous = event.t_ms;
  }
  requireCondition(value.coverage.included_events === value.events.length && value.coverage.total_events >= value.events.length, 'Invalid coverage counts');
  requireSafeCount(value.coverage.total_events);
  requireSafeCount(value.coverage.included_events);
  requireCondition(value.coverage.truncated === (value.coverage.omissions.length > 0), 'Coverage omissions must be explicit');
  requireCondition(value.coverage.total_events === value.events.length || value.coverage.truncated, 'Missing events without coverage limitation');
  for (const omission of value.coverage.omissions) requireText(omission);
  return value;
}
export function validateProposal(value: unknown, context: Context): Proposal {
  validateContext(context);
  requireBoundedJson(value);
  requireCondition(resultValidator(value), 'Invalid Muse result schema');
  requireText(value.coverage_summary);
  for (const limitation of value.coverage_limitations) requireText(limitation);
  const eventIds = new Set(context.events.map(e => e.id));
  const ids = new Set<string>();
  const inWindow = (time: number) => time >= context.session.video_window.start_ms && time <= context.session.video_window.end_ms;
  for (const finding of value.findings) {
    for (const text of [finding.id, finding.title, finding.observed_behavior, finding.expected_behavior, finding.explanation, ...finding.benign_alternatives, ...finding.reproduction_steps, ...finding.limitations]) requireText(text);
    requireSafeCount(finding.start_ms);
    if (finding.end_ms !== null) requireSafeCount(finding.end_ms);
    requireCondition(!ids.has(finding.id), 'Duplicate finding ID');
    ids.add(finding.id);
    requireCondition(inWindow(finding.start_ms) && (finding.end_ms === null || (finding.end_ms >= finding.start_ms && inWindow(finding.end_ms))), 'Finding time outside window');
    if (finding.expected_source === 'developer_expectation') {
      requireCondition(context.registrations.some(r => r.id === finding.expected_source_ref && r.expected_behavior?.trim()), 'Missing expected-behavior source');
    } else requireCondition(finding.expected_source_ref === null, 'Unexpected expected-behavior reference');
    requireCondition(finding.evidence.length > 0, 'Missing evidence');
    for (const evidence of finding.evidence) {
      requireText(evidence.observation);
      if (evidence.video_ms !== null) requireSafeCount(evidence.video_ms);
      if (evidence.type === 'telemetry') requireCondition(evidence.event_id !== null && eventIds.has(evidence.event_id) && evidence.video_ms === null, 'Invalid telemetry evidence');
      else requireCondition(evidence.event_id === null && evidence.video_ms !== null && inWindow(evidence.video_ms), 'Invalid video evidence');
    }
    if (finding.certainty === 'high') {
      requireCondition(finding.expected_source !== 'model_inference' && context.session.synchronization.status !== 'unknown' && new Set(finding.evidence.map(e => e.type)).size === 2, 'High-certainty proposal needs sourced cross-modal support');
    }
  }
  return value;
}

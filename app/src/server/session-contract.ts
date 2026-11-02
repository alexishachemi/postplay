import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectAsset } from './project-assets.ts';

export const CONTRACT_LIMITS = Object.freeze({ depth: 6, nodes: 256, payloadBytes: 8192, eventBytes: 16384, manifestBytes: 262144, events: 10000, logBytes: 16777216 });
export type SafeValue = null | boolean | number | string | SafeValue[]
  | { type: 'Vector2'; x: number; y: number }
  | { type: 'Vector3'; x: number; y: number; z: number }
  | { type: 'dictionary'; entries: { [key: string]: SafeValue } }
  | { type: 'unsupported'; reason: string };
export interface Source { id: string; label: string; node_path: string | null }
export type CaptureStatus = 'recording' | 'complete' | 'incomplete';
export interface Session {
  schema_version: '1'; session_id: string;
  project: { id: string; name: string; scene: string }; godot_version: string;
  status: CaptureStatus; started_at_utc: string; ended_at_utc: string | null;
  capture: { mode: 'movie_maker' | 'external'; video_path: string | null; format: 'avi' | 'ogv' | 'mp4'; fps: number; width: number; height: number; duration_ms: number | null; collision_debug: boolean };
  telemetry: { path: 'events.jsonl'; event_count: number; truncated: boolean };
  synchronization: { status: 'unknown' | 'approximate' | 'verified'; estimated_error_ms: number | null; anchor: { event_id: string; clock: 'process_frame' | 'simulation_ms' | 'wall_elapsed_ms'; recorded_value: number; video_ms: number } | null; notes: string[] };
  registrations: { id: string; kind: string; source: Source; description: string; expected_behavior: string | null }[];
}
export interface Event {
  schema_version: '1'; session_id: string; id: string; sequence: number;
  kind: 'lifecycle' | 'signal' | 'property' | 'input' | 'position' | 'annotation' | 'progression';
  time: { wall_elapsed_ms: number; simulation_ms: number; process_frame: number | null; physics_frame: number | null };
  registration_id: string | null; source: Source; label: string; payload: SafeValue;
}

const schema = (name: string): object => JSON.parse(readFileSync(projectAsset(`contracts/${name}.v1.schema.json`), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(schema('safe-value'));
ajv.addSchema(schema('session'));
const sessionValidator = ajv.compile<Session>({ $ref: 'https://postplay.local/contracts/session.v1' });
const eventValidator = ajv.compile<Event>(schema('event'));
const valueValidator = ajv.compile<SafeValue>({ $ref: 'https://postplay.local/contracts/safe-value.v1' });
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** Lexical portable path check only. Filesystem confinement/symlinks belong to ingestion. */
export function validatePortablePath(path: string, allowRoot = false): void {
  if (allowRoot && path === '.') return;
  requireValue(path.length > 0 && !/[\\:\x00-\x1f\x7f%?#]/u.test(path) && !path.split('/').some(part => part === '' || part === '.' || part === '..'), 'Path must be a portable relative path');
}
function validateSource(source: Source): void {
  if (source.node_path !== null) validatePortablePath(source.node_path, true);
}
function utcTime(value: string): number {
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value), 'Expected UTC ISO timestamp');
  const time = Date.parse(value);
  requireValue(Number.isFinite(time) && new Date(time).toISOString() === value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`), 'Invalid UTC date');
  return time;
}

/** Enforce recursive budgets before the schema validator can visit untrusted recursion. */
export function validateSafeValue(value: unknown): SafeValue {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): void {
    requireValue(depth <= CONTRACT_LIMITS.depth && ++nodes <= CONTRACT_LIMITS.nodes, 'Safe value depth/node limit exceeded');
    if (typeof item !== 'object' || item === null) return;
    requireValue(!ancestors.has(item), 'Cyclic safe value');
    ancestors.add(item);
    if (Array.isArray(item)) {
      requireValue(item.length <= 64, 'Safe value collection limit exceeded');
      for (const child of item) visit(child, depth + 1);
    } else if ('type' in item && item.type === 'dictionary' && 'entries' in item && typeof item.entries === 'object' && item.entries !== null && !Array.isArray(item.entries)) {
      const children = Object.values(item.entries);
      requireValue(children.length <= 64, 'Safe value collection limit exceeded');
      for (const child of children) visit(child, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
  requireValue(valueValidator(value), 'Invalid safe value schema');
  requireValue(bytes(value) <= CONTRACT_LIMITS.payloadBytes, 'Safe value byte limit exceeded');
  return value;
}

export function validateSession(value: unknown): Session {
  requireValue(sessionValidator(value), 'Invalid session schema');
  requireValue(bytes(value) <= CONTRACT_LIMITS.manifestBytes, 'Manifest byte limit exceeded');
  validatePortablePath(value.project.scene);
  const started = utcTime(value.started_at_utc);
  if (value.ended_at_utc !== null) requireValue(utcTime(value.ended_at_utc) >= started, 'Session end precedes start');
  if (value.status === 'recording') requireValue(value.ended_at_utc === null, 'Recording cannot have an end timestamp');
  if (value.capture.video_path !== null) {
    validatePortablePath(value.capture.video_path);
    requireValue(value.capture.video_path.endsWith(`.${value.capture.format}`) && value.capture.video_path !== value.telemetry.path, 'Video path/format mismatch');
  }
  if (value.capture.mode === 'external') requireValue(value.capture.format === 'mp4', 'External capture must use MP4');
  if (value.status === 'complete') requireValue(value.ended_at_utc !== null && value.capture.video_path !== null && value.capture.duration_ms !== null && value.capture.duration_ms > 0, 'Complete capture needs finalized media metadata and end timestamp');
  const sync = value.synchronization;
  if (sync.status === 'unknown') requireValue(sync.anchor === null && sync.estimated_error_ms === null, 'Unknown synchronization cannot claim a mapping');
  else requireValue(sync.anchor !== null && sync.estimated_error_ms !== null, 'Known synchronization needs anchor and error estimate');
  if (sync.anchor !== null) {
    if (sync.anchor.clock === 'process_frame') {
      requireValue(Number.isSafeInteger(sync.anchor.recorded_value) && value.capture.mode === 'movie_maker', 'Process-frame mapping requires fixed-fps Movie Maker capture');
    }
    if (value.capture.duration_ms !== null) requireValue(sync.anchor.video_ms <= value.capture.duration_ms, 'Anchor outside video');
  }
  const ids = new Set<string>();
  for (const registration of value.registrations) {
    requireValue(!ids.has(registration.id), 'Duplicate registration ID');
    ids.add(registration.id);
    validateSource(registration.source);
  }
  return value;
}

export function validateEvent(value: unknown): Event {
  requireValue(typeof value === 'object' && value !== null && 'payload' in value, 'Invalid event object');
  validateSafeValue(value.payload);
  requireValue(eventValidator(value), 'Invalid event schema');
  requireValue(value.id === `evt-${value.sequence}`, 'Event ID/sequence mismatch');
  requireValue(bytes(value) <= CONTRACT_LIMITS.eventBytes, 'Event byte limit exceeded');
  validateSource(value.source);
  return value;
}
export function serializeEvent(value: unknown): string {
  return JSON.stringify(validateEvent(value)) + '\n';
}
export function parseEventsJsonl(text: string): Event[] {
  requireValue(Buffer.byteLength(text) <= CONTRACT_LIMITS.logBytes, 'Event log byte limit exceeded');
  if (text === '' || text === '\n') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  requireValue(lines.length <= CONTRACT_LIMITS.events, 'Event count limit exceeded');
  return lines.map((line, index) => {
    requireValue(Buffer.byteLength(line) <= CONTRACT_LIMITS.eventBytes, `Event line ${index + 1} exceeds byte limit`);
    try { return validateEvent(JSON.parse(line)); }
    catch (error) { throw new Error(`Invalid event line ${index + 1}: ${error instanceof Error ? error.message : 'parse failure'}`); }
  });
}

/** Validate a package's data, without opening media or accepting filesystem paths. */
export function validateSessionPackage(manifest: unknown, jsonl: string): { session: Session; events: Event[]; diagnostics: string[] } {
  const session = validateSession(manifest);
  const events = parseEventsJsonl(jsonl);
  const registrations = new Map(session.registrations.map(item => [item.id, item]));
  const sources = new Map<string, string>();
  const checkSource = (source: Source) => {
    const encoded = JSON.stringify([source.label, source.node_path]);
    requireValue(!sources.has(source.id) || sources.get(source.id) === encoded, 'Source ID has inconsistent identity');
    sources.set(source.id, encoded);
  };
  session.registrations.forEach(item => checkSource(item.source));
  const lastClocks = new Map<keyof Event['time'], number>();
  events.forEach((event, index) => {
    requireValue(event.session_id === session.session_id && event.sequence === index + 1, 'Wrong session or noncontiguous event sequence');
    checkSource(event.source);
    if (event.registration_id !== null) requireValue(registrations.get(event.registration_id)?.source.id === event.source.id, 'Unknown or mismatched event registration');
    for (const clock of ['wall_elapsed_ms', 'simulation_ms', 'process_frame', 'physics_frame'] as const) {
      const current = event.time[clock];
      if (current === null) continue;
      requireValue(current >= (lastClocks.get(clock) ?? 0), 'Event clock moved backwards');
      lastClocks.set(clock, current);
    }
  });
  requireValue(session.telemetry.event_count <= events.length, 'Manifest claims missing event records');
  if (session.status === 'complete') requireValue(session.telemetry.event_count === events.length, 'Complete event count mismatch');
  const anchor = session.synchronization.anchor;
  if (anchor !== null) {
    const event = events.find(item => item.id === anchor.event_id);
    requireValue(event && event.time[anchor.clock] === anchor.recorded_value, 'Synchronization anchor does not match an event');
  }
  const diagnostics: string[] = [];
  if (session.status !== 'complete') diagnostics.push(`Capture is ${session.status}; finalization is not established.`);
  if (session.telemetry.truncated) diagnostics.push('Telemetry coverage is truncated.');
  if (session.telemetry.event_count < events.length) diagnostics.push('Manifest event count lags the preserved log.');
  if (session.synchronization.status === 'unknown') diagnostics.push('Video synchronization is unknown.');
  return { session, events, diagnostics };
}

export function assertCaptureTransition(from: CaptureStatus, to: CaptureStatus): void {
  requireValue(from === 'recording' && (to === 'complete' || to === 'incomplete'), 'Only recording may transition to complete/incomplete');
}

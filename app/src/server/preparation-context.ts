import { validateContext, type Context } from './analysis-validation.ts';
import { createVideoMapper } from './synchronization.ts';
import type { Event, Session } from './session-contract.ts';

export const PREPARATION_LIMITS = Object.freeze({ duration_ms: 120_000, source_bytes: 1024 ** 3, video_bytes: 20 * 1024 ** 2, context_bytes: 96_000, events: 2000 });
export class PreparationError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export function requirePreparation(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new PreparationError(code, message);
}
export interface ClipTiming { source_start_ms: number; duration_ms: number; conversion_error_ms: number }

/** Preserve all eligible events, or stop. No ground-truth-dependent selection,
 * speculative interpolation, payload decoding, or invented video timestamps. */
export function normalizeContext(session: Session, events: Event[], clip: ClipTiming, limits: { context_bytes: number; events: number } = { context_bytes: PREPARATION_LIMITS.context_bytes, events: PREPARATION_LIMITS.events }): Context {
  const map = createVideoMapper(session, events);
  requirePreparation(session.status === 'complete', 'source_incomplete', 'Finalize the capture before preparation.');
  requirePreparation(session.synchronization.status !== 'unknown', 'synchronization_unknown', 'Measure a visible-event synchronization anchor before preparing correlated telemetry.');
  requirePreparation(!(session.capture.mode === 'movie_maker' && session.synchronization.anchor?.clock === 'wall_elapsed_ms'), 'synchronization_unknown', 'Movie Maker cannot use a wall-clock-only alignment; measure a process-frame or simulation anchor.');
  requirePreparation(Number.isFinite(clip.source_start_ms) && clip.source_start_ms >= 0 && Number.isSafeInteger(clip.duration_ms) && clip.duration_ms > 0 && clip.duration_ms <= PREPARATION_LIMITS.duration_ms
    && clip.source_start_ms < session.capture.duration_ms! && clip.source_start_ms + clip.duration_ms <= session.capture.duration_ms! + 1
    && Number.isSafeInteger(clip.conversion_error_ms) && clip.conversion_error_ms >= 0, 'invalid_clip', 'Invalid measured clip timing.');
  requirePreparation(Number.isSafeInteger(limits.context_bytes) && limits.context_bytes > 0 && limits.context_bytes <= PREPARATION_LIMITS.context_bytes
    && Number.isSafeInteger(limits.events) && limits.events > 0 && limits.events <= PREPARATION_LIMITS.events, 'invalid_limits', 'Preparation limits may only lower the fixed safety caps.');
  const normalized: Context['events'] = [];
  let lifecycle = 0, outside = 0, missingClock = 0;
  for (const event of events) {
    if (event.kind === 'lifecycle') { lifecycle++; continue; }
    const time = map(event.id);
    if (time.status !== 'mapped') { if (time.status === 'unknown') missingClock++; else outside++; continue; }
    const local = time.video_ms - clip.source_start_ms;
    if (local < 0 || local >= clip.duration_ms) { outside++; continue; }
    normalized.push({ id: event.id, t_ms: Math.floor(local), kind: event.kind, registration_id: event.registration_id,
      source_label: event.source.label, payload: { label: event.label, value: event.payload } });
  }
  requirePreparation(normalized.length <= limits.events, 'context_limit', 'Too many aligned observations; select a narrower clip instead of silently sampling.');
  requirePreparation(normalized.length > 0, 'insufficient_telemetry', 'The selected clip has no alignable gameplay observations. Choose a recorded interaction or add explicit instrumentation; do not treat missing data as a clean session.');
  const omissions = [
    ...(lifecycle ? [`${lifecycle} lifecycle records omitted (not gameplay observations).`] : []),
    ...(outside ? [`${outside} observations outside the selected encoded-video interval omitted.`] : []),
    ...(missingClock ? [`${missingClock} observations lack the measured anchor clock and cannot be aligned.`] : []),
    ...(session.telemetry.truncated ? ['Raw telemetry was truncated at capture; unrecorded observations are unavailable.'] : []),
    ...(clip.source_start_ms > 0 || clip.duration_ms < session.capture.duration_ms! ? ['Only the selected source-video excerpt is provided, not the full session.'] : []),
  ];
  const error = session.synchronization.estimated_error_ms! + clip.conversion_error_ms + 1; // Integer event-time flooring.
  requirePreparation(Number.isSafeInteger(error), 'invalid_clip', 'Combined synchronization uncertainty exceeds the safe numeric range.');
  const context: Context = {
    contract_version: '1', session: { session_id: session.session_id, duration_ms: clip.duration_ms,
      video_window: { start_ms: 0, end_ms: clip.duration_ms },
      synchronization: { status: session.synchronization.status === 'verified' && error > 500 ? 'approximate' : session.synchronization.status, estimated_error_ms: error },
      recording_notes: ['All times are local to the prepared clip; original event IDs are retained.',
        'Payload.value preserves the raw bounded safe-value representation, including unsupported markers; payload.label is the original event label.',
        'Expectations and source labels are developer-provided context, not demonstrated defects.',
        'Action-state capture is best-effort; short taps and text-focused input may be absent. Missing observations do not prove no attempt.',
        'Synchronization was measured at sampled visible events; unobserved source intervals are not independently verified.',
        `Collision-debug hint at capture start: ${session.capture.collision_debug}.`,
        ...(missingClock ? ['Some observations cannot be correlated because their measured clock is missing.'] : [])] },
    registrations: session.registrations.map(item => ({ id: item.id, kind: item.kind, source_label: item.source.label, description: item.description, expected_behavior: item.expected_behavior })),
    events: normalized,
    coverage: { total_events: events.length, included_events: normalized.length, truncated: omissions.length > 0, omissions },
  };
  requirePreparation(Buffer.byteLength(JSON.stringify(context)) + 1 <= limits.context_bytes, 'context_limit', 'Aligned context exceeds the byte budget; select a narrower clip or reduce explicit instrumentation.');
  return validateContext(context);
}

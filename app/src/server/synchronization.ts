import { validateSessionPackage, type Event, type Session } from './session-contract.ts';

type Clock = NonNullable<Session['synchronization']['anchor']>['clock'];
export interface VisibleObservation { event_id: string; video_ms: number; uncertainty_ms: number }
export interface Measurement {
  synchronization: Session['synchronization'];
  observations: VisibleObservation[];
  residuals_ms: number[];
  observed_span_ms: number;
}
export type MappedTime = { status: 'mapped'; video_ms: number; estimated_error_ms: number }
  | { status: 'unknown' | 'outside'; reason: string };

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function checked(session: Session, events: Event[]): void {
  validateSessionPackage(session, events.map(event => JSON.stringify(event) + '\n').join(''));
}
function scale(session: Session, clock: Clock): number {
  requireValue(clock !== 'process_frame' || session.capture.mode === 'movie_maker', 'Frame mapping needs fixed-fps Movie Maker');
  requireValue(clock !== 'wall_elapsed_ms' || session.capture.mode === 'external', 'Wall time cannot map Movie Maker recordings');
  return clock === 'process_frame' ? 1000 / session.capture.fps : 1;
}

/** Measurements are supplied by an observer, never inferred from timestamps alone.
 * Verification covers the sampled span, not proof of frame-perfect whole-clip timing. */
export function measureSynchronization(session: Session, events: Event[], clock: Clock, input: unknown): Measurement {
  checked(session, events);
  requireValue(session.status === 'complete', 'Measure only finalized captures');
  requireValue(['process_frame', 'simulation_ms', 'wall_elapsed_ms'].includes(clock), 'Invalid synchronization clock');
  const milliseconds = scale(session, clock);
  requireValue(Array.isArray(input) && input.length > 0 && input.length <= 128, 'Need 1–128 visible observations');
  const seen = new Set<string>();
  const observations: VisibleObservation[] = input.map(value => {
    requireValue(typeof value === 'object' && value !== null && !Array.isArray(value), 'Invalid observation');
    requireValue(Object.keys(value).sort().join(',') === 'event_id,uncertainty_ms,video_ms', 'Unexpected observation fields');
    requireValue(typeof value.event_id === 'string' && !seen.has(value.event_id), 'Repeated/invalid observation event');
    seen.add(value.event_id);
    requireValue(Number.isSafeInteger(value.video_ms) && value.video_ms >= 0 && value.video_ms < session.capture.duration_ms!, 'Observation outside video');
    requireValue(Number.isSafeInteger(value.uncertainty_ms) && value.uncertainty_ms >= 0 && value.uncertainty_ms <= 60_000, 'Invalid observation uncertainty');
    const event = events.find(event => event.id === value.event_id);
    requireValue(event && event.time[clock] !== null, 'Observation has missing event/clock');
    return { event_id: value.event_id, video_ms: value.video_ms, uncertainty_ms: value.uncertainty_ms };
  });
  observations.forEach((item, index) => {
    if (index > 0) requireValue(item.video_ms > observations[index - 1]!.video_ms, 'Observations must be in video order');
  });
  const first = observations[0]!;
  const recorded = events.find(event => event.id === first.event_id)!.time[clock]!;
  const residuals = observations.map(item => item.video_ms - (first.video_ms + (events.find(event => event.id === item.event_id)!.time[clock]! - recorded) * milliseconds));
  // Include quantization plus uncertainty at BOTH ends of the anchored comparison.
  const error = Math.ceil(Math.max(...residuals.map((residual, index) => Math.abs(residual) + first.uncertainty_ms + observations[index]!.uncertainty_ms)) + 1000 / session.capture.fps);
  const span = observations.at(-1)!.video_ms - first.video_ms;
  const verified = observations.length >= 2 && span >= 1000 && error <= 500;
  const synchronization: Session['synchronization'] = {
    status: verified ? 'verified' : 'approximate', estimated_error_ms: error,
    anchor: { event_id: first.event_id, clock, recorded_value: recorded, video_ms: first.video_ms },
    notes: [`Visible-event measurement: ${observations.length} observations over ${span} ms; maximum residual ${Math.max(...residuals.map(Math.abs)).toFixed(3)} ms.`,
      'Error includes observed residual, observer uncertainty and one encoded frame. Unobserved intervals are not verified.',
      ...(verified ? [] : ['Insufficient span/observations or error exceeds the 500 ms target; alignment is approximate.'])],
  };
  checked({ ...session, synchronization }, events);
  return { synchronization, observations, residuals_ms: residuals, observed_span_ms: span };
}

/** Explicit anchor offset; no assumption that engine frame zero is movie frame zero. */
export function mapEventToVideo(session: Session, events: Event[], eventId: string): MappedTime {
  checked(session, events);
  const event = events.find(event => event.id === eventId);
  requireValue(event, 'Unknown event');
  const { anchor, estimated_error_ms: error } = session.synchronization;
  if (!anchor) return { status: 'unknown', reason: 'No measured video anchor.' };
  const value = event.time[anchor.clock];
  if (value === null) return { status: 'unknown', reason: 'Event lacks the anchor clock.' };
  const video = anchor.video_ms + (value - anchor.recorded_value) * scale(session, anchor.clock);
  if (session.capture.duration_ms === null || video < 0 || video >= session.capture.duration_ms) return { status: 'outside', reason: 'Mapped event is outside measured media; not clamped.' };
  return { status: 'mapped', video_ms: video, estimated_error_ms: error! };
}

/** For a derived clip, record the ACTUAL source trim start, not a guessed FFmpeg seek.
 * fps/resolution-only transcoding has source_start_ms=0; raw telemetry stays untouched. */
export function mapToDerivedVideo(time: MappedTime, clip: { source_start_ms: number; duration_ms: number }): MappedTime {
  requireValue(Number.isFinite(clip.source_start_ms) && clip.source_start_ms >= 0 && Number.isFinite(clip.duration_ms) && clip.duration_ms > 0, 'Invalid conversion interval');
  if (time.status !== 'mapped') return time;
  const video = time.video_ms - clip.source_start_ms;
  if (video < 0 || video >= clip.duration_ms) return { status: 'outside', reason: 'Event is outside the derived clip.' };
  return { ...time, video_ms: video };
}

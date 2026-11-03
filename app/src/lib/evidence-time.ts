/** Finding/evidence timestamps are clip-local, never original wall/frame clocks.
 * The v1 contract permits an end-boundary reference; explicitly seek 1 ms earlier
 * because there is no decoded frame at duration itself. Never clamp invalid input. */
export function evidenceSeekMs(time: number, duration: number): number | null {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0 || time < 0 || time > duration) return null;
  return time === duration ? Math.max(0, duration - 1) : time;
}

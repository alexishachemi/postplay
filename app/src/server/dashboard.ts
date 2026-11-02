import { opendir, type FileHandle } from 'node:fs/promises';
import { SessionLibrary, openPackageChild, IngestionError } from './session-library.ts';
import { loadFindingsReport } from './report-storage.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const PAGE_SIZE = 10;
export interface SessionSummary {
  id: string; name: string; scene: string | null; recorded_at: string | null; duration_ms: number | null;
  status: 'recorded' | 'processing' | 'analyzed' | 'failed'; detail: string; synchronization: string | null;
  preparation_id: string | null;
  report: { status: string; findings: number; quarantined: number } | null;
}
export function parsePage(value: string | null): number {
  if (value === null) return 1;
  if (!/^[1-9][0-9]{0,3}$/.test(value)) throw new Error('Invalid page');
  return Number(value);
}
export function localRequest(request: Request): boolean {
  const url = new URL(request.url);
  // Astro may normalize an untrusted Host to localhost in Request.url. Check
  // the original header too, and use it for legitimate same-origin comparisons.
  const host = request.headers.get('host');
  if (host && !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host)) return false;
  try {
    const target = host ? new URL(`${url.protocol}//${host}`) : url;
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && (!request.headers.has('origin') || request.headers.get('origin') === target.origin);
  } catch { return false; }
}
export const PRIVATE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
async function has(directory: FileHandle, name: string, isDirectory = false): Promise<boolean> {
  try { const file = await openPackageChild(directory, name, isDirectory); await file.close(); return true; }
  catch (error) { if (error instanceof IngestionError && error.code === 'not_found') return false; throw error; }
}
async function latestPreparation(library: SessionLibrary, id: string): Promise<string | null> {
  return await library.withDirectory(id, async directory => {
    if (!await has(directory, 'preparations', true)) return null;
    const parent = await openPackageChild(directory, 'preparations', true);
    try {
      const entries = await opendir(`/proc/self/fd/${parent.fd}`); const candidates: { id: string; modified: number }[] = [];
      let count = 0;
      for await (const entry of entries) {
        if (++count > 100) throw new Error('Preparation discovery limit');
        if (!UUID.test(entry.name)) continue;
        const child = await openPackageChild(parent, entry.name, true);
        try {
          let modified = (await child.stat()).mtimeMs;
          if (await has(child, 'analysis', true)) {
            const analysis = await openPackageChild(child, 'analysis', true);
            try { modified = Math.max(modified, (await analysis.stat()).mtimeMs); } finally { await analysis.close(); }
          }
          candidates.push({ id: entry.name, modified });
        } finally { await child.close(); }
      }
      return candidates.sort((a, b) => b.modified - a.modified || a.id.localeCompare(b.id))[0]?.id ?? null;
    } finally { await parent.close(); }
  });
}

/** Only explicitly selected public metadata; never raw stages, paths, keys or model prose. */
export async function sessionSummary(library: SessionLibrary, id: string): Promise<SessionSummary> {
  const row: SessionSummary = { id, name: 'Unreadable session', scene: null, recorded_at: null, duration_ms: null, status: 'failed',
    detail: 'Session cannot be read safely. Preserve its files and inspect capture diagnostics.', synchronization: null, preparation_id: null, report: null };
  try {
    const manifest = await library.manifest(id);
    Object.assign(row, { name: manifest.project.name, scene: manifest.project.scene, recorded_at: manifest.started_at_utc,
      duration_ms: manifest.capture.duration_ms, synchronization: manifest.synchronization.status });
    if (manifest.status === 'incomplete') return { ...row, detail: 'Capture is incomplete. It is not ready for analysis.' };
    if (manifest.status === 'recording') return { ...row, status: 'processing', detail: 'Capture is not finalized. It may still be running or may have been interrupted.' };
    const inspection = await library.inspect(id);
    if (!inspection.ok) return { ...row, detail: inspection.error.message };
    row.status = 'recorded'; row.detail = 'Recording and telemetry validated. No saved analysis selected.';
    const preparation = await latestPreparation(library, id); row.preparation_id = preparation;
    if (!preparation) return row;
    const phase = await library.withDirectory(id, async directory => {
      const parent = await openPackageChild(directory, 'preparations', true);
      let prepared: FileHandle;
      try { prepared = await openPackageChild(parent, preparation, true); } finally { await parent.close(); }
      try {
        if (await has(prepared, 'failure.json')) return 'preparation_failed';
        if (!await has(prepared, 'preparation.json')) return 'preparing';
        if (!await has(prepared, 'analysis', true)) return 'recorded';
        const analysis = await openPackageChild(prepared, 'analysis', true);
        try {
          if (await has(analysis, 'failure.json')) return 'analysis_failed';
          if (await has(analysis, 'report-completed.json')) return 'report';
          return 'processing';
        } finally { await analysis.close(); }
      } finally { await prepared.close(); }
    });
    if (phase === 'preparation_failed' || phase === 'analysis_failed') return { ...row, status: 'failed', detail: `Saved ${phase === 'preparation_failed' ? 'preparation' : 'analysis'} failed. No successful empty report is implied; inspect its CLI stage files.` };
    if (phase === 'preparing' || phase === 'processing') return { ...row, status: 'processing', detail: 'Saved preparation/analysis is unfinished. It may be active or interrupted; no background job is started by this page.' };
    if (phase === 'report') {
      const report = await loadFindingsReport(library, id, preparation);
      return { ...row, status: 'analyzed', detail: report.status === 'needs_review' ? 'Saved report validated; all proposed findings require review, not a clean result.' : 'Saved report and evidence provenance validated. Model interpretations still require review.',
        report: { status: report.status, findings: report.findings.length, quarantined: report.quarantined.length } };
    }
    return { ...row, detail: 'Prepared input is available. No completed analysis report for this preparation.' };
  } catch { return { ...row, status: 'failed', detail: 'Session or saved analysis could not be validated. Check the package, tool availability and saved CLI diagnostics; no clean result is implied.' }; }
}
export async function sessionPage(library: SessionLibrary, page: number) {
  const discovered = await library.discover();
  const pages = Math.max(1, Math.ceil(discovered.ids.length / PAGE_SIZE));
  if (page > pages) throw new RangeError('Page outside library');
  const ids = discovered.ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { sessions: await Promise.all(ids.map(id => sessionSummary(library, id))), page, pages, total: discovered.ids.length, ignored_entries: discovered.ignored_entries };
}
export async function withDashboardLibrary<T>(use: (library: SessionLibrary) => Promise<T>): Promise<T> {
  const library = await SessionLibrary.create();
  try { return await use(library); } finally { await library.close(); }
}
export function validSessionId(id: unknown): id is string { return typeof id === 'string' && UUID.test(id); }

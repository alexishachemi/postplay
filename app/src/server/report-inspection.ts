import type { SessionLibrary } from './session-library.ts';
import { loadFindingsReport } from './report-storage.ts';
import type { FindingsReport } from './findings-report.ts';
import { validSessionId } from './dashboard.ts';

export type ReportInspection = { status: 'ready'; report: FindingsReport; video_url: string }
  | { status: 'unavailable' | 'invalid'; message: string };

/** Offline provenance revalidation precedes ALL model prose/event rendering.
 * Never use report/model paths as URLs or fabricate findings when loading fails. */
export async function inspectReport(library: SessionLibrary, id: string, preparation: string | null): Promise<ReportInspection> {
  if (!preparation) return { status: 'unavailable', message: 'No saved report selected. Explicitly analyze a prepared clip first; browsing does not run inference.' };
  if (!validSessionId(id) || !validSessionId(preparation)) return { status: 'invalid', message: 'Invalid session/report identity. Choose a session from the library.' };
  try {
    const report = await loadFindingsReport(library, id, preparation);
    // The SSR view must never expose the currently loaded credential, including
    // an accidental echo in an older report or raw snapshot from instrumentation.
    const key = process.env.MODEL_API_KEY;
    if (key && JSON.stringify(report).includes(key)) throw new Error('Sensitive report content');
    return { status: 'ready', report, video_url: `/api/sessions/${id}/video?preparation=${preparation}` };
  } catch {
    return { status: 'invalid', message: 'A saved findings report is not available or could not pass source/evidence validation. This is not a clean result. Inspect saved stages or use offline report recovery; do not repeat inference to repair local storage.' };
  }
}

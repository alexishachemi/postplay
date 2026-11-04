import type { APIRoute } from 'astro';
import { localRequest, PRIVATE_HEADERS, validSessionId, withDashboardLibrary } from '../../../../server/dashboard.ts';
import { synchronizationView, runSynchronizationAction, SynchronizationError } from '../../../../server/dashboard-synchronization.ts';
import { AnalysisControlError } from '../../../../server/dashboard-analysis.ts';

function failure(error: unknown) {
  const message = error instanceof SynchronizationError ? error.message : error instanceof AnalysisControlError && error.code === 'busy'
    ? 'Another operation is running for this session. Wait and refresh; do not repeat automatically.'
    : 'Alignment could not be loaded or saved safely. Refresh and inspect the session; existing files were not silently repaired.';
  return Response.json({ error: message }, { status: error instanceof SynchronizationError || error instanceof AnalysisControlError ? error.status : 422, headers: PRIVATE_HEADERS });
}
export const GET: APIRoute = async ({ request, params, url }) => {
  if (!localRequest(request)) return new Response('Local requests only', { status: 403, headers: PRIVATE_HEADERS });
  if (!validSessionId(params.id) || url.search) return failure(new SynchronizationError('Choose a session from the library.', 400));
  try { return Response.json(await withDashboardLibrary(library => synchronizationView(library, params.id!)), { headers: PRIVATE_HEADERS }); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request, params }) => {
  if (!request.headers.has('origin') || !localRequest(request) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Same-origin local request required', { status: 403, headers: PRIVATE_HEADERS });
  if (request.headers.get('content-type') !== 'application/json') return new Response('JSON required', { status: 415, headers: PRIVATE_HEADERS });
  if (!validSessionId(params.id)) return failure(new SynchronizationError('Choose a session from the library.', 400));
  try {
    const reader = request.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    try {
      if (reader) for (;;) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.length;
        if (bytes > 8192) return new Response('Measurement too large', { status: 413, headers: PRIVATE_HEADERS });
        chunks.push(next.value);
      }
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new SynchronizationError('Invalid measurement JSON.', 400); }
    return Response.json(await withDashboardLibrary(library => runSynchronizationAction(library, params.id!, value)), { headers: PRIVATE_HEADERS });
  } catch (error) { return failure(error); }
};

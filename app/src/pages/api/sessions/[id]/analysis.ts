import type { APIRoute } from 'astro';
import { localRequest, PRIVATE_HEADERS, validSessionId, withDashboardLibrary } from '../../../../server/dashboard.ts';
import { analysisView, parseAnalysisAction, runAnalysisAction, controlError, AnalysisControlError } from '../../../../server/dashboard-analysis.ts';

const failure = (error: unknown) => Response.json({ error: controlError(error) }, { status: error instanceof AnalysisControlError ? error.status : 422, headers: PRIVATE_HEADERS });
export const GET: APIRoute = async ({ request, params, url }) => {
  if (!localRequest(request)) return new Response('Local requests only', { status: 403, headers: PRIVATE_HEADERS });
  const preparation = url.searchParams.get('preparation');
  if (!validSessionId(params.id) || (preparation !== null && !validSessionId(preparation)) || [...url.searchParams.keys()].some(key => key !== 'preparation') || url.searchParams.getAll('preparation').length > 1) return failure(new AnalysisControlError('invalid_request', 400));
  try { const id = params.id; return Response.json(await withDashboardLibrary(async library => await analysisView(library, id, preparation)), { headers: PRIVATE_HEADERS }); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async ({ request, params }) => {
  if (!request.headers.has('origin') || !localRequest(request) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Same-origin local request required', { status: 403, headers: PRIVATE_HEADERS });
  if (request.headers.get('content-type') !== 'application/json') return new Response('JSON required', { status: 415, headers: PRIVATE_HEADERS });
  if (!validSessionId(params.id)) return failure(new AnalysisControlError('invalid_request', 400));
  try {
    if (Number(request.headers.get('content-length')) > 1024) return new Response('Action too large', { status: 413, headers: PRIVATE_HEADERS });
    const reader = request.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    try { if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 1024) return new Response('Action too large', { status: 413, headers: PRIVATE_HEADERS }); chunks.push(chunk.value); } }
    finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new AnalysisControlError('invalid_request', 400); }
    const action = parseAnalysisAction(value), id = params.id;
    const result = await withDashboardLibrary(async library => await runAnalysisAction(library, id, action));
    return Response.json(result, { headers: PRIVATE_HEADERS });
  } catch (error) { return failure(error); }
};

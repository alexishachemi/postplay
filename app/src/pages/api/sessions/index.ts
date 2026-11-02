import type { APIRoute } from 'astro';
import { localRequest, PRIVATE_HEADERS, parsePage, sessionPage, withDashboardLibrary } from '../../../server/dashboard.ts';

export const GET: APIRoute = async ({ request, url }) => {
  if (!localRequest(request)) return new Response('Local requests only', { status: 403, headers: PRIVATE_HEADERS });
  let page: number;
  try { page = parsePage(url.searchParams.get('page')); } catch { return Response.json({ error: 'Invalid page number' }, { status: 400, headers: PRIVATE_HEADERS }); }
  try { return Response.json(await withDashboardLibrary(library => sessionPage(library, page)), { headers: PRIVATE_HEADERS }); }
  catch (error) { return Response.json({ error: 'Session library unavailable or page outside library. Check POSTPLAY_SESSION_ROOT and choose an existing page.' }, { status: error instanceof RangeError ? 400 : 503, headers: PRIVATE_HEADERS }); }
};

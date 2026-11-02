import type { APIRoute } from 'astro';
import { localRequest, PRIVATE_HEADERS, validSessionId, sessionSummary, withDashboardLibrary } from '../../../server/dashboard.ts';

export const GET: APIRoute = async ({ request, params }) => {
  if (!localRequest(request)) return new Response('Local requests only', { status: 403, headers: PRIVATE_HEADERS });
  if (!validSessionId(params.id)) return Response.json({ error: 'A canonical session UUID is required' }, { status: 400, headers: PRIVATE_HEADERS });
  try {
    const id = params.id;
    const row = await withDashboardLibrary(async library => {
      if (!(await library.discover()).ids.includes(id)) return null;
      return await sessionSummary(library, id);
    });
    return Response.json(row ?? { error: 'Session not found in the configured library' }, { status: row ? 200 : 404, headers: PRIVATE_HEADERS });
  } catch { return Response.json({ error: 'Session library unavailable. Check POSTPLAY_SESSION_ROOT.' }, { status: 503, headers: PRIVATE_HEADERS }); }
};

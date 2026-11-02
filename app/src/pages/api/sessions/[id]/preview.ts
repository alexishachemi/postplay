import type { APIRoute } from 'astro';
import { localRequest, PRIVATE_HEADERS, validSessionId, withDashboardLibrary } from '../../../../server/dashboard.ts';
import { createPlayback } from '../../../../server/playback.ts';
import { IngestionError } from '../../../../server/session-library.ts';
import { PreparationError } from '../../../../server/preparation-context.ts';

const active = new Set<string>();
export const POST: APIRoute = async ({ request, params }) => {
  if (!request.headers.has('origin') || !localRequest(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json({ error: 'Same-origin local request required' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  if (request.headers.get('content-type') !== 'application/json') return Response.json({ error: 'Use the dashboard local-preview action' }, { status: 415, headers: PRIVATE_HEADERS });
  if (!validSessionId(params.id)) return Response.json({ error: 'Canonical session UUID required' }, { status: 400, headers: PRIVATE_HEADERS });
  const id = params.id;
  if (active.has(id)) return Response.json({ error: 'A local preview is already being created. Wait, then refresh.' }, { status: 409, headers: PRIVATE_HEADERS });
  active.add(id);
  try {
    const video = await withDashboardLibrary(async library => await createPlayback(library, id));
    return Response.json({ video, remote_upload: false }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    const detail = error instanceof IngestionError || error instanceof PreparationError ? error.message : 'Preview conversion failed. Check FFmpeg/FFprobe and source files, then retry. Partial artifacts are preserved.';
    return Response.json({ error: detail }, { status: 422, headers: PRIVATE_HEADERS });
  } finally { active.delete(id); }
};

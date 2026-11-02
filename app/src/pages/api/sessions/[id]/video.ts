import type { APIRoute } from 'astro';
import { localRequest, PRIVATE_HEADERS, validSessionId, withDashboardLibrary } from '../../../../server/dashboard.ts';
import { playbackBytes, videoResponse } from '../../../../server/playback.ts';

export const GET: APIRoute = async ({ request, params, url }) => {
  if (!localRequest(request)) return new Response('Local requests only', { status: 403, headers: PRIVATE_HEADERS });
  const kind = url.searchParams.has('preparation') ? 'preparation' : 'preview';
  const token = url.searchParams.get(kind);
  if (!validSessionId(params.id) || !validSessionId(token) || [...url.searchParams.keys()].length !== 1) {
    return new Response('Choose a session video from the dashboard; paths are not accepted.', { status: 400, headers: PRIVATE_HEADERS });
  }
  try {
    const id = params.id;
    const { video } = await withDashboardLibrary(async library => await playbackBytes(library, id, kind, token));
    return videoResponse(video, request);
  } catch {
    return new Response('Video is missing or could not be validated. Restore the original recording, check FFprobe, and recreate a local preview.', { status: 404, headers: PRIVATE_HEADERS });
  }
};
export const HEAD = GET;

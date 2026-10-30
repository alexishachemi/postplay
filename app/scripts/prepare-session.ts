import { SessionLibrary, IngestionError } from '../src/server/session-library.ts';
import { prepareSession } from '../src/server/media-preparation.ts';
import { PreparationError } from '../src/server/preparation-context.ts';

const [id, start, duration, ...extra] = process.argv.slice(2);
if (!id || extra.length || ((start !== undefined || duration !== undefined) && (!/^\d+$/.test(start ?? '') || !/^\d+$/.test(duration ?? '')))) {
  console.error('Usage: prepare-session.ts SESSION_UUID [START_MS DURATION_MS] (configure POSTPLAY_SESSION_ROOT)');
  process.exitCode = 1;
} else {
  let library: SessionLibrary | undefined;
  try {
    library = await SessionLibrary.create();
    const prepared = await prepareSession(library, id, start === undefined ? {} : { start_ms: Number(start), duration_ms: Number(duration) });
    console.log(JSON.stringify({ ok: true, session_id: id, relative_directory: prepared.relative_directory, report: prepared.report, remote_upload: false }, null, 2));
  } catch (error) {
    const diagnostic = error instanceof PreparationError || error instanceof IngestionError ? { code: error.code, message: error.message }
      : { code: 'preparation_failed', message: 'Preparation failed; check writable storage and tools. No upload occurred.' };
    console.log(JSON.stringify({ ok: false, error: diagnostic }));
    process.exitCode = 1;
  } finally { await library?.close(); }
}

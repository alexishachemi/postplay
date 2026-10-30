import { SessionLibrary, IngestionError } from '../src/server/session-library.ts';
import { analyzeSession } from '../src/server/session-analysis.ts';
import { ModelError } from '../src/server/muse-api.ts';
import { PreparationError } from '../src/server/preparation-context.ts';

const [id, preparationId, consent, ...extra] = process.argv.slice(2);
let library: SessionLibrary | undefined;
try {
  if (!id || !preparationId || extra.length || (consent !== undefined && consent !== '--upload-to-meta')) throw new ModelError('usage', 'Usage: analyze-session.ts SESSION_UUID PREPARATION_UUID [--upload-to-meta]; without the flag this previews locally only');
  library = await SessionLibrary.create();
  if (consent) {
    const preview = await analyzeSession(library, id, preparationId);
    console.error(`Upload requested: ${preview.video_bytes} video bytes + ${preview.context_bytes} context bytes (${preview.events} observations, ${preview.duration_ms} ms) to Meta Standard Muse; one inference attempt, no automatic retries.`);
  }
  console.log(JSON.stringify(await analyzeSession(library, id, preparationId, { upload_to_meta: consent === '--upload-to-meta' }), null, 2));
} catch (error) {
  const known = error instanceof ModelError || error instanceof IngestionError || error instanceof PreparationError;
  const diagnostic = known ? { code: error.code, message: error.message } : { code: 'analysis_failed', message: 'Analysis failed; inspect local stage files. No clean report is implied. Remote outcome may be unknown.' };
  console.error(JSON.stringify({ status: 'failed', error: diagnostic }));
  process.exitCode = 1;
} finally { await library?.close(); }

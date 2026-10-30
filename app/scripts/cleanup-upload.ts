// Explicitly retry deletion of a known run's remote file; never repeat inference.
import { cleanupUpload, ModelError } from '../src/server/muse-api.ts';

// This CLI intentionally takes only the validated remote ID; no local paths are accepted.
const [fileId, consent, ...extra] = process.argv.slice(2);
try {
  if (!fileId || consent !== '--delete-from-meta' || extra.length) throw new ModelError('usage', 'Usage: cleanup-upload.ts FILE_ID --delete-from-meta (deletes only that upload; no inference)');
  const result = await cleanupUpload({ apiKey: process.env.MODEL_API_KEY ?? '', fileId, save: async () => {} });
  console.log(JSON.stringify(result));
  if (result.status !== 'deleted') process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: error instanceof ModelError ? error.code : 'cleanup_failed' }));
  process.exitCode = 1;
}

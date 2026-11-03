// Explicit six-session evaluation spending; restart reuses durable reservations.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SessionLibrary } from '../src/server/session-library.ts';
import { analyzeSession } from '../src/server/session-analysis.ts';
import { createFindingsReport, loadFindingsReport } from '../src/server/report-storage.ts';

if (process.argv.length !== 4 || process.argv[3] !== '--upload-to-meta') throw new Error('Usage: analyze-evaluation.ts EVALUATION_ROOT --upload-to-meta (up to six paid calls, no retries)');
if (!process.env.MODEL_API_KEY) throw new Error('MODEL_API_KEY required server-side');
const root = resolve(process.argv[2]!);
const runs: { session_id: string; preparation_id: string }[] = JSON.parse(readFileSync(join(root, 'prepared.json'), 'utf8'));
if (runs.length !== 6) throw new Error('Exactly six prepared independent sessions required');
const library = await SessionLibrary.create(join(root, 'sessions'));
const results: unknown[] = [];
try {
  for (const run of runs) {
    const analysis = join(root, 'sessions', run.session_id, 'preparations', run.preparation_id, 'analysis');
    try {
      if (!existsSync(analysis)) {
        const preview = await analyzeSession(library, run.session_id, run.preparation_id);
        console.log(`Planned one paid request: ${run.session_id}, ${preview.duration_ms}ms, ${preview.video_bytes} video + ${preview.context_bytes} context bytes`);
        await analyzeSession(library, run.session_id, run.preparation_id, { upload_to_meta: true });
      }
      // Existing reserved attempt is NEVER repeated. Offline recovery only.
      const report = existsSync(join(analysis, 'findings.json')) ? await loadFindingsReport(library, run.session_id, run.preparation_id) : await createFindingsReport(library, run.session_id, run.preparation_id);
      results.push({ ...run, status: report.status, findings: report.findings.length, quarantined: report.quarantined.length, usage: report.analysis.usage, cost_usd: report.analysis.cost_usd, cleanup: report.analysis.cleanup_status });
      console.log(JSON.stringify(results.at(-1)));
    } catch {
      results.push({ ...run, status: 'failed_or_unfinished', message: 'Inspect durable stages; no retry performed and no clean result implied.' });
      console.log(JSON.stringify(results.at(-1)));
    }
    writeFileSync(join(root, 'results.json'), JSON.stringify(results, null, 2));
  }
} finally { await library.close(); }

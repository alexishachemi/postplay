// Deliberate, separately checkpointed follow-up, never an automatic retry loop.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { SessionLibrary } from '../src/server/session-library.ts';
import { prepareSession } from '../src/server/media-preparation.ts';
import { analyzeSession } from '../src/server/session-analysis.ts';
import { createFindingsReport, loadFindingsReport } from '../src/server/report-storage.ts';

if (process.argv.length !== 5 || process.argv[4] !== '--upload-to-meta') throw new Error('Usage: evaluation-followup.ts ROOT SESSION_UUID --upload-to-meta (one planned request;8192 output cap)');
if (!process.env.MODEL_API_KEY) throw new Error('MODEL_API_KEY required server-side');
const root = resolve(process.argv[2]!), id = process.argv[3]!;
const source = JSON.parse(readFileSync(join(root, 'prepared.json'), 'utf8')).find((r: { session_id: string }) => r.session_id === id);
assert.ok(source, 'Session must be in the prepared index');
const file = join(root, 'followups.json');
const entries: { session_id: string; preparation_id: string; replaces: string | null; status?: string; usage?: unknown }[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const library = await SessionLibrary.create(join(root, 'sessions'));
try {
  let entry = entries.find(r => r.session_id === id);
  if (!entry) {
    const original = join(root, 'sessions', id, 'preparations', source.preparation_id, 'analysis');
    let preparationId: string = source.preparation_id;
    if (existsSync(original)) {
      const failure = JSON.parse(readFileSync(join(original, 'failure.json'), 'utf8'));
      assert.equal(failure.code, 'model_incomplete', 'Only the inspected incomplete attempt may get a deliberate new preparation here');
      const response = JSON.parse(readFileSync(join(original, 'response.json'), 'utf8'));
      assert.equal(response.incomplete_details?.reason, 'max_output_tokens');
      preparationId = (await prepareSession(library, id, { start_ms: 0, duration_ms: 30000 })).preparation_id;
    }
    entry = { session_id: id, preparation_id: preparationId, replaces: preparationId === source.preparation_id ? null : source.preparation_id };
    entries.push(entry); writeFileSync(file, JSON.stringify(entries, null, 2));
  }
  const analysis = join(root, 'sessions', id, 'preparations', entry.preparation_id, 'analysis');
  if (!existsSync(analysis)) {
    const preview = await analyzeSession(library, id, entry.preparation_id, { max_output_tokens: 8192 });
    console.log(`One deliberate paid request: ${id}, ${preview.video_bytes} video + ${preview.context_bytes} context bytes, output cap8192`);
    await analyzeSession(library, id, entry.preparation_id, { upload_to_meta: true, max_output_tokens: 8192 });
  }
  const report = existsSync(join(analysis, 'findings.json')) ? await loadFindingsReport(library, id, entry.preparation_id) : await createFindingsReport(library, id, entry.preparation_id);
  entry.status = report.status; entry.usage = report.analysis.usage;
  writeFileSync(file, JSON.stringify(entries, null, 2));
  console.log(JSON.stringify({ ...entry, findings: report.findings.length, quarantined: report.quarantined.length, cleanup: report.analysis.cleanup_status }));
} finally { await library.close(); }

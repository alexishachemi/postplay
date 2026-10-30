import { SessionLibrary, IngestionError } from '../src/server/session-library.ts';
import { createFindingsReport, loadFindingsReport, ReportError } from '../src/server/report-storage.ts';
import { ModelError } from '../src/server/muse-api.ts';
import { PreparationError } from '../src/server/preparation-context.ts';

const [command, id, preparation, ...extra] = process.argv.slice(2);
let library: SessionLibrary | undefined;
try {
  if (!id || !preparation || extra.length || !['create', 'read'].includes(command ?? '')) throw new ReportError('usage', 'Usage: session-report.ts create|read SESSION_UUID PREPARATION_UUID (local only, no API key or upload)');
  library = await SessionLibrary.create();
  const report = await (command === 'create' ? createFindingsReport : loadFindingsReport)(library, id, preparation);
  console.log(JSON.stringify(command === 'read' ? report : { status: report.status, findings: report.findings.length, quarantined: report.quarantined.length,
    relative_path: `preparations/${preparation}/analysis/findings.json`, remote_upload: false }, null, 2));
} catch (error) {
  const known = error instanceof ReportError || error instanceof ModelError || error instanceof IngestionError || error instanceof PreparationError;
  console.error(JSON.stringify({ status: 'failed', error: known ? { code: error.code, message: error.message } : { code: 'report_invalid', message: 'Report validation failed; preserve source/stage files. No successful no-findings result is implied.' } }));
  process.exitCode = 1;
} finally { await library?.close(); }

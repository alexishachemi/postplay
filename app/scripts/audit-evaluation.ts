// Offline evaluation only. This joins local ground truth AFTER inference.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SessionLibrary } from '../src/server/session-library.ts';
import { loadFindingsReport } from '../src/server/report-storage.ts';
if (process.argv.length < 3) throw new Error('Usage: audit-evaluation.ts ROOT [ROOT...] (offline)');
globalThis.fetch = async () => { throw new Error('Offline audit forbids networking'); };
const rows: unknown[] = [];
let input = 0, output = 0, total = 0, cached = 0, attempts = 0;
for (const root of process.argv.slice(2).map(resolveRoot => resolve(resolveRoot))) {
  const index = JSON.parse(readFileSync(join(root, 'evaluation.json'), 'utf8'));
  const library = await SessionLibrary.create(join(root, 'sessions'));
  try {
    for (const run of index.runs) {
      const directory = join(root, 'sessions', run.session_id, 'preparations');
      for (const preparation of readdirSync(directory).sort()) {
        const analysis = join(directory, preparation, 'analysis');
        if (!existsSync(analysis)) continue;
        const fingerprint = () => readdirSync(analysis).sort().map(name => [name, createHash('sha256').update(readFileSync(join(analysis, name))).digest('hex')]);
        const before = fingerprint();
        const response = JSON.parse(readFileSync(join(analysis, 'response.json'), 'utf8'));
        const cleanup = JSON.parse(readFileSync(join(analysis, 'cleanup.json'), 'utf8'));
        const started = JSON.parse(readFileSync(join(analysis, 'started.json'), 'utf8'));
        const usage = response.usage;
        assert.ok(usage && typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number' && typeof usage.total_tokens === 'number');
        input += usage.input_tokens; output += usage.output_tokens; total += usage.total_tokens; cached += usage.input_tokens_details?.cached_tokens ?? 0; attempts++;
        const failure = existsSync(join(analysis, 'failure.json')) ? JSON.parse(readFileSync(join(analysis, 'failure.json'), 'utf8')).code : null;
        const report = failure ? null : await loadFindingsReport(library, run.session_id, preparation);
        assert.deepEqual(fingerprint(), before, 'Audit must not mutate saved attempts');
        rows.push({ root, session_id: run.session_id, preparation_id: preparation, scenario: run.scenario, fault_enabled: run.fault_enabled,
          status: report?.status ?? failure, output_cap: started.max_output_tokens, usage, cleanup: cleanup.status,
          findings_sha256: report ? before.find(([name]) => name === 'findings.json')?.[1] : null,
          timing: report?.timing ?? null,
          candidates: report ? [...report.findings, ...report.quarantined].map(c => ({ ...c.model_claim, issues: c.issues })) : [],
          raw_snapshots: report?.evidence_snapshots ?? [], stage_files: before.length });
      }
    }
  } finally { await library.close(); }
}
const audit = { method: 'Offline local truth join after real inference; failed attempts included', attempts, usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: total }, cost_usd: null, rows };
writeFileSync(join(resolve(process.argv[2]!), 'audit.json'), JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ attempts, usage: audit.usage, rows: (rows as { session_id: string; scenario: string; fault_enabled: boolean; status: string; candidates: { category: string; certainty: string; severity: string; start_ms: number; title: string }[] }[]).map(r => ({ id: r.session_id, scenario: r.scenario, fault: r.fault_enabled, status: r.status, candidates: r.candidates.map(c => ({ title: c.title, category: c.category, certainty: c.certainty, severity: c.severity, time: c.start_ms })) })) }, null, 2));

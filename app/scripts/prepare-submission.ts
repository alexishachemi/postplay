// Local developer packaging only. Never uploads, analyzes, or rewrites evidence.
import { cpSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { SessionLibrary } from '../src/server/session-library.ts';
import { loadFindingsReport } from '../src/server/report-storage.ts';
import { latestPreparation } from '../src/server/dashboard.ts';

const roots = process.argv.slice(2);
if (!roots.length) throw new Error('Usage: prepare-submission.ts SESSION_LIBRARY_ROOT [SESSION_LIBRARY_ROOT...] (local copies only)');
globalThis.fetch = async () => { throw new Error('Submission preparation forbids remote requests'); };
const outputParent = resolve('artifacts');
mkdirSync(outputParent, { recursive: true });
const output = mkdtempSync(join(outputParent, 'submission-'));
console.log(`Local output (partial until ready.json exists): ${output}`);
const destination = join(output, 'sessions'); mkdirSync(destination);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ids = new Set<string>();
const files: { path: string; bytes: number; sha256: string }[] = [];
let reports = 0;

function regularFiles(directory: string): string[] {
  const paths: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === '.env' || name.startsWith('.env.')) throw new Error('Refusing environment file in submission package');
    const path = join(directory, name), stat = lstatSync(path);
    if (stat.isDirectory()) paths.push(...regularFiles(path));
    else if (stat.isFile() && stat.nlink === 1) paths.push(path);
    else throw new Error('Submission source contains a link or nonregular file');
  }
  return paths.sort();
}
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
function preserveDirectoryTimes(source: string, target: string): void {
  for (const name of readdirSync(source)) {
    if (lstatSync(join(source, name)).isDirectory()) preserveDirectoryTimes(join(source, name), join(target, name));
  }
  const stat = lstatSync(source);
  utimesSync(target, stat.atime, stat.mtime);
}
const selections = new Map<string, string | null>();

for (const root of roots.map(path => resolve(path))) {
  const source = await SessionLibrary.create(root);
  try {
    const discovered = await source.discover();
    if (!discovered.ids.length) throw new Error('No portable sessions in source library');
    for (const id of discovered.ids) {
      if (ids.has(id)) throw new Error('Duplicate session UUID across libraries');
      ids.add(id);
      const inspection = await source.inspect(id);
      if (!inspection.ok) throw new Error(`Session ${id} is not a valid complete capture`);
      const directory = join(root, id), paths = regularFiles(directory);
      const target = join(destination, id);
      // Preserve directory mtimes: the dashboard selects preparation by mtime.
      cpSync(directory, target, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      // Node's preserveTimestamps only preserves file timestamps, not directories.
      preserveDirectoryTimes(directory, target);
      selections.set(id, await latestPreparation(source, id));
      for (const path of paths) {
        const copied = join(target, relative(directory, path));
        const sha256 = await digest(path);
        if (await digest(copied) !== sha256) throw new Error('Copied evidence hash mismatch');
        files.push({ path: relative(output, copied), bytes: lstatSync(copied).size, sha256 });
      }
    }
  } finally { await source.close(); }
}

// Reopen copies with the production offline loader, not merely a JSON parser.
const copied = await SessionLibrary.create(destination);
try {
  for (const id of ids) {
    if (await latestPreparation(copied, id) !== selections.get(id)) throw new Error('Copied dashboard preparation selection changed');
    const preparations = join(destination, id, 'preparations');
    if (!existsSync(preparations)) continue;
    for (const preparation of readdirSync(preparations).filter(name => uuid.test(name))) {
      if (!existsSync(join(preparations, preparation, 'analysis', 'report-completed.json'))) continue;
      await loadFindingsReport(copied, id, preparation); reports++;
    }
  }
} finally { await copied.close(); }
writeFileSync(join(output, 'ready.json'), JSON.stringify({
  purpose: 'Local judge-review copies; not uploaded, not fresh inference. Retains failed attempts and original model claims.',
  created_at: new Date().toISOString(), session_count: ids.size, validated_reports: reports,
  remote_calls: 0, bytes: files.reduce((total, file) => total + file.bytes, 0), files,
}, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output, session_root: destination, sessions: ids.size, validated_reports: reports, remote_calls: 0 }));

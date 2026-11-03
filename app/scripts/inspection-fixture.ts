import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInspectionFixture } from '../tests/fixtures/inspection-session.ts';

// Explicit local developer fixture, never a production report/analysis shortcut.
if (process.argv.length !== 3) throw new Error('Usage: inspection-fixture.ts OUTPUT_PREFIX (new unique directory; no upload)');
const prefix = resolve(process.argv[2]!);
await mkdir(dirname(prefix), { recursive: true, mode: 0o700 });
const root = await mkdtemp(prefix + '-');
const fixture = await createInspectionFixture(root);
console.log(JSON.stringify({ kind: 'SYNTHETIC UI FIXTURE — mocked inference, not empirical evaluation', session_root: root, session_id: fixture.id, preparation_id: fixture.preparation_id, remote_calls: 0 }, null, 2));

import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInspectionFixture, inspectionOutcomes, type InspectionOutcome } from '../tests/fixtures/inspection-session.ts';

// Explicit local developer fixture, never a production report/analysis shortcut.
if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: inspection-fixture.ts OUTPUT_PREFIX [populated|empty|quarantined|failed|malformed] (new unique directory; no upload)');
const outcome = process.argv[3] ?? 'populated';
if (!inspectionOutcomes.includes(outcome as InspectionOutcome)) throw new Error('Unknown synthetic fixture outcome');
const prefix = resolve(process.argv[2]!);
await mkdir(dirname(prefix), { recursive: true, mode: 0o700 });
const root = await mkdtemp(prefix + '-');
const fixture = await createInspectionFixture(root, outcome as InspectionOutcome);
console.log(JSON.stringify({ kind: 'SYNTHETIC UI FIXTURE — mocked inference, not empirical evaluation', outcome, session_root: root, session_id: fixture.id, preparation_id: fixture.preparation_id, remote_calls: 0 }, null, 2));

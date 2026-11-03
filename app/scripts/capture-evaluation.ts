// Explicit actual Movie Maker recordings (six, or one boundary pair). No API calls.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const repo = new URL('../..', import.meta.url).pathname;
const pairOnly = process.argv[2] === '--boundary-pair';
if (process.argv.length > (pairOnly ? 3 : 2)) throw new Error('Usage: capture-evaluation.ts [--boundary-pair]');
mkdirSync(join(repo, 'artifacts'), { recursive: true });
const root = mkdtempSync(join(repo, 'artifacts', 'evaluation-'));
const project = join(root, 'project');
cpSync(join(repo, 'demo'), project, { recursive: true, filter: path => !path.split('/').some(part => ['.godot', 'recordings', 'sessions', 'artifacts'].includes(part) || part === '.env' || part.startsWith('.env.')) });
const env: NodeJS.ProcessEnv = { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' }; delete env.MODEL_API_KEY;
execFileSync('godot', ['--headless', '--editor', '--import', '--quit', '--path', project], { env, stdio: 'pipe', timeout: 60000 });
const config = join(project, 'project.godot');
writeFileSync(config, readFileSync(config, 'utf8').replace('"res://addons/postplay/plugin.cfg"', '"res://addons/postplay/plugin.cfg", "res://tests/evaluation_driver/plugin.cfg"').replace('[autoload]', '[autoload]\n\nDepotReplay="*res://tests/depot_replay.gd"'));
// Disposable editor only: use the tested software/X11 path after hardware
// captures stalled. Never alter the owner's editor metadata/display settings.
writeFileSync(join(project, '.godot/editor/project_metadata.cfg'), '[game_view]\nembed_on_play=false\n');
console.log(`${pairOnly ? 'Two boundary' : 'Six'} controlled recording sessions; separate truth index: ${root}/evaluation.json`);
const stdout = execFileSync('godot', ['--editor', '--display-driver', 'x11', '--path', project, '--', root, ...(pairOnly ? ['boundary-pair'] : [])], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
assert.ok(stdout.includes('POSTPLAY_EVALUATION_COMPLETE '), 'Recording runner did not complete; inspect existing index before resuming');
const index = JSON.parse(readFileSync(join(root, 'evaluation.json'), 'utf8'));
assert.equal(index.runs.length, pairOnly ? 2 : 6);
console.log(JSON.stringify({ root, sessions: index.runs.map((run: { session_id: string }) => run.session_id), remote_calls: 0 }, null, 2));

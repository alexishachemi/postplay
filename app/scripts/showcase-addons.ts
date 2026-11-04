// Repository-local demo setup, not a game/runtime dependency or addon fork.
import { cpSync, existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [action, ...extra] = process.argv.slice(2);
if (!['install', 'check'].includes(action ?? '') || extra.length) throw new Error('Usage: showcase-addons.ts install|check');
const repo = fileURLToPath(new URL('../..', import.meta.url));
const source = join(repo, 'demo/addons/postplay');
const names = readdirSync(source).sort();
if (!names.every(name => lstatSync(join(source, name)).isFile())) throw new Error('Unexpected canonical addon layout');
for (const game of ['2d_platformer', 'top_down']) {
  const target = join(repo, 'demos', game, 'addons/postplay');
  if (!existsSync(target) && action === 'install') cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
  if (!existsSync(target)) throw new Error(`Addon missing in ${game}; run just showcases-install`);
  if (JSON.stringify(readdirSync(target).sort()) !== JSON.stringify(names)) throw new Error(`Addon layout differs in ${game}; inspect rather than silently overwrite`);
  for (const name of names) {
    if (!lstatSync(join(target, name)).isFile() || !readFileSync(join(source, name)).equals(readFileSync(join(target, name)))) throw new Error(`Addon differs in ${game}/${name}; inspect rather than silently overwrite`);
  }
  console.log(`PASS: ${game} has the unchanged canonical addon (${names.length} files)`);
}

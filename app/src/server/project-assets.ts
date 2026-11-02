import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Source modules and Astro's bundled chunks sit at different depths. Locate the
// checked-in app package, not the process CWD or an untrusted request path.
function projectRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const value = JSON.parse(readFileSync(manifest, 'utf8'));
      if (value.name === 'postplay') return dirname(directory);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('Cannot locate PostPlay application assets');
}
const root = projectRoot();
/** Internal, versioned repository assets only; never pass browser input here. */
export function projectAsset(path: string): URL {
  if (!/^(ai|contracts)\/[a-zA-Z0-9./_-]+$/.test(path) || path.split('/').includes('..')) throw new Error('Invalid project asset');
  return pathToFileURL(join(root, path));
}

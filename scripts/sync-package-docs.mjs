// Copies the repo's README.md and LICENSE into the CLI package before
// `npm pack` / `npm publish`. The root copies are the only ones in git.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['README.md', 'LICENSE']) {
  copyFileSync(join(root, name), join(root, 'packages', 'cli', name));
}

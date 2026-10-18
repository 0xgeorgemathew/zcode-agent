#!/usr/bin/env node
// Pre-publish check for both packages. Publishes nothing: it verifies the
// engine is built and pinned, runs the unit suite, packs both tarballs, and
// prints the publish commands in the order they must run (the engine first:
// zcode-agent depends on its exact version).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const cli = read('packages/cli/package.json');
const engine = read('packages/engine/package.json');
const pins = read('packages/engine/engine.json');
const problems = [];

if (cli.dependencies['@zcode-agent/engine'] !== engine.version) {
  problems.push(`zcode-agent depends on @zcode-agent/engine ${cli.dependencies['@zcode-agent/engine']}, the package is ${engine.version}`);
}
if (engine.version.split('-')[0] !== pins.engineVersion) problems.push(`engine package ${engine.version} vs engine.json ${pins.engineVersion}`);
const info = join(repo, 'packages/engine/dist/BUILD-INFO.json');
if (!existsSync(info)) problems.push('engine not built: npm run build:engine');
else {
  const built = JSON.parse(readFileSync(info, 'utf8'));
  if (built.tag !== pins.tag || built.engineVersion !== pins.engineVersion) {
    problems.push(`built engine is ${built.engineVersion} from ${built.tag}; engine.json pins ${pins.engineVersion} from ${pins.tag}: rebuild`);
  }
}
if (problems.length) {
  for (const p of problems) console.error(`release-check: ${p}`);
  process.exit(1);
}

execFileSync('npm', ['test'], { cwd: repo, stdio: 'inherit' });
for (const dir of ['packages/engine', 'packages/cli']) {
  const out = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: join(repo, dir), encoding: 'utf8' }))[0];
  console.log(`${out.name}@${out.version}: ${out.entryCount} files, ${(out.size / 1e6).toFixed(2)} MB packed, ${(out.unpackedSize / 1e6).toFixed(2)} MB unpacked`);
}
console.log(`
ready. Run the live suite (npm run test:live), then, in order:
  npm publish --workspace @zcode-agent/engine --access public
  npm publish --workspace zcode-agent --access public
  git tag v${cli.version} && git push origin main v${cli.version}`);

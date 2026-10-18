#!/usr/bin/env node
// Builds packages/engine/dist from the zai-org/ZCode tag pinned in
// packages/engine/engine.json: the headless engine (zcode.cjs), its builtin
// provider config, the content plugins and bundled skills the ZCode app
// ships, and upstream's license files. Nothing upstream is modified.
//
//   node scripts/build-engine.mjs            (macOS or Linux; needs git + network)
//
// ZCODE_ENGINE_BUILD_DIR picks the work dir (default: <tmp>/zcode-agent-engine-build,
// kept between runs). The pinned Node is downloaded into it; pnpm runs via npx.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(repo, 'packages', 'engine');
const pins = JSON.parse(readFileSync(join(pkgDir, 'engine.json'), 'utf8'));
const work = process.env.ZCODE_ENGINE_BUILD_DIR || join(tmpdir(), 'zcode-agent-engine-build');
const src = join(work, 'src');

function run(cmd, args, opts = {}) {
  console.log(`$ ${[cmd, ...args].join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    console.error(`build-engine: "${cmd} ${args.join(' ')}" failed (exit ${res.status ?? res.signal})`);
    process.exit(1);
  }
}

function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return res.status === 0 ? res.stdout.trim() : null;
}

if (process.platform === 'win32') {
  console.error('build-engine: build on macOS or Linux (the output runs everywhere).');
  process.exit(1);
}
mkdirSync(work, { recursive: true });

// 1. The pinned Node (upstream builds with it; the output targets node 22).
const arch = process.arch === 'x64' ? 'x64' : process.arch;
const nodeName = `node-v${pins.buildNode}-${process.platform}-${arch}`;
const nodeBin = join(work, 'node', nodeName, 'bin');
if (!existsSync(join(nodeBin, 'node'))) {
  mkdirSync(join(work, 'node'), { recursive: true });
  run('sh', ['-c', `curl -fsSL https://nodejs.org/dist/v${pins.buildNode}/${nodeName}.tar.gz | tar xz -C "${join(work, 'node')}"`]);
}
const env = { ...process.env, PATH: `${nodeBin}:${process.env.PATH}`, ZCODE_ENV: 'production' };
// ZCODE_ENV=production selects config/provider/zcode-builtin.json; without it
// the build silently bundles the .test.json provider config.

// 2. The pinned source.
if (!existsSync(join(src, '.git'))) {
  run('git', ['clone', '--depth', '1', '--branch', pins.tag, pins.repository, src]);
}
const tagCommit = capture('git', ['rev-parse', `${pins.tag}^{commit}`], { cwd: src });
const head = capture('git', ['rev-parse', 'HEAD'], { cwd: src });
if (!tagCommit || tagCommit !== head) {
  console.error(`build-engine: ${src} is not at ${pins.tag}; delete it or set ZCODE_ENGINE_BUILD_DIR.`);
  process.exit(1);
}
const declared = JSON.parse(readFileSync(join(src, 'apps', 'zcode-cli', 'package.json'), 'utf8')).version;
if (declared !== pins.engineVersion) {
  console.error(`build-engine: ${pins.tag} declares engine ${declared}, engine.json pins ${pins.engineVersion}.`);
  process.exit(1);
}

// 3. Build only the CLI engine and its workspace deps, then the minified
// bundle the desktop app ships.
const pnpm = ['-y', `pnpm@${pins.pnpm}`];
run('npx', [...pnpm, 'install', '--frozen-lockfile', '--filter', '@zcode/cli...'], { cwd: src, env });
run('npx', [...pnpm, '--filter', '@zcode/cli...', 'build'], { cwd: src, env });
run('npx', [...pnpm, '--filter', '@zcode/cli', 'build:desktop-agent'], { cwd: src, env });

// 4. Stage the runtime layout the engine expects next to itself.
const built = join(src, 'apps', 'zcode-cli', 'packages', 'cli', 'dist');
const dist = join(pkgDir, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const name of ['zcode.cjs', 'provider', 'THIRD-PARTY-NOTICES.md']) {
  cpSync(join(built, name), join(dist, name), { recursive: true });
}
// Same allow-list as upstream's packages/desktop/scripts/prepare-agent-node-bundle.mjs.
const TOP = ['.mcp.json', '.zcode-plugin', 'README.md', 'agents', 'commands', 'dist', 'docs', 'hooks',
  'output-styles', 'package.json', 'scripts', 'skills', 'templates'];
const SKIP = new Set(['.DS_Store', '.venv', '__pycache__', 'node_modules']);
const keep = (p) => !SKIP.has(basename(p)) && !p.endsWith('.pyc') && !p.endsWith('.map');
for (const plugin of pins.plugins) {
  const from = join(src, 'apps', 'zcode-cli', 'packages', plugin);
  const to = join(dist, 'packages', plugin);
  mkdirSync(to, { recursive: true });
  for (const entry of plugin === 'bundled-skills' ? ['README.md', 'skills'] : TOP) {
    if (existsSync(join(from, entry))) cpSync(join(from, entry), join(to, entry), { recursive: true, filter: keep });
  }
}
for (const name of ['LICENSE', 'NOTICE.md']) cpSync(join(src, name), join(pkgDir, name));

// 5. Smoke test in a scratch HOME, then record provenance.
const scratch = join(work, 'smoke-home');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const version = capture(process.execPath, [join(dist, 'zcode.cjs'), 'version'], {
  env: { ...process.env, HOME: scratch, ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(dist, 'provider', 'zcode-builtin.json') },
});
if (version !== pins.engineVersion) {
  console.error(`build-engine: built engine reports "${version}", expected ${pins.engineVersion}.`);
  process.exit(1);
}
const sha256 = createHash('sha256').update(readFileSync(join(dist, 'zcode.cjs'))).digest('hex');
writeFileSync(join(dist, 'BUILD-INFO.json'), JSON.stringify({
  repository: pins.repository,
  tag: pins.tag,
  commit: head,
  engineVersion: version,
  buildNode: pins.buildNode,
  pnpm: pins.pnpm,
  zcodeCjsSha256: sha256,
  plugins: pins.plugins,
}, null, 2) + '\n');
console.log(`build-engine: engine ${version} from ${pins.tag} (${head.slice(0, 12)}) → ${dist}\n  zcode.cjs sha256 ${sha256}`);

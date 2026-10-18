'use strict';
// TDD step 8 — packaging guard (offline, but it guards a real security
// property: the repo holds .env with a live key). Asserts the CLI tarball
// ships ONLY bin/, lib/, assets/, skills/, README.md, LICENSE, package.json
// — never .env, test/, or DESIGN.md — that the engine tarball ships the
// engine with upstream's license files, and that no shipped file of either
// CONTAINS the key material.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { loadEnvKey, repoRoot } = require('../helpers/env.js');

const ALLOWED_ROOTS = new Set([
  'skills',
  'assets',
  'bin',
  'lib',
  'README.md',
  'LICENSE',
  'package.json',
]);

test('npm pack ships only the allowlist and no key material', () => {
  const dest = mkdtempSync(path.join(tmpdir(), 'zcode-pack-'));
  try {
    const raw = execFileSync('npm', ['pack', '--json', '--pack-destination', dest], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    });
    const manifest = JSON.parse(raw);
    const tarball = path.join(dest, manifest[0].filename);
    const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' });

    const paths = listing
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^package\//, ''))
      .filter((p) => p.length > 0 && !p.endsWith('/'));

    assert.ok(paths.includes('bin/zcode-agent.js'), 'bin entry ships');
    assert.ok(paths.includes('assets/executor-agents.md'), 'executor AGENTS.md ships');
    assert.ok(paths.includes('README.md'), 'README ships');
    assert.ok(paths.includes('LICENSE'), 'LICENSE ships');
    assert.ok(paths.includes('package.json'), 'package.json ships');

    const offenders = paths.filter((p) => {
      const top = p.split('/')[0];
      return !ALLOWED_ROOTS.has(top);
    });
    assert.deepEqual(offenders, [], `only allowlisted roots may ship: ${offenders.join(', ')}`);

    assert.ok(!paths.some((p) => p === '.env' || p.endsWith('/.env')), '.env must not ship');
    assert.ok(!paths.some((p) => p.startsWith('test/')), 'test/ must not ship');
    assert.ok(!paths.some((p) => p === 'DESIGN.md'), 'DESIGN.md must not ship');

    // Content-level guard: extract and scan every shipped file for the live
    // key value (filenames only in failures — the key is never printed).
    const extractDir = path.join(dest, 'x');
    mkdirSync(extractDir, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', extractDir], { cwd: dest });
    const key = loadEnvKey();
    assert.ok(key, 'test API key must be loadable for the content scan');
    const { execSync } = require('node:child_process');
    let hits = '';
    try {
      hits = execSync(`grep -rlF ${JSON.stringify(key)} ${JSON.stringify(extractDir)}`, {
        encoding: 'utf8',
      });
    } catch {
      hits = ''; // grep exit 1 = no matches = what we want
    }
    assert.equal(hits.trim(), '', 'no shipped file may contain the API key');
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test('the engine tarball ships the built engine and upstream\'s license files, and no key material', () => {
  const engineDir = path.join(repoRoot, '..', 'engine');
  const dest = mkdtempSync(path.join(tmpdir(), 'zcode-engine-pack-'));
  try {
    const raw = execFileSync('npm', ['pack', '--json', '--pack-destination', dest], {
      cwd: engineDir,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    });
    const manifest = JSON.parse(raw)[0];
    const paths = manifest.files.map((f) => f.path);
    for (const p of ['index.js', 'engine.json', 'dist/zcode.cjs', 'dist/provider/zcode-builtin.json', 'dist/BUILD-INFO.json', 'LICENSE', 'NOTICE.md', 'dist/THIRD-PARTY-NOTICES.md']) {
      assert.ok(paths.includes(p), `${p} ships`);
    }
    assert.ok(!paths.some((p) => p.endsWith('.env') || p.endsWith('.map')), 'no .env or source maps');
    assert.ok(manifest.size < 12 * 1024 * 1024, `tarball stays small (${manifest.size} bytes)`);
    const extractDir = path.join(dest, 'x');
    mkdirSync(extractDir, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(dest, manifest.filename), '-C', extractDir]);
    const key = loadEnvKey();
    const { execSync } = require('node:child_process');
    let hits = '';
    try {
      hits = execSync(`grep -rlF ${JSON.stringify(key)} ${JSON.stringify(extractDir)}`, { encoding: 'utf8' });
    } catch {
      hits = '';
    }
    assert.equal(hits.trim(), '', 'no shipped file may contain the API key');
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

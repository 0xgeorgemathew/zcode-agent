'use strict';
// 1.0: the zcode-agent rename (state root migration), the packaged engine,
// remembered MCP failures and a login that never waits on a terminal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'zcode-agent.js');

test('an inherited server that failed is skipped for six hours, retried at once when its definition changes', () => {
  const { recordMcpHealth, readMcpHealth, effectiveMcpServers } = require('../../lib/isolation.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-health-'));
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-live-'));
  fs.mkdirSync(path.join(live, 'cli'));
  const write = (servers) => fs.writeFileSync(path.join(live, 'cli', 'config.json'), JSON.stringify({ mcp: { servers } }));
  const dead = { type: 'sse', url: 'https://dead.example.com/sse', headers: { Authorization: 'x' } };
  const ok = { command: 'ok-server' };
  write({ dead, ok });
  const now = Date.now();
  recordMcpHealth(root, { dead: { status: 'failed', error: 'timed out' }, ok: { status: 'connected' } }, { dead, ok }, now);
  const health = readMcpHealth(root);
  assert.deepEqual(Object.keys(health), ['dead']);
  assert.equal(health.dead.error, 'timed out');
  const names = (h) => Object.keys(effectiveMcpServers({ live, health: h, browser: false })).sort();
  assert.deepEqual(names(health), ['ok']);
  assert.deepEqual(names({ dead: { ...health.dead, failedAt: now - 7 * 3600 * 1000 } }), ['dead', 'ok'], 'retried after six hours');
  write({ dead: { ...dead, url: 'https://moved.example.com/sse' }, ok });
  assert.deepEqual(names(health), ['dead', 'ok'], 'an edited definition is retried at once');
  recordMcpHealth(root, { dead: { status: 'connected' } }, { dead }, now);
  assert.deepEqual(readMcpHealth(root), {}, 'a later success clears it');
});

test('buildEngineHome reports inherited servers and those skipped as unhealthy', () => {
  const { buildEngineHome, recordMcpHealth } = require('../../lib/isolation.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-root-'));
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-live-'));
  fs.mkdirSync(path.join(live, 'cli'));
  const dead = { command: 'dead' };
  fs.writeFileSync(path.join(live, 'cli', 'config.json'), JSON.stringify({ mcp: { servers: { dead, fine: { command: 'fine' } } } }));
  recordMcpHealth(root, { dead: { status: 'failed' } }, { dead });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-eh-'));
  const built = buildEngineHome({ home, root, live, key: 'k', browser: false, mcpSpecs: [{ mine: { command: 'm' } }] });
  assert.deepEqual(Object.keys(built.mcp.inherited), ['fine']);
  assert.deepEqual(built.mcp.skippedUnhealthy, ['dead']);
  assert.deepEqual(built.mcp.added, ['mine']);
  const hermetic = buildEngineHome({ home, root, live, key: 'k', browser: false, hermetic: true });
  assert.deepEqual(hermetic.mcp.inherited, {});
  assert.deepEqual(hermetic.mcp.skippedUnhealthy, []);
});

test('a pre-1.0 ~/.zcode-cli root moves to ~/.zcode-agent and leaves a symlink', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-home-'));
  fs.mkdirSync(path.join(home, '.zcode-cli', 'sessions', 's1'), { recursive: true });
  fs.writeFileSync(path.join(home, '.zcode-cli', 'credentials.json'), '{"apiKey":"k"}');
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    const { migrateRoot, rootDir } = require('../../lib/isolation.js');
    const env = { HOME: home };
    assert.equal(rootDir(env), path.join(home, '.zcode-agent'));
    migrateRoot(env);
    assert.ok(fs.existsSync(path.join(home, '.zcode-agent', 'sessions', 's1')));
    assert.ok(fs.lstatSync(path.join(home, '.zcode-cli')).isSymbolicLink());
    assert.equal(fs.readFileSync(path.join(home, '.zcode-cli', 'credentials.json'), 'utf8'), '{"apiKey":"k"}', 'old absolute paths still resolve');
    migrateRoot(env); // idempotent
    assert.ok(fs.lstatSync(path.join(home, '.zcode-cli')).isSymbolicLink());
  } finally {
    process.env.HOME = prev;
  }
});

test('the packaged engine wins over the app bundle; its provider config sits next to it', () => {
  const engine = require('../../lib/engine.js');
  const pkg = require('@zcode-agent/engine');
  if (!fs.existsSync(pkg.enginePath)) return; // source checkout without `npm run build:engine`
  const env = { PATH: '' };
  assert.equal(engine.resolveEngine(env), pkg.enginePath);
  assert.equal(engine.resolveBuiltinProviderConfig(pkg.enginePath, env), pkg.builtinProviderConfig);
  assert.notEqual(engine.resolveEngine({ ...env, ZAI_CODE_NO_PACKAGED_ENGINE: '1' }), pkg.enginePath);
});

test('the engine package pins the version the CLI depends on', () => {
  const cli = require('../../package.json');
  const enginePkg = require('@zcode-agent/engine/package.json');
  const pins = require('@zcode-agent/engine/engine.json');
  assert.equal(cli.dependencies['@zcode-agent/engine'], enginePkg.version, 'exact pin');
  assert.equal(enginePkg.version, pins.engineVersion);
});

test('login never waits on a terminal; a piped key is stored with mode 600', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-login-'));
  const res = spawnSync(process.execPath, [BIN, 'login'], { input: 'piped-key\n', env: { ...process.env, ZAI_CODE_HOME: root }, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout + res.stderr, /piped-key/);
  const file = path.join(root, 'credentials.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).apiKey, 'piped-key');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('standalone: the synthesized provider config carries modelConfigRules (the engine registers no zai-api model without it)', () => {
  const { buildEngineHome } = require('../../lib/isolation.js');
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-nolive-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-eh-'));
  const built = buildEngineHome({ home, live, key: 'k', browser: false });
  assert.equal(built.mode, 'synthesized');
  const pc = JSON.parse(fs.readFileSync(path.join(home, '.zcode', 'v2', 'provider_config.json'), 'utf8'));
  assert.deepEqual(pc.config.modelConfigRules, { providerModelRules: [], manualProviderModelRules: [] });
  assert.equal(pc.config.providerConfigRules.providerRules[0].config.access.apiKey, 'k');
});

test('standalone: no app Playwright server means the pinned headless one', () => {
  const { effectiveMcpServers, DEFAULT_BROWSER_SERVER } = require('../../lib/isolation.js');
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-nolive-'));
  assert.deepEqual(effectiveMcpServers({ live }), { playwright: DEFAULT_BROWSER_SERVER });
  assert.ok(DEFAULT_BROWSER_SERVER.args.includes('--headless') && DEFAULT_BROWSER_SERVER.args.includes('--isolated'));
  assert.deepEqual(effectiveMcpServers({ live, browser: false }), {});
});

'use strict';
// 1.3 speedups: the engine's compile cache, shared skill snapshots, backoff
// for MCP servers that keep failing, a verifier engine started during the
// checks, and ACP's prewarmed engine and lean MCP default.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setupFake, handback, invocation } = require('../helpers/fake.js');
const { startAgent, killAgents } = require('../helpers/acp-client.js');

const BOOT = path.join(__dirname, '..', '..', 'lib', 'engine-boot.js');

afterEach(killAgents);

const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (cond, ms = 8000) => {
  for (const end = Date.now() + ms; !cond(); ) {
    assert.ok(Date.now() < end, 'condition never became true');
    await new Promise((r) => setTimeout(r, 50));
  }
};

// --- engine compile cache -------------------------------------------------------

test('engine-boot runs the engine as if node started it, with a compile cache its children do not inherit', () => {
  const dir = tmp('zc-boot-');
  const engine = path.join(dir, 'zcode.cjs');
  fs.writeFileSync(engine, 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cache: process.env.ZCODE_COMPILE_CACHE ?? null }));\n');
  const cache = path.join(dir, 'cache');
  const res = spawnSync(process.execPath, [BOOT, engine, 'app-server', '--stdio'], {
    env: { ...process.env, ZCODE_COMPILE_CACHE: cache },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { argv: [engine, 'app-server', '--stdio'], cache: null });
  assert.ok(fs.readdirSync(cache).length > 0, 'the compile cache was written');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('engine env: the compile cache lives in the zcode-agent root; ZCODE_NO_COMPILE_CACHE=1 turns it off', () => {
  const { engineEnv } = require('../../lib/isolation.js');
  const parentEnv = { HOME: '/h', ZAI_CODE_HOME: '/r', PATH: '/bin' };
  assert.equal(engineEnv({ home: '/s', builtinProviderConfig: '/b', parentEnv }).ZCODE_COMPILE_CACHE, path.join('/r', 'compile-cache'));
  const off = engineEnv({ home: '/s', builtinProviderConfig: '/b', parentEnv: { ...parentEnv, ZCODE_NO_COMPILE_CACHE: '1', ZCODE_COMPILE_CACHE: '/x' } });
  assert.equal(off.ZCODE_COMPILE_CACHE, undefined);
});

// --- shared skill snapshots -----------------------------------------------------

test('desktop skills are linked from one shared snapshot; an edited skill makes a new one; stale ones are pruned', () => {
  const { buildEngineHome } = require('../../lib/isolation.js');
  const base = tmp('zc-skills-');
  const root = path.join(base, 'root');
  const live = path.join(base, 'live');
  const outside = path.join(base, 'claude-skills', 'linked');
  fs.mkdirSync(path.join(live, 'skills', 'local'), { recursive: true });
  fs.mkdirSync(path.join(live, 'skills', 'control-browser'), { recursive: true });
  fs.mkdirSync(path.join(outside, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(live, 'skills', 'local', 'SKILL.md'), '---\nname: local\n---\n');
  fs.writeFileSync(path.join(live, 'skills', 'control-browser', 'SKILL.md'), '---\nname: control-browser\n---\n');
  fs.writeFileSync(path.join(outside, 'SKILL.md'), '---\nname: linked\n---\nv1\n');
  fs.writeFileSync(path.join(outside, 'refs', 'a.md'), 'ref');
  fs.symlinkSync(outside, path.join(live, 'skills', 'linked'), 'dir');

  const build = (name) => {
    const home = path.join(base, name);
    const built = buildEngineHome({ home, root, live, key: 'k', browser: false });
    return { built, skills: path.join(home, '.zcode', 'skills') };
  };
  const a = build('a');
  const b = build('b');
  assert.equal(a.built.skillsCopied, 2);
  assert.deepEqual(fs.readdirSync(a.skills).sort(), ['linked', 'local'], 'host-only skills stay out');
  const target = (s, name) => fs.readlinkSync(path.join(s, name));
  const snapshot = path.dirname(target(a.skills, 'linked'));
  assert.equal(path.dirname(snapshot), path.join(root, 'shared', 'skills'));
  assert.equal(target(b.skills, 'linked'), target(a.skills, 'linked'), 'both sessions share one snapshot');
  assert.equal(fs.readFileSync(path.join(a.skills, 'linked', 'refs', 'a.md'), 'utf8'), 'ref');
  assert.equal(fs.lstatSync(path.join(snapshot, 'linked')).isSymbolicLink(), false, 'the snapshot is a copy, not a link into live dirs');

  fs.writeFileSync(path.join(outside, 'SKILL.md'), '---\nname: linked\n---\nv2, edited\n');
  const c = build('c');
  const next = path.dirname(target(c.skills, 'linked'));
  assert.notEqual(next, snapshot, 'an edited skill gets a new snapshot');
  assert.match(fs.readFileSync(path.join(c.skills, 'linked', 'SKILL.md'), 'utf8'), /v2, edited/);
  assert.ok(fs.existsSync(snapshot), 'a recent snapshot is kept for sessions still using it');

  const old = new Date(Date.now() - 15 * 24 * 3600 * 1000);
  fs.utimesSync(snapshot, old, old);
  build('d');
  assert.equal(fs.existsSync(snapshot), false, 'a snapshot unused for two weeks is pruned');

  const noRoot = buildEngineHome({ home: path.join(base, 'e'), live, key: 'k', browser: false });
  assert.equal(noRoot.skillsCopied, 2);
  assert.equal(fs.lstatSync(path.join(base, 'e', '.zcode', 'skills', 'linked')).isSymbolicLink(), false, 'without a root skills are copied');
  fs.rmSync(base, { recursive: true, force: true });
});

// --- MCP backoff ----------------------------------------------------------------

test('an inherited server that keeps failing waits twice as long each time (capped at four days)', () => {
  const { recordMcpHealth, readMcpHealth, effectiveMcpServers, mcpRetryAfter } = require('../../lib/isolation.js');
  const H = 3600 * 1000;
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => mcpRetryAfter(n) / H), [6, 12, 24, 48, 96, 96]);
  assert.equal(mcpRetryAfter(undefined), 6 * H, 'records from before 1.3 count as one failure');
  const root = tmp('zc-backoff-');
  const live = tmp('zc-live-');
  fs.mkdirSync(path.join(live, 'cli'));
  const dead = { command: 'dead' };
  fs.writeFileSync(path.join(live, 'cli', 'config.json'), JSON.stringify({ mcp: { servers: { dead } } }));
  const now = Date.now();
  recordMcpHealth(root, { dead: { status: 'failed' } }, { dead }, now - 7 * H);
  recordMcpHealth(root, { dead: { status: 'failed' } }, { dead }, now);
  const health = readMcpHealth(root);
  assert.equal(health.dead.failures, 2);
  const names = (h) => Object.keys(effectiveMcpServers({ live, health: h, browser: false }));
  assert.deepEqual(names({ dead: { ...health.dead, failedAt: now - 7 * H } }), [], 'second failure: still skipped after 7 h');
  assert.deepEqual(names({ dead: { ...health.dead, failedAt: now - 13 * H } }), ['dead'], 'retried after 12 h');
  recordMcpHealth(root, { dead: { status: 'connected' } }, { dead }, now);
  assert.deepEqual(readMcpHealth(root), {});
});

// --- verifier engine started during the checks ---------------------------------

const vblock = '```zcode-visual\n[{"criterion":"CTA visible","viewport":"390x844","met":true,"seen":"Buy"}]\n```';
const engineStarts = (fake) => fake.log().filter((l) => l.enginePid).map((l) => l.enginePid);

test('the verifier engine starts while the checks run and is the one that verifies', async () => {
  const { execute } = require('../../lib/executor.js');
  const fake = setupFake();
  try {
    fake.setScript({ turns: [{ response: handback({ status: 'done', summary: 'ok' }) }, { response: vblock }] });
    const seen = path.join(fake.base, 'engines-during-check');
    const check = `sleep 1; grep -c '^{"enginePid"' "$FAKE_ENGINE_LOG" > "${seen}"`;
    const r = await execute(invocation(fake, { id: 'spare-1', contract: { visual: ['CTA visible'], checks: [check] } }));
    assert.equal(r.status, 'completed', JSON.stringify(r));
    assert.equal(r.visual[0].met, true);
    assert.equal(fs.readFileSync(seen, 'utf8').trim(), '2', 'implementer + verifier engines were up during the check');
    assert.equal(engineStarts(fake).length, 2, 'the early verifier engine was used, not a third one');
  } finally {
    fake.cleanup();
  }
});

test('failing checks kill the early verifier engine; no verifier turn runs', async () => {
  const { execute } = require('../../lib/executor.js');
  const fake = setupFake();
  try {
    fake.setScript({ turns: [{ response: handback({ status: 'done', summary: 'ok' }) }, { response: vblock }] });
    const r = await execute(invocation(fake, { id: 'spare-2', maxRepairs: 0, contract: { visual: ['CTA visible'], checks: ['sleep 0.5; false'] } }));
    assert.notEqual(r.status, 'completed');
    assert.equal(fake.log().filter((l) => l.method === 'session/send').length, 1, 'only the implementer turn was sent');
    const pids = engineStarts(fake);
    assert.equal(pids.length, 2);
    await until(() => pids.every((p) => !pidAlive(p)));
  } finally {
    fake.cleanup();
  }
});

// --- ACP: prewarmed engine, lean MCP --------------------------------------------

test('acp: the engine starts after session/new without a record; the first prompt reuses it and writes the record', async () => {
  const fake = setupFake({ turns: [{ response: 'hi' }] });
  try {
    const a = startAgent([], { env: { ZCODE_ACP_PREWARM_MS: '0' } });
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    const dir = path.join(fake.root, 'sessions', sessionId);
    await until(() => fake.log().some((l) => l.method === 'session/subscribe'));
    assert.equal(fs.existsSync(path.join(dir, 'session.json')), false, 'no record before the first prompt');
    assert.deepEqual((await a.ok('session/list', {})).sessions, []);
    const st = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'zcode-agent.js'), 'status', '--all', '--json'], { env: process.env, encoding: 'utf8' });
    assert.doesNotMatch(st.stdout, new RegExp(sessionId), 'status does not list a prewarmed session');

    const res = await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'hello' }] });
    assert.equal(res.stopReason, 'end_turn');
    assert.equal(engineStarts(fake).length, 1, 'the prompt used the prewarmed engine');
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
    assert.equal(record.kind, 'acp');
    assert.match(record.engineSessionId, /./);
    assert.ok(record.port >= 41000);
    assert.equal(record.turns, 1);
    assert.equal(fs.existsSync(path.join(dir, 'reserved.pid')), false);
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: a prewarmed session closed (or abandoned) before any prompt leaves nothing behind', async () => {
  const fake = setupFake();
  try {
    const a = startAgent([], { env: { ZCODE_ACP_PREWARM_MS: '0' } });
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    await until(() => fake.log().some((l) => l.method === 'session/subscribe'));
    const pid = engineStarts(fake)[0];
    await a.ok('session/close', { sessionId });
    assert.equal(fs.existsSync(path.join(fake.root, 'sessions', sessionId)), false);
    await until(() => !pidAlive(pid));

    const second = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    await until(() => engineStarts(fake).length === 2);
    assert.equal(await a.close(), 0);
    assert.equal(fs.existsSync(path.join(fake.root, 'sessions', second.sessionId)), false, 'client gone: the dir goes too');

    // An agent that was SIGKILLed leaves its reserved dir; the next one reaps it.
    const orphan = path.join(fake.root, 'sessions', 'zc-deadbeef');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'reserved.pid'), '999999');
    const kept = path.join(fake.root, 'sessions', 'zc-keep');
    fs.mkdirSync(kept);
    fs.writeFileSync(path.join(kept, 'reserved.pid'), String(process.pid));
    const b = startAgent([], { env: { ZCODE_ACP_PREWARM_MS: 'off' } });
    await b.ok('initialize', { protocolVersion: 1 });
    await until(() => !fs.existsSync(orphan));
    assert.ok(fs.existsSync(kept), 'a live process keeps its reserved dir');
    await b.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: a probe that exits within the prewarm delay starts no engine', async () => {
  const fake = setupFake();
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    await a.close();
    assert.deepEqual(fake.log(), []);
    assert.equal(fs.existsSync(path.join(fake.root, 'sessions', sessionId)), false);
  } finally {
    fake.cleanup();
  }
});

test('acp: sessions get the client\'s MCP servers and the browser, not the desktop\'s others, unless --mcp-inherit', async () => {
  const fake = setupFake({ turns: [{ response: 'hi' }], mcpConnected: true });
  const servers = async (args) => {
    const a = startAgent(args, { base: [], env: { ZCODE_ACP_PREWARM_MS: 'off' } });
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', {
      cwd: fake.work,
      mcpServers: [{ name: 'client-tools', command: '/bin/echo', args: [], env: [] }],
    });
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'x' }] });
    const cfg = JSON.parse(fs.readFileSync(path.join(fake.root, 'sessions', sessionId, 'home', '.zcode', 'cli', 'config.json'), 'utf8'));
    await a.close();
    return Object.keys(cfg.mcp.servers).sort();
  };
  // A local desktop server (remote ones without credentials are never inherited).
  fs.writeFileSync(path.join(fake.live, 'cli', 'config.json'), JSON.stringify({ mcp: { servers: { desk: { command: 'desk-server' } } } }));
  try {
    assert.deepEqual(await servers([]), ['client-tools', 'playwright']);
    assert.deepEqual(await servers(['--mcp-inherit']), ['client-tools', 'desk', 'playwright']);
  } finally {
    fake.cleanup();
  }
});

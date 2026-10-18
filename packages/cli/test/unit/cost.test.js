'use strict';
// Cost at API list price: from each session's engine DB (cached input split
// out), with a usageTotal estimate fallback; `zcode cost <dir>` and watch.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const store = require('../../lib/store.js');
const cost = require('../../lib/cost.js');

const BIN = path.join(__dirname, '..', '..', 'bin', 'zcode-agent.js');
let sqlite = null;
try {
  sqlite = require('node:sqlite');
} catch {
  /* Node < 22.5: DB tests skip */
}

let root;
let work;
let saved;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-cost-'));
  work = path.join(root, 'work');
  fs.mkdirSync(path.join(work, 'sub'), { recursive: true });
  saved = { home: process.env.ZAI_CODE_HOME, app: process.env.ZCODE_APP_DB, prices: process.env.ZCODE_PRICES };
  process.env.ZAI_CODE_HOME = path.join(root, 'state');
  process.env.ZCODE_APP_DB = path.join(root, 'app.sqlite');
  delete process.env.ZCODE_PRICES;
});
afterEach(() => {
  for (const [k, v] of [['ZAI_CODE_HOME', saved.home], ['ZCODE_APP_DB', saved.app], ['ZCODE_PRICES', saved.prices]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const cli = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: work, env: process.env, encoding: 'utf8' });

function engineDb(file, rows, { sessions = [] } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec(`CREATE TABLE session (id text primary key, title text, directory text);
    CREATE TABLE model_usage (id text primary key, session_id text, model_id text, status text, started_at integer,
      completed_at integer, input_tokens integer, output_tokens integer, cache_read_input_tokens integer,
      cache_creation_input_tokens integer)`);
  for (const s of sessions) db.prepare('INSERT INTO session VALUES (?, ?, ?)').run(s.id, s.title, s.directory);
  rows.forEach((r, i) => {
    db.prepare('INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      `u${i}`, r.session || 'sess_a', r.model, 'completed', 1000 + i, 2000 + i, r.input, r.output, r.cached || 0, 0
    );
  });
  db.close();
}

test('priceOf splits cached input; unknown models have no price; ZCODE_PRICES overrides', () => {
  // 1M input of which 0.9M cached, 0.1M output on Flash: 0.1*0.15 + 0.9*0.03 + 0.1*0.5
  const usd = cost.priceOf('GLM-5.3-Flash', { input: 1e6, cached: 9e5, output: 1e5 });
  assert.ok(Math.abs(usd - (0.015 + 0.027 + 0.05)) < 1e-9);
  assert.ok(cost.priceOf('glm-5.3', { input: 1e6, output: 0 }) - 1.4 < 1e-9);
  assert.equal(cost.priceOf('mystery', { input: 1 }), null);
  const env = { ZCODE_PRICES: JSON.stringify({ 'GLM-5.3-Flash': { output: 1 }, mystery: { input: 2, output: 2 } }) };
  assert.ok(Math.abs(cost.priceOf('GLM-5.3-Flash', { output: 1e6 }, env) - 1) < 1e-9);
  assert.ok(Math.abs(cost.priceOf('mystery', { input: 1e6 }, env) - 2) < 1e-9);
});

test('sessionCost reads the engine DB (all engine sessions, every model); falls back to a usageTotal estimate', { skip: !sqlite }, () => {
  store.createSession('c-1', { kind: 'task', cwd: work, model: 'GLM-5.3-Flash', effort: 'max', owns: [], checks: [] });
  engineDb(cost.engineDbOf('c-1'), [
    { model: 'GLM-5.3-Flash', input: 100000, cached: 90000, output: 1000 },
    { model: 'GLM-5.3-Flash', session: 'sess_verifier', input: 50000, cached: 40000, output: 500 },
    { model: 'GLM-5.3', input: 10000, cached: 0, output: 100 },
  ]);
  const c = cost.sessionCost(store.readSession('c-1'));
  assert.equal(c.requests, 3);
  assert.equal(c.cached, 130000);
  assert.equal(Object.keys(c.models).length, 2);
  const expect = cost.priceOf('GLM-5.3-Flash', { input: 150000, cached: 130000, output: 1500 }) + cost.priceOf('GLM-5.3', { input: 10000, output: 100 });
  assert.ok(Math.abs(c.usd - expect) < 1e-12);
  assert.equal(c.estimate, undefined);

  store.createSession('c-2', { kind: 'task', cwd: work, model: 'GLM-5.3-Flash', effort: 'max', owns: [], checks: [] });
  store.updateSession('c-2', { usageTotal: { inputTokens: 1e6, outputTokens: 0, modelRequests: 4 } });
  const e = cost.sessionCost(store.readSession('c-2'));
  assert.equal(e.estimate, true);
  assert.ok(Math.abs(e.usd - 0.15) < 1e-9);
  store.createSession('c-3', { kind: 'task', cwd: work, model: 'GLM-5.3-Flash', effort: 'max', owns: [], checks: [] });
  assert.equal(cost.sessionCost(store.readSession('c-3')), null);
});

test('zcode-agent cost <dir>: sessions in the dir and below, totals, --json, --app; --app only with cost', { skip: !sqlite }, () => {
  store.createSession('in-1', { kind: 'task', cwd: work, model: 'GLM-5.3-Flash', effort: 'max', owns: [], checks: [] });
  store.createSession('in-2', { kind: 'task', cwd: path.join(work, 'sub'), model: 'GLM-5.3-Flash', effort: 'max', owns: [], checks: [] });
  store.createSession('out-1', { kind: 'task', cwd: root, model: 'GLM-5.3-Flash', effort: 'max', owns: [], checks: [] });
  for (const id of ['in-1', 'in-2', 'out-1']) engineDb(cost.engineDbOf(id), [{ model: 'GLM-5.3-Flash', input: 1e6, cached: 0, output: 0 }]);
  engineDb(process.env.ZCODE_APP_DB, [
    { model: 'GLM-5.3-Flash', session: 'sess_app1', input: 2e6, output: 0 },
    { model: 'GLM-5.3-Flash', session: 'sess_elsewhere', input: 9e6, output: 0 },
  ], { sessions: [{ id: 'sess_app1', title: 'Desktop chat', directory: path.join(work, 'sub') }, { id: 'sess_elsewhere', title: 'x', directory: '/elsewhere' }] });

  const j = JSON.parse(cli(['cost', '--json']).stdout);
  assert.equal(j.type, 'cost');
  assert.deepEqual(j.sessions.map((s) => s.id).sort(), ['in-1', 'in-2']);
  assert.ok(Math.abs(j.total.usd - 0.3) < 1e-9);
  assert.equal(j.app, undefined);

  const a = JSON.parse(cli(['cost', work, '--app', '--json']).stdout);
  assert.deepEqual(a.app.sessions.map((s) => s.id), ['sess_app1']);
  assert.ok(Math.abs(a.total.usd - 0.6) < 1e-9);

  const human = cli(['cost', work, '--app']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /in-1 .*\$0\.15/);
  assert.match(human.stdout, /Desktop chat/);
  assert.match(human.stdout, /^total {2}3 sessions .*\$0\.60$/m);
  assert.equal(cli(['status', '--app']).status, 2);
  assert.ok(cli(['cost', '--help']).stdout.length <= 2000);
});

test('watch shows each session\'s cost and a total line for several sessions', { skip: !sqlite }, () => {
  for (const id of ['w-1', 'w-2']) {
    store.createSession(id, { kind: 'task', cwd: work, model: 'GLM-5.3-Flash', effort: 'max', owns: [], checks: [] });
    store.updateSession(id, { state: 'finished', status: 'completed', phase: 'done', activity: { modelRequests: 1 } });
    engineDb(cost.engineDbOf(id), [{ model: 'GLM-5.3-Flash', input: 2e6, cached: 0, output: 0 }]);
  }
  const r = cli(['watch', 'w-1', 'w-2']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^w-1  completed .* req 1  sub 0  \$0\.30$/m);
  assert.match(r.stdout, /^w-2  completed .*\$0\.30$/m);
});

test('watch shows a streaming request as thinking with its length, not as a stall', () => {
  store.createSession('th-1', { kind: 'task', cwd: work, model: 'GLM-5.3-Flash', effort: 'max', owns: [], checks: [] });
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  store.updateSession('th-1', {
    state: 'running', phase: 'verifying', phaseDetail: { round: 1 }, pid: process.pid,
    activity: { modelRequests: 15, lastTool: 'Skill', lastToolAt: ago(18 * 60000), lastEventAt: ago(1000),
      current: { doing: 'thinking', since: ago(18 * 60000), chars: 42000 } },
  });
  const r = spawnSync(process.execPath, [BIN, 'watch', 'th-1'], { cwd: work, env: process.env, encoding: 'utf8', timeout: 1500 });
  assert.match(r.stdout, /^th-1  running verifying round 1 .* last: Skill 18m ago  thinking 18m 42\.0k chars  req 15  sub 0/m);
  assert.doesNotMatch(r.stdout, /STALLED/);
});

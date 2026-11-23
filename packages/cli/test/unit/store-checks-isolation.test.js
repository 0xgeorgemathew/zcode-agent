'use strict';
// Session store, acceptance-check runner, per-session engine HOME, UI
// formatting and argv parsing — all in-process, no engine, no model.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let base;
before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-misc-')));
  process.env.ZAI_CODE_HOME = path.join(base, 'root');
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

const store = () => require('../../lib/store.js');

test('store: ids are claimed atomically; records update atomically; dead owners read as interrupted', async () => {
  const s = store();
  assert.ok(s.validId('page-1'));
  assert.ok(!s.validId('../x'));
  assert.ok(!s.validId(''));
  assert.match(s.newId(), /^zc-[0-9a-f]{8}$/);

  s.createSession('one', { kind: 'task', cwd: '/w' });
  assert.throws(() => s.createSession('one', {}), s.SessionExistsError);
  s.updateSession('one', { state: 'running', engineSessionId: 'sess_x' });
  assert.equal(s.viewSession(s.readSession('one')).state, 'running', 'own pid is alive');
  assert.equal(s.resolveSessionId('sess_x'), 'one', 'engine ids resolve (0.3 compat)');
  assert.equal(s.resolveSessionId('nope'), null);

  const dead = spawn(process.execPath, ['-e', '']);
  await new Promise((r) => dead.on('exit', r));
  s.updateSession('one', { pid: dead.pid });
  const view = s.viewSession(s.readSession('one'));
  assert.equal(view.state, 'interrupted');
  assert.equal(view.live, false);

  for (let i = 0; i < 3; i++) s.appendEvent('one', { type: 'tool', name: `T${i}` });
  assert.deepEqual(s.readEvents('one', { tail: 2 }).map((e) => e.name), ['T1', 'T2']);
  assert.equal(s.listSessions()[0].id, 'one');
});

test('checks: pass, fail with output tail, timeout kills the process group, abort cancels', async () => {
  const { runCheck, runChecks } = require('../../lib/checks.js');
  const ok = await runCheck('echo hi', { cwd: base });
  assert.equal(ok.ok, true);
  assert.match(ok.output, /hi/);

  const bad = await runCheck('printf "%05000d" 0; echo END >&2; exit 4', { cwd: base });
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 4);
  assert.ok(bad.output.length <= 4000);
  assert.match(bad.output, /END/);

  const marker = path.join(base, 'grandchild-survived');
  const t0 = Date.now();
  const slow = await runCheck(`(sleep 2; touch ${marker}) & sleep 5`, { cwd: base, timeoutMs: 300 });
  assert.equal(slow.timedOut, true);
  assert.ok(Date.now() - t0 < 2000);
  await new Promise((r) => setTimeout(r, 2200));
  assert.ok(!fs.existsSync(marker), 'background grandchild was killed with the group');

  const ac = new AbortController();
  setTimeout(() => ac.abort(), 200);
  const results = await runChecks(['sleep 5', 'echo never'], { cwd: base, signal: ac.signal });
  assert.equal(results.length, 1, 'later checks skipped after cancel');
  assert.equal(results[0].cancelled, true);

  assert.equal((await runCheck('echo $CI', { cwd: base, env: {} })).output.trim(), '1', 'CI=1 by default');
});

test('isolation: per-session HOME refresh rewrites config but never engine state', () => {
  const { buildEngineHome } = require('../../lib/isolation.js');
  const live = path.join(base, 'live');
  fs.mkdirSync(path.join(live, 'v2'), { recursive: true });
  fs.mkdirSync(path.join(live, 'skills', 's1'), { recursive: true });
  fs.writeFileSync(path.join(live, 'v2', 'setting.json'), '{"a":1}');
  fs.writeFileSync(path.join(live, 'v2', 'credentials.json'), '{"oauth":1}');
  fs.writeFileSync(path.join(live, 'v2', 'tasks-index.sqlite'), 'db');
  fs.writeFileSync(path.join(live, 'skills', 's1', 'SKILL.md'), 's');
  const extra = path.join(base, 'extra-skill');
  fs.mkdirSync(extra);
  fs.writeFileSync(path.join(extra, 'SKILL.md'), 'x');

  const home = path.join(base, 'sess', 'home');
  const root = path.join(base, 'root');
  const first = buildEngineHome({
    home, root, key: 'K1', live,
    mcpSpecs: [{ word: { type: 'stdio', command: 'node' } }],
    skillsDirs: [extra],
    inheritDesktop: true,
  });
  assert.equal(first.mode, 'synthesized');
  assert.deepEqual(first.mcp.added, ['word']);
  assert.deepEqual(first.skillsInjected, ['extra-skill']);
  assert.equal(first.skillsCopied, 1);
  const z = path.join(home, '.zcode');
  assert.ok(!fs.existsSync(path.join(z, 'v2', 'credentials.json')));
  assert.ok(!fs.existsSync(path.join(z, 'v2', 'tasks-index.sqlite')));
  assert.equal(fs.statSync(path.join(z, 'v2', 'provider_config.json')).mode & 0o777, 0o600);
  assert.ok(fs.lstatSync(path.join(z, 'cli', 'plugins')).isSymbolicLink(), 'plugin cache shared');

  // Engine state written during the session…
  fs.mkdirSync(path.join(z, 'cli', 'db'), { recursive: true });
  fs.writeFileSync(path.join(z, 'cli', 'db', 'db.sqlite'), 'sessions');
  // …survives a refresh with a new key and no extra skills/MCP.
  const second = buildEngineHome({ home, root, key: 'K2', live, noSkills: true, browser: false });
  assert.equal(fs.readFileSync(path.join(z, 'cli', 'db', 'db.sqlite'), 'utf8'), 'sessions');
  const pc = JSON.parse(fs.readFileSync(path.join(z, 'v2', 'provider_config.json'), 'utf8'));
  assert.equal(pc.config.providerConfigRules.providerRules[0].config.access.apiKey, 'K2');
  assert.deepEqual(fs.readdirSync(path.join(z, 'skills')), [], '--no-skills empties the set');
  assert.deepEqual(second.mcp.servers, {});
  const cfg = JSON.parse(fs.readFileSync(path.join(z, 'cli', 'config.json'), 'utf8'));
  assert.deepEqual(cfg.mcp.servers, {}, 'previous run\'s MCP servers do not leak');
});

test('ui: no ANSI without a TTY; handback summary leads with status, changes, checks', () => {
  const { formatResult, makeReporter } = require('../../lib/ui.js');
  const text = formatResult({
    status: 'failed', id: 'p1', kind: 'task', durationMs: 1200, summary: 'did most',
    changes: { tracking: 'git', files: [{ path: 'a', change: 'added', owned: true }, { path: 'b', change: 'modified', owned: false }] },
    checks: [{ command: 'npm test', ok: false, exitCode: 1 }], repairs: 2,
    issues: ['1 of 1 acceptance check(s) failing: npm test'], questions: [], unresolved: [], notVerified: [],
    error: { kind: 'checks_failed', message: '1 of 1 acceptance check(s) failing: npm test' },
  });
  assert.doesNotMatch(text, /\x1b\[/);
  const lines = text.split('\n');
  assert.match(lines[0], /^✗ failed {2}p1/);
  assert.ok(lines.includes('  A a'));
  assert.ok(lines.some((l) => /M b\s+outside owned scope/.test(l)));
  assert.ok(lines.some((l) => /checks {3}0\/1 passed {2}· {2}2 repair turns/.test(l)));
  assert.ok(lines.some((l) => /zcode-agent resume p1/.test(l)));

  let written = '';
  const stream = { isTTY: false, write: (s) => { written += s; } };
  const r = makeReporter({ stream, thinking: true });
  r.onEvent({ type: 'stream', kind: 'reasoning_delta', delta: 'a\nb' });
  r.onEvent({ type: 'stream', kind: 'reasoning_delta', delta: 'c\n' });
  r.onEvent({ type: 'phase', phase: 'checking', count: 2 });
  r.onEvent({ type: 'check', phase: 'finished', command: 'x', ok: true, durationMs: 1000 });
  assert.equal(written, '│ a\n│ bc\n● checking 2\n  ✓ x  1.0s\n');
  const quiet = makeReporter({ stream, quiet: true });
  written = '';
  quiet.onEvent({ type: 'phase', phase: 'executing' });
  assert.equal(written, '');
});

test('argv: task flags, session flags and defaults parse without spawning anything', () => {
  const { parseArgv } = require('../../bin/zcode-agent.js');
  const p = parseArgv(['task', '--id', 'page-2', '--owns', 'src/p2/**', '--check', 'npm test', '--check', 'npm run lint',
    '--accept', 'renders', '--max-repairs', '0', '--detach', '--json', 'Build', 'page', '2']);
  assert.equal(p.command, 'task');
  assert.equal(p.flags.id, 'page-2');
  assert.deepEqual(p.flags.check, ['npm test', 'npm run lint']);
  assert.equal(p.flags.maxRepairs, 0);
  assert.equal(p.flags.detach, true);
  assert.deepEqual(p.prompts, ['Build', 'page', '2']);
  assert.equal(parseArgv(['list']).command, 'status');
  assert.deepEqual(parseArgv(['resume', 'page-2', 'use', 'blue']).prompts, ['page-2', 'use', 'blue']);
  const run = parseArgv(['hello', 'status']);
  assert.equal(run.command, 'run', 'only the first word can be a command');
  assert.equal(run.flags.model, 'GLM-5.4');
  assert.equal(run.flags.effort, 'high');
});

// --- 1.4 ------------------------------------------------------------------------------

test('checks: a check is over when its shell exits; what it left running dies with it', async () => {
  const { runCheck, runChecks } = require('../../lib/checks.js');
  const started = Date.now();
  const r = await runCheck('sleep 30 & echo $!', { cwd: base, timeoutMs: 20000 });
  assert.equal(r.ok, true, 'a background child does not turn a pass into a timeout');
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  const pid = Number(r.output.trim());
  await new Promise((res) => setTimeout(res, 200));
  assert.throws(() => process.kill(pid, 0), 'the background child was killed');

  const crashed = await runCheck('kill -SEGV $$', { cwd: base });
  assert.equal(crashed.ok, false);
  assert.equal(crashed.exitCode, null);
  assert.match(crashed.output, /killed by SIGSEGV/);

  // The run's deadline bounds every check, not only the first.
  const t = Date.now();
  const results = await runChecks(['sleep 5', 'sleep 5'], { cwd: base, timeoutMs: 20000, deadline: Date.now() + 300 });
  assert.ok(results.every((c) => c.timedOut));
  assert.ok(Date.now() - t < 4000, 'two checks, about the 1 s floor each');
});

test('--mcp-list prints the server set with credentials redacted', () => {
  const { spawnSync } = require('node:child_process');
  const BIN = path.join(__dirname, '..', '..', 'bin', 'zcode-agent.js');
  const spec = {
    web: { type: 'http', url: 'https://u:p4ss@x.test/mcp?key=abc123&mode=1', headers: { Authorization: 'Bearer hdr-secret', 'X-Trace': 'keep' } },
    local: { type: 'stdio', command: 'srv', args: ['--key', 'the-zai-key-0123456789'], env: { API_TOKEN: 'env-secret', LOG_LEVEL: 'debug' } },
  };
  const res = spawnSync(process.execPath, [BIN, '--mcp-list', '--hermetic', '--no-browser', '--mcp', JSON.stringify(spec)], {
    encoding: 'utf8',
    env: { ...process.env, ZAI_API_KEY: 'the-zai-key-0123456789', ZAI_CODE_LIVE_DIR: path.join(base, 'no-live') },
  });
  assert.equal(res.status, 0, res.stderr);
  for (const secret of ['p4ss', 'abc123', 'hdr-secret', 'env-secret', 'the-zai-key-0123456789']) assert.ok(!res.stdout.includes(secret), secret);
  const { servers } = JSON.parse(res.stdout);
  assert.match(servers.web.url, /mode=1/);
  assert.equal(servers.web.headers['X-Trace'], 'keep');
  assert.equal(servers.local.env.LOG_LEVEL, 'debug');
});

test('isolation: one broken skill is left out; it does not fail every session', () => {
  const { buildEngineHome } = require('../../lib/isolation.js');
  const live = path.join(base, 'live-skills');
  const mk = (name) => {
    fs.mkdirSync(path.join(live, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(live, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  };
  mk('good');
  mk('dangling');
  fs.symlinkSync(path.join(base, 'nowhere'), path.join(live, 'skills', 'dangling', 'gone.md'));
  mk('loop');
  fs.symlinkSync(path.join(live, 'skills', 'loop'), path.join(live, 'skills', 'loop', 'self'), 'dir');
  for (const root of [path.join(base, 'root-skills'), null]) {
    const home = fs.mkdtempSync(path.join(base, 'home-'));
    const built = buildEngineHome({ home, root, key: 'k', live, browser: false });
    const skills = path.join(home, '.zcode', 'skills');
    assert.ok(fs.existsSync(path.join(skills, 'good', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(skills, 'dangling', 'SKILL.md')), 'copied without the dangling link');
    assert.ok(!fs.existsSync(path.join(skills, 'dangling', 'gone.md')));
    assert.deepEqual(built.skillsSkipped, fs.existsSync(path.join(skills, 'loop')) ? [] : ['loop']);
  }
});

test('argv: mistyped commands and unknown short flags are refused instead of becoming a paid prompt', () => {
  const { spawnSync } = require('node:child_process');
  const BIN = path.join(__dirname, '..', '..', 'bin', 'zcode-agent.js');
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, ZAI_CODE_ENGINE: '/nonexistent' } });
  const typo = run('stauts');
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /unknown command "stauts" \(did you mean "status"\?\)\. To send it as a prompt: zcode-agent run stauts/);
  assert.equal(run('-x').status, 2);
  assert.match(run('-version').stderr, /unknown flag -version/);
  assert.match(run('-v').stdout, /^\d+\.\d+\.\d+\n$/);
  const { parseArgv } = require('../../bin/zcode-agent.js');
  assert.deepEqual(parseArgv(['run', 'stauts']).prompts, ['stauts'], 'an explicit run sends anything');
  assert.deepEqual(parseArgv(['test']).prompts, ['test'], 'a short word two edits from a command is a prompt');
  assert.deepEqual(parseArgv(['--', '-x']).prompts, ['-x']);
  assert.deepEqual(parseArgv(['resume', 'myid', '-p', 'continue']).prompts, ['myid', 'continue'], '-p is the message, not the id');
  assert.deepEqual(parseArgv(['-p', 'hello', 'world']).prompts, ['hello', 'world']);
  assert.equal(run('plan', 'run', 'p.json', '--hermetic').status, 2, 'flags a plan would drop are refused');
});

'use strict';
// LIVE — `zcode-agent acp` against the real engine and GLM-5.3-Flash: a
// build-mode session asks the client before writing, a denied command
// never runs, a session reloads in a new process with its history, and
// cancel stops a running command.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkEngine, loadEnvKey } = require('../helpers/env.js');
const { startAgent, killAgents } = require('../helpers/acp-client.js');

afterEach(killAgents);

function env() {
  const key = loadEnvKey();
  return key ? { ZAI_API_KEY: key } : {};
}

const kindsOf = (a, sessionId) => a.updates.filter((u) => u.sessionId === sessionId).map((u) => u.update.sessionUpdate);
const textOf = (a, sessionId, kind = 'agent_message_chunk') => a.updates
  .filter((u) => u.sessionId === sessionId && u.update.sessionUpdate === kind)
  .map((u) => u.update.content.text).join('');

test('LIVE acp: approve a write, deny a delete, reload with history, cancel a command', { timeout: 900000 }, async () => {
  assert.ok(checkEngine().engineOk, 'engine bundle must exist for the live test');
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-acp-')));
  try {
    // 1. build mode: the Write is asked and approved; the rm is asked and denied.
    const decisions = [];
    const a = startAgent(['--effort', 'low'], {
      env: env(),
      onPermission: (p) => {
        const deny = /rm /.test(JSON.stringify(p.toolCall.rawInput || {}));
        decisions.push([p.toolCall.kind, deny ? 'deny' : 'allow']);
        const option = p.options.find((o) => o.kind === (deny ? 'reject_once' : 'allow_once'));
        return { outcome: { outcome: 'selected', optionId: option.optionId } };
      },
    });
    await a.ok('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const { sessionId } = await a.ok('session/new', { cwd: work, mcpServers: [] });
    const first = await a.ok('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Use the Write tool to create hello.txt containing exactly: hi\nThen reply with exactly: DONE' }],
    });
    assert.equal(first.stopReason, 'end_turn');
    assert.equal(fs.readFileSync(path.join(work, 'hello.txt'), 'utf8').trim(), 'hi');
    assert.deepEqual(decisions[0], ['edit', 'allow'], 'the write was asked as an edit and approved');
    assert.match(textOf(a, sessionId), /DONE/);
    const kinds = kindsOf(a, sessionId);
    assert.ok(kinds.includes('tool_call') && kinds.includes('usage_update'), kinds.join(','));
    const usage = a.updates.filter((u) => u.update.sessionUpdate === 'usage_update').pop().update;
    assert.ok(usage.used > 0 && usage.size >= 200000, JSON.stringify(usage));
    assert.ok(usage.cost && usage.cost.amount > 0, `GLM cost reported: ${JSON.stringify(usage.cost)}`);

    const second = await a.ok('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Run `rm hello.txt` with the Bash tool. If it is not allowed, reply with exactly: DENIED' }],
    });
    assert.equal(second.stopReason, 'end_turn');
    assert.ok(decisions.some(([kind, d]) => kind === 'execute' && d === 'deny'), JSON.stringify(decisions));
    assert.ok(fs.existsSync(path.join(work, 'hello.txt')), 'the denied rm never ran');
    assert.equal(await a.close(), 0);

    // 2. a new process lists and loads the session, with its history.
    const b = startAgent(['--effort', 'low'], { env: env() });
    await b.ok('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const list = await b.ok('session/list', { cwd: work });
    assert.deepEqual(list.sessions.map((s) => s.sessionId), [sessionId]);
    await b.ok('session/load', { sessionId, cwd: work, mcpServers: [] });
    const replay = b.updates.filter((u) => u.sessionId === sessionId);
    assert.ok(replay.some((u) => u.update.sessionUpdate === 'user_message_chunk' && /hello\.txt/.test(u.update.content.text)), 'user turns replayed');
    assert.ok(replay.some((u) => u.update.sessionUpdate === 'tool_call' && u.update.kind === 'edit'), 'tool calls replayed');

    // 3. full access, then cancel a long command mid-run.
    await b.ok('session/set_config_option', { sessionId, configId: 'mode', value: 'yolo' });
    const before = b.updates.length;
    const running = b.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Run `sleep 120` with the Bash tool, then reply with exactly: SLEPT' }] });
    const started = Date.now();
    while (!b.updates.slice(before).some((u) => u.update.sessionUpdate === 'tool_call_update' && u.update.status === 'in_progress')) {
      assert.ok(Date.now() - started < 180000, 'the sleep never started');
      await new Promise((r) => setTimeout(r, 250));
    }
    const cancelAt = Date.now();
    b.notify('session/cancel', { sessionId });
    assert.deepEqual(await running, { stopReason: 'cancelled' });
    assert.ok(Date.now() - cancelAt < 10000, 'cancel answered within ten seconds');
    assert.equal(await b.close(), 0);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

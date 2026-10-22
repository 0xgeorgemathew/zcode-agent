'use strict';
// 1.1: `zcode-agent acp` — the Agent Client Protocol agent. The mapping is
// tested as pure functions; the agent end to end as a real child process
// speaking ACP on stdio to the scripted fake engine.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { setupFake } = require('../helpers/fake.js');
const { startAgent, killAgents } = require('../helpers/acp-client.js');
const map = require('../../lib/acp-map.js');

const BIN = path.join(__dirname, '..', '..', 'bin', 'zcode-agent.js');

// --- mapping ------------------------------------------------------------------------

test('config options: mode, model and the efforts the model accepts', () => {
  const opts = map.configOptions({ mode: 'build', model: 'GLM-5.3-Flash', effort: 'max' }, { builtinConfig: '/nonexistent' });
  assert.deepEqual(opts.map((o) => [o.id, o.category, o.type, o.currentValue]), [
    ['mode', 'mode', 'select', 'build'],
    ['model', 'model', 'select', 'GLM-5.3-Flash'],
    ['effort', 'thought_level', 'select', 'max'],
  ]);
  assert.deepEqual(opts[0].options.map((o) => o.value), ['build', 'edit', 'plan', 'yolo']);
  assert.deepEqual(opts[1].options.map((o) => o.value), ['GLM-5.3-Flash', 'GLM-5.3']);
  assert.deepEqual(opts[2].options.map((o) => o.value), ['low', 'high', 'max']);
  assert.equal(map.effortFor('GLM-5.3', 'medium', { builtinConfig: '/nonexistent' }), 'max', 'an unsupported effort falls back to the highest');
  assert.equal(map.effortFor('GLM-5.3', 'low', { builtinConfig: '/nonexistent' }), 'low');
});

test('prompt blocks become one engine prompt; images are saved and named', () => {
  const saved = [];
  const text = map.promptText([
    { type: 'text', text: 'Fix the bug.' },
    { type: 'resource_link', uri: 'file:///repo/src/a%20b.js', name: 'a b.js' },
    { type: 'resource', resource: { uri: 'file:///repo/x.txt', text: 'hello' } },
    { type: 'image', data: Buffer.from('png').toString('base64'), mimeType: 'image/png' },
  ], { saveImage: (block, i) => { saved.push(block.mimeType); return `/tmp/img-${i}.png`; }, model: 'GLM-5.3-Flash', env: { ZAI_CODE_BUILTIN_PROVIDER_CONFIG: '/nonexistent' } });
  assert.deepEqual(saved, ['image/png']);
  assert.match(text, /^Fix the bug\./);
  assert.match(text, /Referenced: \/repo\/src\/a b\.js/);
  assert.match(text, /<file path="\/repo\/x\.txt">\nhello\n<\/file>/);
  assert.match(text, /Attached image: \/tmp\/img-0\.png \(open it with the Read tool\)/);
});

test('ACP mcpServers become engine MCP specs', () => {
  assert.deepEqual(map.mcpSpec([
    { name: 't3-code', command: '/bin/node', args: ['bridge'], env: [{ name: 'A', value: '1' }] },
    { type: 'http', name: 'web', url: 'https://x.example/mcp', headers: [{ name: 'Authorization', value: 'Bearer t' }] },
    { type: 'sse', name: 'events', url: 'https://y.example/sse', headers: [] },
    { name: '' },
  ]), {
    't3-code': { type: 'stdio', command: '/bin/node', args: ['bridge'], env: { A: '1' } },
    web: { type: 'http', url: 'https://x.example/mcp', headers: { Authorization: 'Bearer t' } },
    events: { type: 'sse', url: 'https://y.example/sse', headers: {} },
  });
});

test('engine tools get ACP titles, kinds, locations and diffs', () => {
  const cwd = '/repo';
  assert.deepEqual(map.toolInfo('Read', { file_path: '/repo/src/a.js', offset: 10 }, cwd), {
    title: 'Read src/a.js', kind: 'read', locations: [{ path: '/repo/src/a.js', line: 10 }],
  });
  const edit = map.toolInfo('Edit', { file_path: '/repo/a.js', old_string: 'x', new_string: 'y' }, cwd);
  assert.equal(edit.kind, 'edit');
  assert.deepEqual(edit.content, [{ type: 'diff', path: '/repo/a.js', oldText: 'x', newText: 'y' }]);
  assert.deepEqual(map.toolInfo('Write', { file_path: '/repo/n.txt', content: 'hi' }, cwd).content, [{ type: 'diff', path: '/repo/n.txt', oldText: null, newText: 'hi' }]);
  assert.deepEqual(map.toolInfo('Bash', { command: 'npm test', description: 'Run tests' }, cwd), { title: 'npm test', kind: 'execute' });
  assert.equal(map.toolInfo('WebFetch', { url: 'https://a.b' }).kind, 'fetch');
  assert.deepEqual(map.toolInfo('mcp__playwright__browser_navigate', {}), { title: 'playwright: browser_navigate', kind: 'other' });
});

// Frames shaped like the live engine's (probed against 0.16.9).
function ev(type, payload, sessionId = 'sess_1') {
  return { method: 'session/event', params: { sessionId, type, payload, timestamp: 1792702000000 } };
}

test('a live turn maps to message, thought, tool and plan updates', () => {
  const m = new map.TurnMapper({ engineSessionId: 'sess_1', cwd: '/w' });
  const feed = (f) => m.feed(f);
  assert.deepEqual(feed(ev('model.streaming', { kind: 'reasoning_delta', delta: 'hmm' })), [{ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }]);
  assert.deepEqual(feed(ev('model.streaming', { kind: 'text_delta', delta: 'hi' })), [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } }]);
  // TodoWrite: no tool call, a plan.
  assert.deepEqual(feed(ev('model.streaming', { kind: 'tool_input_start', toolCallId: 'c0', toolName: 'TodoWrite' })), []);
  assert.deepEqual(feed(ev('model.streaming', { kind: 'tool_call', toolCallId: 'c0', toolName: 'TodoWrite', input: { todos: [{ content: 'A', status: 'in_progress', priority: 'high' }, { content: 'B', status: 'pending' }] } })), [{
    sessionUpdate: 'plan',
    entries: [{ content: 'A', priority: 'high', status: 'in_progress' }, { content: 'B', priority: 'medium', status: 'pending' }],
  }]);
  assert.deepEqual(feed(ev('tool.updated', { kind: 'result', toolCallId: 'c0', result: { success: true, content: '{}' } })), []);
  // Bash: announced at input start, filled in when the input is complete.
  assert.deepEqual(feed(ev('model.streaming', { kind: 'tool_input_start', toolCallId: 'c1', toolName: 'Bash' })), [{ sessionUpdate: 'tool_call', toolCallId: 'c1', status: 'pending', title: 'Run command', kind: 'execute' }]);
  assert.deepEqual(feed(ev('model.streaming', { kind: 'tool_call', toolCallId: 'c1', toolName: 'Bash', input: { command: 'cat a.txt' } })), [{ sessionUpdate: 'tool_call_update', toolCallId: 'c1', title: 'cat a.txt', kind: 'execute', rawInput: { command: 'cat a.txt' } }]);
  assert.deepEqual(feed(ev('tool.updated', { kind: 'started', toolCallId: 'c1', toolName: 'Bash' })), [{ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress' }]);
  assert.deepEqual(feed(ev('tool.updated', { kind: 'result', toolCallId: 'c1', result: { success: true, content: 'hi' } })), [{
    sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'hi' } }], rawOutput: { stdout: 'hi' },
  }]);
  // A failed tool, frames of another (subagent) session, title and usage.
  feed(ev('model.streaming', { kind: 'tool_call', toolCallId: 'c2', toolName: 'Read', input: { file_path: '/w/x' } }));
  assert.equal(feed(ev('tool.updated', { kind: 'result', toolCallId: 'c2', result: { success: false, content: 'ENOENT' } }))[0].status, 'failed');
  assert.deepEqual(feed(ev('model.streaming', { kind: 'text_delta', delta: 'sub' }, 'sess_child')), []);
  assert.deepEqual(feed(ev('session.titleUpdated', { title: 'Fix it' })), [{ sessionUpdate: 'session_info_update', title: 'Fix it', updatedAt: new Date(1792702000000).toISOString() }]);
  feed(ev('session.updated', { type: 'model_request_completed', modelRequestSessionType: 'main', usage: { inputTokens: 1200, outputTokens: 34 } }));
  assert.equal(m.contextUsed, 1234);
  assert.deepEqual(m.feed({ method: 'state.updated', params: { patch: { mode: { current: 'build' } } } }), [{ sessionUpdate: 'current_mode_update', currentModeId: 'build' }]);
  assert.deepEqual(m.feed({ method: 'state.updated', params: { patch: { mode: { current: 'build' } } } }), [], 'no repeat for the same mode');
  // A denied call fails (no result event follows a denial).
  feed(ev('model.streaming', { kind: 'tool_call', toolCallId: 'c4', toolName: 'Bash', input: { command: 'rm x' } }));
  assert.deepEqual(feed(ev('permission.resolved', { toolCallId: 'c4', decision: 'deny', reason: 'no' })), [{
    sessionUpdate: 'tool_call_update', toolCallId: 'c4', status: 'failed',
    content: [{ type: 'content', content: { type: 'text', text: 'Denied: no' } }], rawOutput: { stdout: 'Denied: no' },
  }]);
  assert.deepEqual(feed(ev('permission.resolved', { toolCallId: 'c1', decision: 'allow' })), []);
  // The context window follows the engine's latest model list.
  m.feed({ method: 'state.updated', params: { patch: { model: { available: [{ ref: { modelId: 'GLM-5.3-Flash' }, contextWindow: 200000 }] } } } });
  assert.equal(map.contextWindow('GLM-5.3-Flash', { available: m.available }), 200000);
  assert.equal(map.contextWindow('GLM-5.3-Flash', { created: { projection: { contextWindow: 123 }, session: { model: { modelId: 'GLM-5.3-Flash' } } } }), 123);
  assert.equal(map.contextWindow('GLM-5.3', { created: { projection: { contextWindow: 123 }, session: { model: { modelId: 'GLM-5.3-Flash' } } } }), 1000000);
  // An open call is closed at the end of the turn.
  feed(ev('model.streaming', { kind: 'tool_input_start', toolCallId: 'c3', toolName: 'Edit' }));
  assert.deepEqual(m.closeOpen('failed'), [{ sessionUpdate: 'tool_call_update', toolCallId: 'c3', status: 'failed' }]);
});

test('titles: markup-wrapped first prompts are titled by the user request', () => {
  const prompt = '<t3_code_instructions>\n## mode\n</t3_code_instructions>\n\n<user_request>\nFix the login bug on Safari\n</user_request>';
  assert.equal(map.cleanTitle('<t3_code_instructions> ## T3 Code interaction mode: Defau...', prompt), 'Fix the login bug on Safari');
  assert.equal(map.cleanTitle('<x>', '<runtime_info>a</runtime_info>\nRename the button'), 'Rename the button');
  assert.equal(map.cleanTitle('Create hello.txt', prompt), 'Create hello.txt', 'plain engine titles are kept');
});

test('history replays visible user and assistant parts, tools and the last plan', () => {
  const updates = map.historyUpdates([
    { info: { role: 'assistant', semantics: { kind: 'timeline_event', uiVisibility: 'visible' } }, parts: [{ type: 'timeline' }] },
    { info: { role: 'user', semantics: { kind: 'user_prompt', uiVisibility: 'visible' } }, parts: [{ type: 'text', text: 'make hello.txt' }] },
    { info: { role: 'user', semantics: { kind: 'system_reminder', uiVisibility: 'hidden' } }, parts: [{ type: 'text', text: 'secret reminder' }] },
    { info: { role: 'assistant', semantics: { kind: 'assistant_response', uiVisibility: 'visible' } }, parts: [
      { type: 'step-start' },
      { type: 'tool', callID: 't0', tool: 'TodoWrite', state: { status: 'completed', input: { todos: [{ content: 'X', status: 'completed' }] } } },
      { type: 'tool', callID: 't1', tool: 'Write', state: { status: 'completed', input: { file_path: '/w/hello.txt', content: 'hi' }, output: 'File created' } },
      { type: 'text', text: 'done' },
    ] },
  ], { cwd: '/w' });
  assert.deepEqual(updates.map((u) => u.sessionUpdate), ['user_message_chunk', 'tool_call', 'agent_message_chunk', 'plan']);
  assert.equal(updates[0].content.text, 'make hello.txt');
  assert.equal(updates[1].title, 'Write hello.txt');
  assert.equal(updates[1].status, 'completed');
  assert.deepEqual(updates[1].content.map((c) => c.type), ['diff', 'content']);
  assert.deepEqual(updates[3].entries, [{ content: 'X', priority: 'medium', status: 'completed' }]);
});

test('engine permission requests map to ACP options and back to the engine reply', () => {
  const params = {
    toolCallId: 'call_1', toolName: 'Write', input: { file_path: '/w/a.txt', content: 'hi\n' },
    options: [
      { kind: 'allow_once', name: 'Allow once', optionId: 'allow_once', response: { decision: 'allow', reason: 'Approved once' } },
      { kind: 'allow_always', name: 'Always allow in this project', optionId: 'allow_project', response: { decision: 'allow', permissionUpdates: [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Write' }] }], reason: 'Approved for this project' } },
      { kind: 'deny', name: 'Deny', optionId: 'deny', response: { decision: 'deny', reason: 'no' } },
    ],
  };
  const { request, reply } = map.permissionRequest(params, { cwd: '/w' });
  assert.deepEqual(request.options, [
    { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow_project', name: 'Always allow in this project', kind: 'allow_always' },
    { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
  ]);
  assert.equal(request.toolCall.toolCallId, 'call_1');
  assert.equal(request.toolCall.kind, 'edit');
  assert.equal(request.toolCall.title, 'Write a.txt');
  assert.deepEqual(reply({ outcome: 'selected', optionId: 'allow_project' }), params.options[1].response);
  assert.deepEqual(reply({ outcome: 'selected', optionId: 'deny' }), { decision: 'deny', reason: 'no' });
  assert.equal(reply({ outcome: 'cancelled' }).decision, 'deny');
  const bare = map.permissionRequest({ toolName: 'Bash', input: { command: 'ls' }, requestId: 'r1' });
  assert.deepEqual(bare.request.options.map((o) => o.kind), ['allow_once', 'reject_once'], 'the basic kinds are always offered');

  const plan = map.planApprovalRequest({ requestId: 'p1', toolCallId: 'x', input: { plan: 'Do it' } });
  assert.equal(plan.request.toolCall.kind, 'switch_mode');
  assert.deepEqual(plan.reply({ outcome: 'selected', optionId: 'approve' }), { action: 'accept', content: { answer: 'approve' } });
  assert.equal(plan.reply({ outcome: 'cancelled' }).action, 'decline');
});

test('the headless permission reply carries no extra keys (the engine schema is strict)', () => {
  const { allowOnce } = require('../../lib/appserver.js');
  assert.deepEqual(allowOnce({ options: [{ kind: 'deny', optionId: 'd', response: { decision: 'deny' } }, { kind: 'allow_once', optionId: 'a', response: { decision: 'allow', reason: 'Approved once' } }] }), { decision: 'allow', reason: 'Approved once' });
  assert.equal(allowOnce({}), null);
});

// --- end to end ---------------------------------------------------------------------

afterEach(killAgents);

const kinds = (updates) => updates.map((u) => u.update.sessionUpdate);

test('acp: initialize advertises load, list, close, images and HTTP/SSE MCP', async () => {
  const fake = setupFake();
  try {
    const a = startAgent();
    const init = await a.ok('initialize', { protocolVersion: 1, clientCapabilities: {} });
    assert.equal(init.protocolVersion, 1);
    assert.equal(init.agentCapabilities.loadSession, true);
    assert.deepEqual(init.agentCapabilities.sessionCapabilities, { list: {}, close: {} });
    assert.equal(init.agentCapabilities.promptCapabilities.image, true);
    assert.deepEqual(init.agentCapabilities.mcpCapabilities, { http: true, sse: true });
    assert.equal(init.agentInfo.name, 'zcode-agent');
    assert.equal('info' in init, false, 'v1: no top-level info key');
    const bad = await a.call('nope/nothing', {});
    assert.equal(bad.error.code, -32601);
    assert.equal(await a.close(), 0);
  } finally {
    fake.cleanup();
  }
});

test('acp: session/new is free — a probe that never prompts leaves no session and no engine', async () => {
  const fake = setupFake();
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const s = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    assert.match(s.sessionId, /^zc-[0-9a-f]{8}$/);
    assert.deepEqual(s.modes.availableModes.map((m) => m.id), ['build', 'edit', 'plan', 'yolo']);
    assert.equal(s.modes.currentModeId, 'build');
    assert.deepEqual(s.configOptions.map((o) => o.currentValue), ['build', 'GLM-5.3-Flash', 'max']);
    const rel = await a.call('session/new', { cwd: 'relative/dir', mcpServers: [] });
    assert.equal(rel.error.code, -32602);
    await a.close();
    assert.equal(fs.existsSync(path.join(fake.root, 'sessions', s.sessionId)), false);
    assert.deepEqual(fake.log(), [], 'no engine was started');
  } finally {
    fake.cleanup();
  }
});

test('acp: no API key → session/new fails with auth_required', async () => {
  const fake = setupFake();
  try {
    const a = startAgent([], { env: { ZAI_API_KEY: '', ZCODE_NO_DESKTOP_KEY: '1' } });
    await a.ok('initialize', { protocolVersion: 1 });
    const res = await a.call('session/new', { cwd: fake.work, mcpServers: [] });
    assert.equal(res.error.code, -32000);
    assert.match(res.error.message, /Authentication required/);
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: a prompt streams text, tools, plan, title and usage, and is a zcode-agent session', async () => {
  const fake = setupFake({
    turns: [{
      response: 'done',
      events: [
        { type: 'session.titleUpdated', payload: { title: 'Make hello' } },
        { type: 'model.streaming', payload: { kind: 'tool_call', toolCallId: 'c0', toolName: 'TodoWrite', input: { todos: [{ content: 'write', status: 'in_progress' }] } } },
        { type: 'model.streaming', payload: { kind: 'tool_input_start', toolCallId: 'c1', toolName: 'Write' } },
        { type: 'model.streaming', payload: { kind: 'tool_call', toolCallId: 'c1', toolName: 'Write', input: { file_path: 'WORK/hello.txt', content: 'hi' } } },
        { type: 'tool.updated', payload: { kind: 'started', toolCallId: 'c1', toolName: 'Write' } },
        { type: 'tool.updated', payload: { kind: 'result', toolCallId: 'c1', result: { success: true, content: 'File created' } } },
        { type: 'session.updated', payload: { type: 'model_request_completed', modelRequestSessionType: 'main', usage: { inputTokens: 5000, outputTokens: 20 } } },
      ],
    }],
  });
  try {
    const script = JSON.parse(fs.readFileSync(process.env.FAKE_ENGINE_SCRIPT, 'utf8'));
    script.turns[0].events[3].payload.input.file_path = path.join(fake.work, 'hello.txt');
    fake.setScript(script);
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    const res = await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'make hello.txt' }] });
    assert.equal(res.stopReason, 'end_turn');
    const mine = a.updates.filter((u) => u.sessionId === sessionId);
    assert.deepEqual(kinds(mine), [
      'session_info_update', 'plan', 'tool_call', 'tool_call_update', 'tool_call_update', 'tool_call_update', 'agent_thought_chunk', 'agent_message_chunk', 'usage_update',
    ]);
    const call = mine.find((u) => u.update.sessionUpdate === 'tool_call').update;
    assert.deepEqual([call.title, call.kind, call.status], ['Write', 'edit', 'pending'], 'announced as soon as the call starts streaming');
    const filled = mine[3].update;
    assert.equal(filled.title, 'Write hello.txt');
    assert.deepEqual(filled.content, [{ type: 'diff', path: path.join(fake.work, 'hello.txt'), oldText: null, newText: 'hi' }]);
    assert.equal(mine[5].update.status, 'completed');
    assert.equal(mine[7].update.content.text, 'done');
    const usage = mine[8].update;
    assert.equal(usage.used, 5020);
    assert.equal(usage.size, 200000);
    assert.equal(usage.cost.currency, 'USD');

    const record = JSON.parse(fs.readFileSync(path.join(fake.root, 'sessions', sessionId, 'session.json'), 'utf8'));
    assert.equal(record.kind, 'acp');
    assert.equal(record.engineSessionId, 'sess_fake1');
    assert.equal(record.label, 'Make hello');
    assert.deepEqual([record.state, record.status, record.phase], ['finished', 'completed', 'idle'], 'idle between turns: not live for wait/watch/cancel');
    const sent = fake.log().filter((l) => l.method);
    assert.deepEqual(sent.filter((l) => l.method === 'session/setMode').map((l) => l.params.mode), [], 'created in build already');
    const send = sent.find((l) => l.method === 'session/send');
    assert.equal(send.params.content, 'make hello.txt');
    assert.equal(send.params.modelSelection.modelId, 'GLM-5.3-Flash');
    const home = fake.log().find((l) => l.turnStarted).home;
    assert.match(fs.readFileSync(path.join(home, '.zcode', 'AGENTS.md'), 'utf8'), /Agent Client Protocol/, 'the interactive instructions, not the executor\'s');

    assert.equal(await a.close(), 0);
    const closed = JSON.parse(fs.readFileSync(path.join(fake.root, 'sessions', sessionId, 'session.json'), 'utf8'));
    assert.equal(closed.state, 'finished');
    assert.equal(closed.closedReason, 'client closed stdin');
    for (const line of a.rawLines) assert.doesNotThrow(() => JSON.parse(line), 'stdout carries protocol frames only');
  } finally {
    fake.cleanup();
  }
});

test('acp: engine permission requests are asked of the client and its choice reaches the engine', async () => {
  const options = [
    { kind: 'allow_once', name: 'Allow once', optionId: 'allow_once', response: { decision: 'allow', reason: 'Approved once' } },
    { kind: 'deny', name: 'Deny', optionId: 'deny', response: { decision: 'deny', reason: 'no' } },
  ];
  const fake = setupFake({
    turns: [
      { response: 'first', permission: { toolCallId: 'c1', toolName: 'Bash', input: { command: 'rm -rf build' }, options } },
      { response: 'second', permission: { toolCallId: 'c2', toolName: 'Bash', input: { command: 'rm -rf dist' }, options } },
    ],
  });
  try {
    let n = 0;
    const a = startAgent([], { onPermission: () => ({ outcome: { outcome: 'selected', optionId: n++ === 0 ? 'allow_once' : 'deny' } }) });
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'clean' }] });
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'clean more' }] });
    assert.equal(a.permissions.length, 2);
    assert.equal(a.permissions[0].sessionId, sessionId);
    assert.equal(a.permissions[0].toolCall.title, 'rm -rf build');
    assert.equal(a.permissions[0].toolCall.kind, 'execute');
    assert.deepEqual(a.permissions[0].options.map((o) => o.kind), ['allow_once', 'reject_once']);
    const replies = fake.log().filter((l) => l.reply && l.result && l.result.decision).map((l) => l.result);
    assert.deepEqual(replies, [{ decision: 'allow', reason: 'Approved once' }, { decision: 'deny', reason: 'no' }]);
    const texts = a.updates.filter((u) => u.update.sessionUpdate === 'agent_message_chunk').map((u) => u.update.content.text);
    assert.deepEqual(texts, ['first [allow]', 'second [deny]']);
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: plan approval (ExitPlanMode) is a switch_mode permission', async () => {
  const fake = setupFake({ turns: [{ response: 'planned', planApproval: { toolCallId: 'p1', toolName: 'ExitPlanMode', input: { plan: 'Step 1' } } }] });
  try {
    const a = startAgent(['--mode', 'plan'], { onPermission: () => ({ outcome: { outcome: 'selected', optionId: 'approve' } }) });
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId, modes } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    assert.equal(modes.currentModeId, 'plan');
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'plan it' }] });
    assert.equal(a.permissions[0].toolCall.kind, 'switch_mode');
    assert.equal(a.permissions[0].toolCall.content[0].content.text, 'Step 1');
    const reply = fake.log().find((l) => l.reply && l.result && l.result.action);
    assert.deepEqual(reply.result, { action: 'accept', content: { answer: 'approve' } });
    assert.deepEqual(fake.log().filter((l) => l.method === 'session/setMode').map((l) => l.params.mode), ['plan']);
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: mode, model and effort switch per session; the engine follows', async () => {
  const fake = setupFake({ turns: [{ response: 'a' }, { response: 'b' }] });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'one' }] });
    const set = await a.ok('session/set_config_option', { sessionId, configId: 'mode', value: 'yolo' });
    assert.equal(set.configOptions.find((o) => o.id === 'mode').currentValue, 'yolo');
    await a.ok('session/set_config_option', { sessionId, configId: 'model', value: 'GLM-5.3' });
    const eff = await a.ok('session/set_config_option', { sessionId, configId: 'effort', value: 'low' });
    assert.deepEqual(eff.configOptions.map((o) => o.currentValue), ['yolo', 'GLM-5.3', 'low']);
    const badEffort = await a.call('session/set_config_option', { sessionId, configId: 'effort', value: 'medium' });
    assert.equal(badEffort.error.code, -32602);
    await a.ok('session/set_mode', { sessionId, modeId: 'edit' });
    assert.ok(a.updates.some((u) => u.update.sessionUpdate === 'current_mode_update' && u.update.currentModeId === 'edit'));
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'two' }] });
    const log = fake.log().filter((l) => l.method);
    assert.deepEqual(log.filter((l) => l.method === 'session/setMode').map((l) => l.params.mode), ['yolo', 'edit']);
    const sends = log.filter((l) => l.method === 'session/send');
    assert.deepEqual(sends.map((l) => [l.params.modelSelection.modelId, l.params.modelSelection.options.reasoningLevel]), [['GLM-5.3-Flash', 'max'], ['GLM-5.3', 'low']]);
    const record = JSON.parse(fs.readFileSync(path.join(fake.root, 'sessions', sessionId, 'session.json'), 'utf8'));
    assert.deepEqual([record.model, record.effort, record.acp.mode], ['GLM-5.3', 'low', 'edit']);
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: session/cancel stops the engine and the prompt ends "cancelled"', async () => {
  const fake = setupFake({ turns: [{ hang: true }] });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    const pending = a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'loop forever' }] });
    for (let i = 0; i < 100 && !fake.log().some((l) => l.method === 'session/send'); i++) await new Promise((r) => setTimeout(r, 50));
    a.notify('session/cancel', { sessionId });
    assert.deepEqual(await pending, { stopReason: 'cancelled' });
    assert.ok(fake.log().some((l) => l.method === 'session/stop'));
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: sessions are listed and loaded in a new process with their history', async () => {
  const fake = setupFake({
    turns: [{ response: 'hi', events: [{ type: 'session.titleUpdated', payload: { title: 'Greeting' } }] }, { response: 'again' }],
    messages: [
      { info: { role: 'user', semantics: { kind: 'user_prompt', uiVisibility: 'visible' } }, parts: [{ type: 'text', text: 'say hi' }] },
      { info: { role: 'assistant', semantics: { kind: 'assistant_response', uiVisibility: 'visible' } }, parts: [{ type: 'text', text: 'hi' }] },
    ],
  });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    await a.ok('session/new', { cwd: fake.work, mcpServers: [] }); // never prompted: not listed
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'say hi' }] });
    await a.ok('session/set_config_option', { sessionId, configId: 'mode', value: 'yolo' });
    await a.close();

    const b = startAgent();
    await b.ok('initialize', { protocolVersion: 1 });
    const list = await b.ok('session/list', { cwd: fake.work });
    assert.deepEqual(list.sessions.map((s) => [s.sessionId, s.cwd, s.title]), [[sessionId, fake.work, 'Greeting']]);
    assert.deepEqual((await b.ok('session/list', { cwd: fake.base })).sessions, [], 'filtered by cwd');
    const loaded = await b.ok('session/load', { sessionId, cwd: fake.work, mcpServers: [] });
    assert.equal(loaded.modes.currentModeId, 'yolo', 'the mode is remembered');
    const replay = b.updates.filter((u) => u.sessionId === sessionId);
    assert.deepEqual(kinds(replay), ['user_message_chunk', 'agent_message_chunk', 'session_info_update']);
    const resume = fake.log().find((l) => l.method === 'session/resume');
    assert.equal(resume.params.sessionId, 'sess_fake1');
    await b.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'again' }] });
    const missing = await b.call('session/load', { sessionId: 'zc-00000000', cwd: fake.work, mcpServers: [] });
    assert.equal(missing.error.code, -32002);
    await b.ok('session/close', { sessionId });
    const unknown = await b.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'x' }] });
    assert.equal(unknown.error.code, -32002);
    await b.close();
  } finally {
    fake.cleanup();
  }
});

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (cond, ms = 5000) => {
  for (const end = Date.now() + ms; !cond(); ) {
    assert.ok(Date.now() < end, 'condition never became true');
    await new Promise((r) => setTimeout(r, 25));
  }
};

test('acp: a failed load frees its lock and port, so a retry works', async () => {
  const fake = setupFake({ turns: [{ response: 'hi' }] });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'hi' }] });
    await a.close();

    fake.setScript({ turns: [{ response: 'hi' }], messagesFail: true });
    const b = startAgent();
    await b.ok('initialize', { protocolVersion: 1 });
    const first = await b.call('session/load', { sessionId, cwd: fake.work, mcpServers: [] });
    assert.match(first.error.message, /messages failed/);
    const ports = path.join(fake.root, 'ports');
    assert.deepEqual(fs.existsSync(ports) ? fs.readdirSync(ports) : [], [], 'port released');
    fake.setScript({ turns: [{ response: 'hi' }] });
    await b.ok('session/load', { sessionId, cwd: fake.work, mcpServers: [] });
    await b.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: a cancel written together with its prompt cancels it, even mid-start', async () => {
  const fake = setupFake({ turns: [{ hang: true }] });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    const prompt = a.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'x' }] });
    a.notify('session/cancel', { sessionId }); // same tick: one chunk on the agent's stdin
    assert.deepEqual((await prompt).result, { stopReason: 'cancelled' });
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: one prompt at a time per session', async () => {
  const fake = setupFake({ turns: [{ hang: true }] });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    const first = a.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'x' }] });
    const second = await a.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'y' }] });
    assert.equal(second.error.code, -32600);
    a.notify('session/cancel', { sessionId });
    assert.equal((await first).result.stopReason, 'cancelled');
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: session/close during a turn stops it and leaves the record closed', async () => {
  const fake = setupFake({ turns: [{ hang: true }] });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    const prompt = a.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'x' }] });
    await until(() => fake.log().some((l) => l.method === 'session/send'));
    await a.ok('session/close', { sessionId });
    assert.equal((await prompt).result.stopReason, 'cancelled');
    const enginePid = fake.log().find((l) => l.enginePid).enginePid;
    await until(() => !pidAlive(enginePid));
    const updatesAfter = a.updates.length;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(a.updates.length, updatesAfter, 'nothing is sent for a closed session');
    const record = JSON.parse(fs.readFileSync(path.join(fake.root, 'sessions', sessionId, 'session.json'), 'utf8'));
    assert.deepEqual([record.state, record.phase, record.closedReason], ['finished', 'done', 'closed']);
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: an engine that died between turns is restarted and resumed', async () => {
  const fake = setupFake({ turns: [{ response: 'one', exitAfter: true }, { response: 'two' }] });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: '1' }] });
    const firstPid = fake.log().find((l) => l.enginePid).enginePid;
    await until(() => !pidAlive(firstPid));
    assert.equal((await a.ok('session/prompt', { sessionId, prompt: [{ type: 'text', text: '2' }] })).stopReason, 'end_turn');
    assert.equal(fake.log().find((l) => l.method === 'session/resume').params.sessionId, 'sess_fake1');
    await a.close();
  } finally {
    fake.cleanup();
  }
});

test('acp: the client leaving mid-start kills the starting engine', async () => {
  const fake = setupFake({ turns: [{ response: 'x' }], createHangs: true });
  try {
    const a = startAgent();
    await a.ok('initialize', { protocolVersion: 1 });
    const { sessionId } = await a.ok('session/new', { cwd: fake.work, mcpServers: [] });
    a.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'x' }] });
    await until(() => fake.log().some((l) => l.method === 'session/create'));
    const enginePid = fake.log().find((l) => l.enginePid).enginePid;
    assert.equal(await a.close(), 0);
    await until(() => !pidAlive(enginePid));
  } finally {
    fake.cleanup();
  }
});

test('acp: the zcode-agent-acp bin is `zcode-agent acp` with no arguments', async () => {
  const fake = setupFake();
  try {
    const child = require('node:child_process').spawn(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'zcode-agent-acp.js'), '--hermetic'], { stdio: ['pipe', 'pipe', 'inherit'] });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }) + '\n');
    const line = await new Promise((resolve) => require('node:readline').createInterface({ input: child.stdout }).once('line', resolve));
    assert.equal(JSON.parse(line).result.agentInfo.name, 'zcode-agent');
    child.stdin.end();
    assert.equal(await new Promise((r) => child.on('exit', r)), 0);
    const pkg = require('../../package.json');
    assert.equal(pkg.bin['zcode-agent-acp'], 'bin/zcode-agent-acp.js');
  } finally {
    fake.cleanup();
  }
});

test('acp: rejects flags that do not apply and stray arguments', () => {
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  assert.equal(run(['acp', '--json']).status, 2);
  assert.equal(run(['acp', 'hello']).status, 2);
  assert.match(run(['acp', '--mode', 'auto']).stderr, /--mode accepts build \| edit \| plan \| yolo/);
  assert.match(run(['task', '--mode', 'yolo', 'x']).stderr, /--mode is only valid with "zcode-agent acp"/);
});

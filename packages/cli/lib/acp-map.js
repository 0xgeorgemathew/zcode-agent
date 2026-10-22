'use strict';
// Pure translation between the engine's app-server frames and ACP
// (Agent Client Protocol v1) `session/update` payloads, prompts and config
// options. No I/O: lib/acp.js owns the processes and the wire.
//
// Engine facts used here (live-probed against engine 0.16.9, 1.1):
//  - model.streaming {kind:text_delta|reasoning_delta, delta}
//  - model.streaming {kind:tool_input_start, toolCallId, toolName} then
//    {kind:tool_call, toolCallId, toolName, input} once the input is complete
//  - tool.updated {kind:scheduled|started|result|error|batch, toolCallId,
//    toolName?, result?:{success, content}}
//  - session.titleUpdated {title}; state.updated {patch:{mode:{current}}}
//  - session/messages: [{info:{role, semantics:{kind, uiVisibility}},
//    parts:[{type:text|reasoning|tool, …}]}]
const path = require('node:path');
const { supportedEfforts, supportsImage } = require('./models.js');

// Engine permission modes offered as the ACP session mode. `auto` is
// reserved-but-unimplemented in the engine and `guarded` behaves like yolo
// for permissions, so neither is offered.
const MODES = [
  { id: 'build', name: 'Ask', description: 'Ask before edits and commands' },
  { id: 'edit', name: 'Accept edits', description: 'Edit files without asking; ask before commands' },
  { id: 'plan', name: 'Plan', description: 'Read-only: research and plan, then ask to start' },
  { id: 'yolo', name: 'Full access', description: 'Run every tool without asking' },
];
const MODE_IDS = MODES.map((m) => m.id);

const MODELS = [
  { value: 'GLM-5.3', name: 'GLM-5.3', description: 'Default; larger model, text only' },
  { value: 'GLM-5.3-Flash', name: 'GLM-5.3-Flash', description: 'Fast and cheap; sees images' },
];

// Context windows by model (engine session/create settings; fallback).
const CONTEXT_WINDOWS = { 'GLM-5.3-Flash': 200000, 'GLM-5.3': 1000000 };

const MAX_TOOL_TEXT = 8000;

function modeState(mode) {
  return { currentModeId: mode, availableModes: MODES };
}

// The session's config options (ACP v1 SessionConfigOption, select type):
// mode, model, and the reasoning effort the current model accepts.
function configOptions({ mode, model, effort }, opts = {}) {
  return [
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: mode,
      options: MODES.map(({ id, name, description }) => ({ value: id, name, description })),
    },
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: model,
      options: MODELS,
    },
    {
      id: 'effort',
      name: 'Effort',
      category: 'thought_level',
      type: 'select',
      currentValue: effort,
      options: supportedEfforts(model, opts).map((level) => ({ value: level, name: level })),
    },
  ];
}

// The effort to keep after a model switch: the same level when the new
// model accepts it, else its highest.
function effortFor(model, effort, opts = {}) {
  const levels = supportedEfforts(model, opts);
  return levels.includes(effort) ? effort : levels[levels.length - 1];
}

// --- prompts --------------------------------------------------------------------

// ACP prompt content blocks → the engine's prompt text. Images are written
// by `saveImage(block, index) → path` (the engine takes a string prompt;
// GLM-5.3-Flash reads image files with its Read tool).
function promptText(blocks, { saveImage = null, model = null, env } = {}) {
  const parts = [];
  let images = 0;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'resource_link') {
      parts.push(`Referenced: ${uriToPath(block.uri) || block.name || ''}`.trim());
    } else if (block.type === 'resource' && block.resource) {
      const r = block.resource;
      const where = uriToPath(r.uri) || r.uri || 'attachment';
      if (typeof r.text === 'string') parts.push(`<file path="${where}">\n${r.text}\n</file>`);
      else parts.push(`Referenced: ${where}`);
    } else if (block.type === 'image' && typeof block.data === 'string' && saveImage) {
      const file = saveImage(block, images++);
      const note = model && !supportsImage(model, { env })
        ? ` (${model} cannot see images; switch to GLM-5.3-Flash to have it looked at)`
        : ' (open it with the Read tool)';
      parts.push(`Attached image: ${file}${note}`);
    }
  }
  return parts.join('\n\n');
}

function uriToPath(uri) {
  if (typeof uri !== 'string') return null;
  if (uri.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(uri).pathname);
    } catch {
      return uri.slice('file://'.length);
    }
  }
  return null;
}

// ACP mcpServers → the engine's --mcp spec ({name: def}).
function mcpSpec(servers) {
  const spec = {};
  for (const s of Array.isArray(servers) ? servers : []) {
    if (!s || !s.name) continue;
    const pairs = (list) => Object.fromEntries((Array.isArray(list) ? list : []).filter((p) => p && p.name).map((p) => [p.name, String(p.value ?? '')]));
    if (s.type === 'http' || s.type === 'sse') {
      spec[s.name] = { type: s.type, url: s.url, headers: pairs(s.headers) };
    } else if (s.command) {
      spec[s.name] = { type: 'stdio', command: s.command, args: Array.isArray(s.args) ? s.args : [], env: pairs(s.env) };
    }
  }
  return spec;
}

// --- tools ----------------------------------------------------------------------

const HIDDEN_TOOLS = new Set(['TodoWrite', 'TodoRead']); // shown as the plan instead

function rel(file, cwd) {
  if (typeof file !== 'string' || !file) return '';
  if (!cwd || !path.isAbsolute(file)) return file;
  const r = path.relative(cwd, file);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : file;
}

function clip(text, max = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// {title, kind, locations?, content?} for one engine tool call.
function toolInfo(name, input, cwd) {
  const i = input && typeof input === 'object' ? input : {};
  const file = typeof i.file_path === 'string' ? i.file_path : typeof i.path === 'string' ? i.path : null;
  const at = file ? [{ path: file, ...(Number.isInteger(i.offset) ? { line: i.offset } : {}) }] : undefined;
  switch (name) {
    case 'Read':
      return { title: file ? `Read ${rel(file, cwd)}` : 'Read', kind: 'read', locations: at };
    case 'Write':
      return {
        title: file ? `Write ${rel(file, cwd)}` : 'Write',
        kind: 'edit',
        locations: at,
        content: file && typeof i.content === 'string' ? [{ type: 'diff', path: file, oldText: null, newText: i.content }] : undefined,
      };
    case 'Edit':
      return {
        title: file ? `Edit ${rel(file, cwd)}` : 'Edit',
        kind: 'edit',
        locations: at,
        content: file && typeof i.new_string === 'string'
          ? [{ type: 'diff', path: file, oldText: typeof i.old_string === 'string' ? i.old_string : null, newText: i.new_string }]
          : undefined,
      };
    case 'MultiEdit':
      return {
        title: file ? `Edit ${rel(file, cwd)}` : 'Edit',
        kind: 'edit',
        locations: at,
        content: file && Array.isArray(i.edits)
          ? i.edits.filter((e) => e && typeof e.new_string === 'string')
            .map((e) => ({ type: 'diff', path: file, oldText: typeof e.old_string === 'string' ? e.old_string : null, newText: e.new_string }))
          : undefined,
      };
    case 'NotebookEdit':
      return { title: `Edit ${rel(i.notebook_path || file, cwd)}`, kind: 'edit', locations: i.notebook_path ? [{ path: i.notebook_path }] : at };
    case 'Bash':
      return { title: i.command ? clip(i.command, 120) : (i.description || 'Run command'), kind: 'execute' };
    case 'Grep':
      return { title: `Search ${clip(i.pattern, 60)}${file ? ` in ${rel(file, cwd)}` : ''}`, kind: 'search', locations: at };
    case 'Glob':
      return { title: `Find ${clip(i.pattern, 60)}`, kind: 'search', locations: at };
    case 'LS':
      return { title: `List ${rel(file, cwd) || '.'}`, kind: 'search', locations: at };
    case 'WebFetch':
      return { title: i.url ? `Fetch ${clip(i.url, 100)}` : 'Fetch', kind: 'fetch' };
    case 'WebSearch':
      return { title: i.query ? `Search the web: ${clip(i.query, 80)}` : 'Search the web', kind: 'fetch' };
    case 'Agent':
    case 'Task':
      return { title: `Subagent: ${clip(i.description || i.prompt || i.subagent_type || 'task', 80)}`, kind: 'think' };
    case 'Skill':
      return { title: `Skill ${i.skill || i.name || ''}`.trim(), kind: 'other' };
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return { title: name === 'ExitPlanMode' ? 'Ready to code' : 'Plan first', kind: 'switch_mode' };
    default: {
      const m = /^mcp__(.+?)__(.+)$/.exec(String(name || ''));
      return { title: m ? `${m[1]}: ${m[2]}` : String(name || 'tool'), kind: 'other' };
    }
  }
}

function truncate(text, max = MAX_TOOL_TEXT) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
}

// A tool result's text and rawOutput (Bash output as {stdout}, which ACP
// clients render as command output).
function toolOutput(name, text) {
  const out = truncate(text);
  return {
    content: out ? [{ type: 'content', content: { type: 'text', text: out } }] : undefined,
    rawOutput: name === 'Bash' ? { stdout: out } : { output: out },
  };
}

// TodoWrite input → an ACP plan update, or null.
function planUpdate(input) {
  const todos = input && Array.isArray(input.todos) ? input.todos : null;
  if (!todos) return null;
  const status = (s) => (s === 'in_progress' || s === 'completed' ? s : s === 'cancelled' ? 'completed' : 'pending');
  const priority = (p) => (p === 'high' || p === 'low' ? p : 'medium');
  return {
    sessionUpdate: 'plan',
    entries: todos.filter((t) => t && t.content).map((t) => ({ content: String(t.content), priority: priority(t.priority), status: status(t.status) })),
  };
}

// The engine titles a session from its first input, verbatim. Clients
// that wrap the user's words in markup (T3 Code: <t3_code_instructions>…
// <user_request>…</user_request>) would get the markup as the title: use
// the user's request instead.
function cleanTitle(title, prompt) {
  if (!/^\s*</.test(title)) return title;
  const text = String(prompt || '');
  const request = /<user_request>([\s\S]*?)<\/user_request>/.exec(text);
  const words = (request ? request[1] : text.replace(/<([a-z_]+)>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.trim()).find(Boolean);
  return words ? clip(words, 60) : title;
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// Stateful per-session translator for live turns. feed(frame) returns the
// ACP updates the frame produces (possibly none).
class TurnMapper {
  constructor({ engineSessionId, cwd }) {
    this.engineSessionId = engineSessionId;
    this.cwd = cwd;
    this.tools = new Map(); // toolCallId → {name, announced, hidden, done}
    this.contextUsed = null;
    this.title = null;
    this.mode = null;
    this.available = null; // the engine's latest model list (state.updated)
    this.prompt = ''; // this turn's prompt text (titles)
  }

  ownFrame(params) {
    return !params.sessionId || !this.engineSessionId || params.sessionId === this.engineSessionId;
  }

  feed(frame) {
    const out = [];
    const params = (frame && frame.params) || {};
    if (frame.method === 'state.updated') {
      const available = params.patch && params.patch.model && params.patch.model.available;
      if (Array.isArray(available)) this.available = available;
      const mode = params.patch && params.patch.mode && params.patch.mode.current;
      if (mode && MODE_IDS.includes(mode) && mode !== this.mode) {
        this.mode = mode;
        out.push({ sessionUpdate: 'current_mode_update', currentModeId: mode });
      }
      return out;
    }
    if (frame.method !== 'session/event' || !this.ownFrame(params)) return out;
    const type = params.type;
    const p = params.payload || {};
    if (type === 'model.streaming') {
      if (p.kind === 'text_delta' && p.delta) {
        out.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: p.delta } });
      } else if (p.kind === 'reasoning_delta' && p.delta) {
        out.push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: p.delta } });
      } else if (p.kind === 'tool_input_start' && p.toolCallId) {
        out.push(...this.announce(p.toolCallId, p.toolName, undefined));
      } else if (p.kind === 'tool_call' && p.toolCallId) {
        out.push(...this.announce(p.toolCallId, p.toolName, p.input));
      }
    } else if (type === 'tool.updated' && p.toolCallId) {
      out.push(...this.toolUpdate(p));
    } else if (type === 'permission.resolved' && p.toolCallId && p.decision === 'deny') {
      // A denied tool never runs: no result event follows, only this.
      const t = this.tools.get(p.toolCallId);
      if (t && !t.hidden && !t.done) {
        t.done = true;
        out.push({ sessionUpdate: 'tool_call_update', toolCallId: p.toolCallId, status: 'failed', ...compact(toolOutput(t.name, p.reason ? `Denied: ${p.reason}` : 'Denied')) });
      }
    } else if (type === 'session.titleUpdated' && p.title) {
      this.title = cleanTitle(String(p.title), this.prompt);
      const at = Number.isFinite(params.timestamp) ? params.timestamp : Date.now();
      out.push({ sessionUpdate: 'session_info_update', title: this.title, updatedAt: new Date(at).toISOString() });
    } else if (type === 'session.updated' && p.type === 'model_request_completed' && p.usage
      && (!p.modelRequestSessionType || p.modelRequestSessionType === 'main')) {
      this.contextUsed = (p.usage.inputTokens || 0) + (p.usage.outputTokens || 0);
    }
    return out;
  }

  announce(id, name, input) {
    let t = this.tools.get(id);
    const toolName = name || (t && t.name) || 'tool';
    if (!t) {
      t = { name: toolName, announced: false, hidden: HIDDEN_TOOLS.has(toolName), done: false };
      this.tools.set(id, t);
    }
    if (t.hidden) {
      const plan = input !== undefined && toolName === 'TodoWrite' ? planUpdate(input) : null;
      return plan ? [plan] : [];
    }
    const info = toolInfo(toolName, input, this.cwd);
    const fields = compact({
      title: info.title,
      kind: info.kind,
      locations: info.locations,
      content: info.content,
      rawInput: input,
    });
    if (!t.announced) {
      t.announced = true;
      return [{ sessionUpdate: 'tool_call', toolCallId: id, status: 'pending', ...fields }];
    }
    return input === undefined ? [] : [{ sessionUpdate: 'tool_call_update', toolCallId: id, ...fields }];
  }

  toolUpdate(p) {
    const id = p.toolCallId;
    let t = this.tools.get(id);
    const out = [];
    if (!t) {
      if (!p.toolName) return out;
      out.push(...this.announce(id, p.toolName, undefined));
      t = this.tools.get(id);
    }
    if (t.hidden || t.done) return out;
    if (p.kind === 'started') {
      out.push({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'in_progress' });
    } else if (p.kind === 'result') {
      t.done = true;
      const r = p.result || {};
      const failed = r.success === false;
      out.push({ sessionUpdate: 'tool_call_update', toolCallId: id, status: failed ? 'failed' : 'completed', ...compact(toolOutput(t.name, typeof r.content === 'string' ? r.content : r.content === undefined ? '' : JSON.stringify(r.content))) });
    } else if (p.kind === 'error') {
      t.done = true;
      const e = p.error || p.result || {};
      const message = typeof e === 'string' ? e : e.message || e.content || JSON.stringify(e);
      out.push({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'failed', ...compact(toolOutput(t.name, message)) });
    }
    return out;
  }

  // Updates that close every tool call still open (turn ended or cancelled).
  closeOpen(status = 'failed') {
    const out = [];
    for (const [id, t] of this.tools) {
      if (t.hidden || t.done || !t.announced) continue;
      t.done = true;
      out.push({ sessionUpdate: 'tool_call_update', toolCallId: id, status });
    }
    return out;
  }
}

// --- history (session/load) -----------------------------------------------------

// session/messages → the ACP updates that replay the visible conversation.
function historyUpdates(messages, { cwd } = {}) {
  const out = [];
  let plan = null;
  for (const m of Array.isArray(messages) ? messages : []) {
    const info = (m && m.info) || {};
    const sem = info.semantics || {};
    if (sem.uiVisibility && sem.uiVisibility !== 'visible') continue;
    const parts = Array.isArray(m.parts) ? m.parts : [];
    if (info.role === 'user') {
      if (sem.kind && sem.kind !== 'user_prompt') continue;
      for (const part of parts) {
        if (part && part.type === 'text' && part.text) out.push({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: part.text } });
      }
      continue;
    }
    if (info.role !== 'assistant' || (sem.kind && sem.kind !== 'assistant_response')) continue;
    for (const part of parts) {
      if (!part) continue;
      if (part.type === 'text' && part.text) {
        out.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: part.text } });
      } else if (part.type === 'reasoning' && part.text) {
        out.push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: part.text } });
      } else if (part.type === 'tool' && part.callID) {
        const state = part.state || {};
        if (HIDDEN_TOOLS.has(part.tool)) {
          if (part.tool === 'TodoWrite') plan = planUpdate(state.input) || plan;
          continue;
        }
        const info2 = toolInfo(part.tool, state.input, cwd);
        const failed = state.status === 'error' || state.status === 'failed';
        const output = typeof state.output === 'string' ? state.output : typeof state.error === 'string' ? state.error : '';
        const result = toolOutput(part.tool, output);
        out.push(compact({
          sessionUpdate: 'tool_call',
          toolCallId: part.callID,
          title: info2.title,
          kind: info2.kind,
          status: failed ? 'failed' : 'completed',
          locations: info2.locations,
          content: [...(info2.content || []), ...(result.content || [])],
          rawInput: state.input,
          rawOutput: result.rawOutput,
        }));
      }
    }
  }
  if (plan) out.push(plan);
  return out;
}

// --- permissions ----------------------------------------------------------------

const OPTION_KINDS = { allow_once: 'allow_once', allow_always: 'allow_always', allow_session: 'allow_always', deny: 'reject_once', reject_once: 'reject_once', reject_always: 'reject_always' };

// The engine's interaction/requestPermission params → ACP
// session/request_permission params (minus sessionId) and a lookup from
// the client's chosen optionId to the engine's reply.
function permissionRequest(params, { cwd } = {}) {
  const engineOptions = Array.isArray(params.options) ? params.options.filter((o) => o && o.optionId) : [];
  const options = [];
  const replies = new Map();
  for (const o of engineOptions) {
    // An option of unknown kind is never shown as an allow button.
    const kind = OPTION_KINDS[o.kind] || (/^allow/.test(String(o.kind || '')) ? 'allow_once' : 'reject_once');
    options.push({ optionId: o.optionId, name: o.name || o.optionId, kind });
    replies.set(o.optionId, o.response || (kind.startsWith('reject') ? { decision: 'deny', reason: 'Denied by the user' } : { decision: 'allow', reason: 'Approved by the user' }));
  }
  // Every client can answer: the three basic kinds are always offered.
  if (!options.some((o) => o.kind === 'allow_once')) {
    options.unshift({ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' });
    replies.set('allow_once', { decision: 'allow', reason: 'Approved once' });
  }
  if (!options.some((o) => o.kind === 'reject_once')) {
    options.push({ optionId: 'deny', name: 'Deny', kind: 'reject_once' });
    replies.set('deny', { decision: 'deny', reason: 'Denied by the user' });
  }
  const info = toolInfo(params.toolName, params.input, cwd);
  const toolCall = compact({
    toolCallId: params.toolCallId || params.requestId,
    title: info.title,
    kind: info.kind,
    status: 'pending',
    locations: info.locations,
    content: info.content,
    rawInput: params.input,
  });
  return {
    request: { toolCall, options },
    reply: (outcome) => {
      if (outcome && outcome.outcome === 'selected' && replies.has(outcome.optionId)) return replies.get(outcome.optionId);
      return { decision: 'deny', reason: 'The user cancelled this tool call. Stop and wait for their next message.' };
    },
  };
}

// The engine's ExitPlanMode approval (interaction/requestUserInput with
// schema.interaction "plan_approval") as an ACP permission request.
function planApprovalRequest(params) {
  const plan = params.input && typeof params.input.plan === 'string' ? params.input.plan : '';
  return {
    request: {
      toolCall: compact({
        toolCallId: params.toolCallId || params.requestId,
        title: 'Ready to code?',
        kind: 'switch_mode',
        status: 'pending',
        content: plan ? [{ type: 'content', content: { type: 'text', text: plan } }] : undefined,
        rawInput: params.input,
      }),
      options: [
        { optionId: 'approve', name: 'Yes, start', kind: 'allow_once' },
        { optionId: 'keep-planning', name: 'No, keep planning', kind: 'reject_once' },
      ],
    },
    reply: (outcome) => (outcome && outcome.outcome === 'selected' && outcome.optionId === 'approve'
      ? { action: 'accept', content: { answer: 'approve' } }
      : { action: 'decline', reason: 'The user wants to keep planning.' }),
  };
}

// The model's context window: the engine's latest state.updated model list,
// else the session projection when it is for this model, else the table.
// (live-probed 0.16.9: session/create's own settings list says 1M for
// GLM-5.3-Flash while its projection and later state updates say 200k.)
function contextWindow(model, { available = null, created = null } = {}) {
  const hit = Array.isArray(available) && available.find((a) => a && a.ref && a.ref.modelId === model);
  if (hit && hit.contextWindow) return hit.contextWindow;
  const projection = created && created.projection;
  const createdModel = created && created.session && created.session.model && created.session.model.modelId;
  if (projection && projection.contextWindow && createdModel === model) return projection.contextWindow;
  return CONTEXT_WINDOWS[model] || 200000;
}

module.exports = {
  MODES,
  MODE_IDS,
  MODELS,
  modeState,
  configOptions,
  effortFor,
  promptText,
  mcpSpec,
  toolInfo,
  planUpdate,
  TurnMapper,
  historyUpdates,
  permissionRequest,
  planApprovalRequest,
  contextWindow,
  uriToPath,
  cleanTitle,
};

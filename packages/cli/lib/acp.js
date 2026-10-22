'use strict';
// `zcode-agent acp`: an Agent Client Protocol (ACP v1) agent on stdio, so
// T3 Code, Zed and other ACP clients drive GLM-5.3 through the ZCode engine
// directly (DESIGN §20).
//
//   client ⇄ (ACP: JSON-RPC 2.0, one object per line) ⇄ this process
//          ⇄ (ZCode Protocol, lib/appserver.js) ⇄ one engine per session
//
// Every ACP session is a zcode-agent session (kind "acp") in the store,
// with its own engine HOME, port and tmp dir, so `zcode-agent status`,
// `watch` and `cost` see it. The record and the engine are created on the
// first prompt (or session/load), never by session/new: clients probe with
// session/new and kill the process, which must leave nothing behind.
//
// stdout carries protocol frames only. Diagnostics go to stderr, and every
// frame to $ZCODE_ACP_LOG when set.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const store = require('./store.js');
const { resolveRuntime, makeClient, ConfigError } = require('./bootstrap.js');
const { buildEngineHome, rootDir, liveDir, recordMcpHealth, ACP_AGENTS_MD } = require('./isolation.js');
const { openSession, runTurn, TurnError } = require('./appserver.js');
const { reservePort } = require('./ports.js');
const { workspaceRoot } = require('./workspace.js');
const { sessionCost } = require('./cost.js');
const { normalizeModel, normalizeEffort, supportedEfforts } = require('./models.js');
const map = require('./acp-map.js');

const PROTOCOL_VERSION = 1;
const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  authRequired: -32000,
  notFound: -32002,
};
const MAX_TIMER_MS = 2147483647;
// An ACP session's record between turns: not live (`wait` returns, `watch`
// shows it done, `cancel` has nothing to stop) though its client may prompt
// again; `running` only while a turn runs.
const IDLE = { state: 'finished', status: 'completed', phase: 'idle' };
const LIST_LIMIT = 256;

class AcpError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

// --- JSON-RPC 2.0 peer over newline-delimited JSON --------------------------------

class Peer {
  constructor({ input, output, log = null }) {
    this.output = output;
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.onRequest = async () => {
      throw new AcpError(ERR.methodNotFound, 'method not found');
    };
    this.onNotification = () => {};
    this.onClose = () => {};
    const rl = readline.createInterface({ input });
    rl.on('line', (line) => this.receive(line));
    rl.on('close', () => this.onClose());
  }

  write(obj) {
    const line = JSON.stringify(obj);
    if (this.log) this.log('out', line);
    this.output.write(line + '\n');
  }

  receive(line) {
    if (!line.trim()) return;
    if (this.log) this.log('in', line);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.write({ jsonrpc: '2.0', id: null, error: { code: ERR.parse, message: 'parse error' } });
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.method === 'string') {
      if (msg.id === undefined || msg.id === null) {
        try {
          this.onNotification(msg.method, msg.params || {});
        } catch {
          /* notifications have no reply */
        }
        return;
      }
      // Dispatched synchronously: a handler runs up to its first await
      // before the next line of the same chunk (session/prompt then
      // session/cancel in one write must cancel that prompt).
      let pending;
      try {
        pending = Promise.resolve(this.onRequest(msg.method, msg.params || {}));
      } catch (err) {
        pending = Promise.reject(err);
      }
      pending
        .then(
          (result) => this.write({ jsonrpc: '2.0', id: msg.id, result: result ?? null }),
          (err) => this.write({
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: err instanceof AcpError ? err.code : ERR.internal,
              message: String((err && err.message) || err),
              ...(err && err.data !== undefined ? { data: err.data } : {}),
            },
          })
        );
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new AcpError(msg.error.code, msg.error.message || 'client error', msg.error.data));
      else resolve(msg.result);
    }
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  // Unblocks every request still waiting on the client (it went away).
  failPending(message) {
    for (const { reject } of this.pending.values()) reject(new AcpError(ERR.internal, message));
    this.pending.clear();
  }
}

// --- the agent ----------------------------------------------------------------------

class Agent {
  // defaults: {model, effort, mode, mcpSpecs, hermetic, browser, skillsDirs,
  //   noSkills, inheritDesktop, timeoutMs}
  constructor({ peer, defaults, env = process.env, version = '0.0.0' }) {
    this.peer = peer;
    this.defaults = defaults;
    this.env = env;
    this.version = version;
    this.sessions = new Map();
    this.clientCapabilities = {};
    this.cachedRuntime = null;
    peer.onRequest = (method, params) => this.handle(method, params);
    peer.onNotification = (method, params) => {
      if (method === 'session/cancel') this.cancel(params);
    };
  }

  runtime() {
    if (this.cachedRuntime) return this.cachedRuntime;
    try {
      this.cachedRuntime = resolveRuntime(this.env);
    } catch (err) {
      if (err instanceof ConfigError && err.exitCode === 3) {
        throw new AcpError(ERR.authRequired, `Authentication required: ${err.message}`);
      }
      if (err instanceof ConfigError) throw new AcpError(ERR.internal, err.message);
      throw err;
    }
    return this.cachedRuntime;
  }

  async handle(method, params) {
    switch (method) {
      case 'initialize':
        return this.initialize(params);
      case 'authenticate':
        this.cachedRuntime = null;
        this.runtime();
        return {};
      case 'session/new':
        return this.newSession(params);
      case 'session/load':
        return this.loadSession(params);
      case 'session/list':
        return this.listSessions(params);
      case 'session/prompt':
        return this.prompt(params);
      case 'session/set_mode':
        return this.setConfig(this.session(params), 'mode', params.modeId).then(() => ({}));
      case 'session/set_model':
        return this.setConfig(this.session(params), 'model', params.modelId).then(() => ({}));
      case 'session/set_config_option':
        return this.setConfig(this.session(params), params.configId, params.value)
          .then((s) => ({ configOptions: this.options(s) }));
      case 'session/close':
        await this.closeSession(this.session(params), { reason: 'closed' });
        return {};
      case 'session/cancel': // tolerated as a request too
        this.cancel(params);
        return {};
      default:
        throw new AcpError(ERR.methodNotFound, `method not found: ${method}`);
    }
  }

  initialize(params) {
    this.clientCapabilities = (params && params.clientCapabilities) || {};
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: { list: {}, close: {} },
      },
      authMethods: [
        {
          id: 'zai-api-key',
          name: 'Z.ai API key',
          description: 'Sign in to the ZCode app, set ZAI_API_KEY, or pipe a key into `zcode-agent login`.',
        },
      ],
      agentInfo: { name: 'zcode-agent', title: 'zcode-agent (GLM-5.3)', version: this.version },
    };
  }

  session(params) {
    const s = this.sessions.get(params && params.sessionId);
    if (!s) throw new AcpError(ERR.notFound, `no open session "${params && params.sessionId}" (session/new or session/load first)`);
    return s;
  }

  options(s) {
    return map.configOptions(s, { env: this.env, builtinConfig: this.builtinConfig() });
  }

  builtinConfig() {
    return this.cachedRuntime ? this.cachedRuntime.builtinConfig : undefined;
  }

  realCwd(cwd) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new AcpError(ERR.invalidParams, 'cwd must be an absolute path');
    try {
      const real = fs.realpathSync(cwd);
      if (!fs.statSync(real).isDirectory()) throw new Error('not a directory');
      return real;
    } catch {
      throw new AcpError(ERR.invalidParams, `cwd "${cwd}" is not an existing directory`);
    }
  }

  async newSession(params) {
    const cwd = this.realCwd(params.cwd);
    this.runtime(); // no key → auth_required now, not at the first prompt
    let id = store.newId();
    while (store.readSession(id, this.env) || this.sessions.has(id)) id = store.newId();
    const s = this.makeSession({
      id,
      cwd,
      mcpServers: params.mcpServers,
      model: this.defaults.model,
      effort: this.defaults.effort,
      mode: this.defaults.mode,
      persisted: false,
    });
    return { sessionId: id, modes: map.modeState(s.mode), configOptions: this.options(s) };
  }

  makeSession(fields) {
    const s = {
      ...fields,
      client: null, // set as soon as the engine spawns, so close/exit can kill it
      engine: null, // {sessionId, created} once the engine session is open
      starting: null, // the in-flight engine start (one at a time)
      running: null, // the in-flight prompt
      closed: false,
      busy: false,
      abort: null,
      releaseOwner: null,
      releasePort: null,
      sessionEnv: null,
      contextUsed: null,
      available: null,
      images: 0,
      activity: { toolCalls: 0, subagentsStarted: 0, modelRequests: 0, lastTool: null, lastToolAt: null, lastEventAt: null },
    };
    s.effort = map.effortFor(s.model, s.effort, { env: this.env, builtinConfig: this.builtinConfig() });
    this.sessions.set(s.id, s);
    return s;
  }

  async loadSession(params) {
    const cwd = this.realCwd(params.cwd);
    const id = params.sessionId;
    let s = this.sessions.get(id);
    const fresh = !s;
    if (!s) {
      const record = store.readSession(id, this.env);
      if (!record || record.kind !== 'acp' || !record.engineSessionId) {
        throw new AcpError(ERR.notFound, `no zcode-agent ACP session "${id}"`);
      }
      this.runtime();
      s = this.makeSession({
        id,
        cwd: record.cwd && fs.existsSync(record.cwd) ? record.cwd : cwd,
        mcpServers: params.mcpServers,
        model: normalizeModel(record.model) || this.defaults.model,
        effort: normalizeEffort(record.effort) || this.defaults.effort,
        mode: map.MODE_IDS.includes(record.acp && record.acp.mode) ? record.acp.mode : this.defaults.mode,
        title: record.label || null,
        persisted: true,
      });
      if (record.activity) Object.assign(s.activity, record.activity);
    } else {
      s.mcpServers = params.mcpServers;
    }
    try {
      await this.ensureEngine(s);
      const history = await s.client.request('session/messages', { sessionId: s.engine.sessionId }, { timeoutMs: 30000 });
      for (const update of map.historyUpdates(history && history.messages, { cwd: s.cwd })) this.send(s, update);
    } catch (err) {
      // Nothing of a failed load may outlive it: engine, port, owner lock
      // (a retry would otherwise find its own lock and refuse).
      if (fresh) await this.closeSession(s, { reason: 'load failed' });
      throw err instanceof AcpError ? err : new AcpError(ERR.internal, this.scrub(err.message));
    }
    if (s.title) this.send(s, { sessionUpdate: 'session_info_update', title: s.title });
    return { modes: map.modeState(s.mode), configOptions: this.options(s) };
  }

  listSessions(params) {
    let cwd = null;
    if (params && params.cwd) {
      try {
        cwd = fs.realpathSync(params.cwd);
      } catch {
        return { sessions: [] };
      }
    }
    const sessions = store.listSessions(this.env)
      .filter((r) => r.kind === 'acp' && r.engineSessionId && (!cwd || r.cwd === cwd))
      .slice(0, LIST_LIMIT)
      .map((r) => ({ sessionId: r.id, cwd: r.cwd, title: r.label || null, updatedAt: r.updatedAt }));
    return { sessions };
  }

  // --- config ---------------------------------------------------------------------

  async setConfig(s, configId, value) {
    const opts = { env: this.env, builtinConfig: this.builtinConfig() };
    if (configId === 'mode') {
      if (!map.MODE_IDS.includes(value)) throw new AcpError(ERR.invalidParams, `unknown mode "${value}" (${map.MODE_IDS.join(', ')})`);
      if (s.client && !s.client.dead && s.engine) {
        await s.client.request('session/setMode', { sessionId: s.engine.sessionId, mode: value }, { timeoutMs: 15000 });
      }
      s.mode = value;
      this.send(s, { sessionUpdate: 'current_mode_update', currentModeId: value });
    } else if (configId === 'model') {
      const model = normalizeModel(value);
      if (!model) throw new AcpError(ERR.invalidParams, `unknown model "${value}" (GLM-5.3-Flash, GLM-5.3)`);
      s.model = model;
      s.effort = map.effortFor(model, s.effort, opts);
    } else if (configId === 'effort') {
      const effort = normalizeEffort(value);
      const levels = supportedEfforts(s.model, opts);
      if (!effort || !levels.includes(effort)) throw new AcpError(ERR.invalidParams, `effort "${value}" is not supported by ${s.model} (${levels.join(', ')})`);
      s.effort = effort;
    } else {
      throw new AcpError(ERR.invalidParams, `unknown config option "${configId}" (mode, model, effort)`);
    }
    this.persist(s);
    this.send(s, { sessionUpdate: 'config_option_update', configOptions: this.options(s) });
    return s;
  }

  persist(s, patch = {}) {
    if (!s.persisted) return;
    try {
      store.updateSession(s.id, { model: s.model, effort: s.effort, acp: { mode: s.mode }, ...patch }, this.env);
    } catch {
      /* the record is bookkeeping; never fail the protocol over it */
    }
  }

  send(s, update) {
    this.peer.notify('session/update', { sessionId: s.id, update });
  }

  scrub(text) {
    return this.cachedRuntime ? this.cachedRuntime.scrub(text) : String(text);
  }

  // --- engine -----------------------------------------------------------------------

  // One engine start per session at a time; concurrent callers share it.
  ensureEngine(s) {
    if (s.closed) return Promise.reject(new AcpError(ERR.notFound, `session "${s.id}" is closed`));
    if (s.client && !s.client.dead && s.engine) return Promise.resolve();
    if (!s.starting) s.starting = this.startEngine(s).finally(() => { s.starting = null; });
    return s.starting;
  }

  // Creates the store record on first use, then starts (or restarts) the
  // session's engine and opens its engine session (create, or resume the
  // persisted one). Retried once on a transient start failure: nothing has
  // reached the model yet.
  async startEngine(s) {
    this.dropEngine(s); // a dead engine from an earlier turn
    const runtime = this.runtime();
    const env = this.env;
    if (!s.persisted) {
      store.createSession(s.id, {
        kind: 'acp',
        label: s.title || null,
        cwd: s.cwd,
        workspaceRoot: workspaceRoot(s.cwd),
        owns: [],
        ownsRoot: [],
        touch: [],
        preflight: false,
        checks: [],
        model: s.model,
        effort: s.effort,
        engineSessionId: null,
        acp: { mode: s.mode },
      }, env);
      s.persisted = true;
    }
    if (!s.releaseOwner) {
      s.releaseOwner = store.claimSession(s.id, env);
      if (!s.releaseOwner) throw new AcpError(ERR.internal, `session "${s.id}" is open in another zcode-agent process`);
    }
    const dir = store.sessionDir(s.id, env);
    const record = store.readSession(s.id, env);
    if (!s.sessionEnv) {
      const reserved = await reservePort({ env, preferred: record.port });
      if (!reserved) throw new AcpError(ERR.internal, 'no free port for ZCODE_PORT in 41000-48999');
      s.releasePort = reserved.release;
      const tmp = path.join(dir, 'tmp');
      const out = path.join(tmp, 'out');
      fs.mkdirSync(out, { recursive: true, mode: 0o700 });
      s.sessionEnv = { ZCODE_SESSION_ID: s.id, ZCODE_PORT: String(reserved.port), ZCODE_OUT: out, ZCODE_TMP: tmp };
      store.updateSession(s.id, { port: reserved.port, out, tmp }, env);
    }
    const home = path.join(dir, 'home');
    const built = buildEngineHome({
      home,
      root: rootDir(env),
      key: runtime.key,
      live: liveDir(env),
      mcpSpecs: [...(this.defaults.mcpSpecs || []), map.mcpSpec(s.mcpServers)],
      hermetic: !!this.defaults.hermetic || env.ZCODE_HERMETIC === '1',
      browser: this.defaults.browser !== false,
      skillsDirs: this.defaults.skillsDirs || [],
      noSkills: !!this.defaults.noSkills,
      inheritDesktop: !!this.defaults.inheritDesktop || env.ZCODE_INHERIT_DESKTOP === '1',
      profile: 'general-purpose',
      model: s.model,
      instructions: ACP_AGENTS_MD,
    });
    for (let attempt = 1; ; attempt++) {
      if (s.closed) throw new AcpError(ERR.notFound, `session "${s.id}" is closed`);
      const client = makeClient(runtime, { home, cwd: s.cwd, sessionEnv: s.sessionEnv, interactions: this.interactions(s) });
      client.start();
      s.client = client; // tracked from spawn: close/exit kill it mid-start
      try {
        const opened = await openSession(client, {
          workspacePath: s.cwd,
          modelId: s.model,
          effort: s.effort,
          resumeSessionId: record.engineSessionId || null,
          requiredMcp: built.mcp.added,
          mode: s.mode,
          onMcpStatuses: (statuses) => recordMcpHealth(rootDir(env), statuses, built.mcp.inherited),
        });
        if (s.closed) throw new AcpError(ERR.notFound, `session "${s.id}" is closed`);
        s.engine = { sessionId: opened.sessionId, created: opened.created };
        break;
      } catch (err) {
        client.kill();
        if (s.client === client) s.client = null;
        if (err instanceof AcpError) throw err;
        const transient = /timeout|exited|failed to start|dead/.test(err.message);
        if (attempt >= 2 || !transient || s.closed) throw new AcpError(ERR.internal, `engine failed to start: ${runtime.scrub(err.message).slice(0, 600)}`);
      }
    }
    store.updateSession(s.id, {
      engineSessionId: s.engine.sessionId,
      enginePid: s.client.child.pid,
      pid: process.pid,
      ...IDLE,
      outcome: null,
      closedReason: null,
    }, env);
  }

  // The engine's interactive requests, answered by the person in the client.
  interactions(s) {
    const ask = async (built) => {
      let outcome = null;
      try {
        const res = await this.peer.request('session/request_permission', { sessionId: s.id, ...built.request });
        outcome = res && res.outcome;
      } catch {
        outcome = null; // client error or gone: treated as cancelled
      }
      return built.reply(outcome);
    };
    return {
      permission: (params) => ask(map.permissionRequest(params, { cwd: s.cwd })),
      userInput: (params) => {
        if (params.schema && params.schema.interaction === 'plan_approval') return ask(map.planApprovalRequest(params));
        // AskUserQuestion and MCP elicitations: ACP v1 has no form UI, so the
        // model asks in chat and the next prompt carries the answer.
        return {
          action: 'decline',
          reason: 'This client has no question form. Ask the user in your reply instead and end your turn; their next message is the answer.',
        };
      },
    };
  }

  // --- prompts ----------------------------------------------------------------------

  prompt(params) {
    const s = this.session(params);
    if (s.busy) throw new AcpError(ERR.invalidRequest, `session "${s.id}" is already running a prompt`);
    s.busy = true;
    s.abort = new AbortController();
    s.running = this.runPrompt(s, params).finally(() => { s.running = null; });
    return s.running;
  }

  // Resolves true when `promise` settles first, false when the prompt is
  // cancelled first (the start goes on; the next prompt reuses it).
  untilCancelled(s, promise) {
    const signal = s.abort.signal;
    if (signal.aborted) return Promise.resolve(false);
    promise.catch(() => {});
    return Promise.race([
      promise.then(() => true),
      new Promise((resolve) => signal.addEventListener('abort', () => resolve(false), { once: true })),
    ]);
  }

  async runPrompt(s, params) {
    const env = this.env;
    let mapper = null;
    let phaseAt = 0;
    const activity = s.activity;
    try {
      if (!(await this.untilCancelled(s, this.ensureEngine(s)))) return { stopReason: 'cancelled' };
      const text = map.promptText(params.prompt, { saveImage: (block, i) => this.saveImage(s, block, i), model: s.model, env });
      if (!text.trim()) return { stopReason: 'end_turn' };
      const record = store.readSession(s.id, env) || {};
      this.persist(s, { phase: 'working', turns: (record.turns || 0) + 1, pid: process.pid, state: 'running', status: null });
      mapper = new map.TurnMapper({ engineSessionId: s.engine.sessionId, cwd: s.cwd });
      mapper.mode = s.mode;
      mapper.title = s.title || null;
      mapper.prompt = text;
      const timeoutMs = this.defaults.timeoutMs || MAX_TIMER_MS;
      const turn = await runTurn(s.client, { sessionId: s.engine.sessionId }, {
        modelId: s.model,
        effort: s.effort,
        prompt: text,
        deadline: Date.now() + Math.min(timeoutMs, MAX_TIMER_MS),
        signal: s.abort.signal,
        onFrame: (frame) => {
          for (const update of mapper.feed(frame)) {
            this.send(s, update);
            if (update.sessionUpdate === 'current_mode_update') {
              s.mode = update.currentModeId;
              this.persist(s);
              this.send(s, { sessionUpdate: 'config_option_update', configOptions: this.options(s) });
            } else if (update.sessionUpdate === 'session_info_update' && update.title) {
              s.title = update.title;
              this.persist(s, { label: update.title });
            }
          }
        },
        onEvent: (ev) => {
          const now = new Date().toISOString();
          activity.lastEventAt = now;
          if (ev.type === 'model_request_started') activity.modelRequests++;
          if (ev.type === 'tool' && ev.phase === 'started') {
            activity.toolCalls++;
            if (ev.name === 'Agent' || ev.name === 'Task') activity.subagentsStarted++;
            activity.lastTool = ev.name;
            activity.lastToolAt = now;
            try {
              store.appendEvent(s.id, { type: 'tool', phase: 'started', name: ev.name, id: ev.id }, env);
            } catch {
              /* best-effort */
            }
          }
          if (Date.now() - phaseAt > 1000) {
            phaseAt = Date.now();
            this.recordActivity(s, activity);
          }
        },
      });
      for (const update of mapper.closeOpen('completed')) this.send(s, update);
      this.addUsage(s, turn.usage);
      return { stopReason: 'end_turn' };
    } catch (err) {
      if (mapper) for (const update of mapper.closeOpen('failed')) this.send(s, update);
      if (s.abort.signal.aborted) return { stopReason: 'cancelled' };
      if (err instanceof TurnError) {
        if (err.turn) this.addUsage(s, err.turn.usage);
        if (err.kind === 'cancelled') return { stopReason: 'cancelled' };
        if (err.kind === 'engine_exit') this.dropEngine(s);
        if (err.kind === 'result_type' && /max|limit/i.test(err.message)) return { stopReason: 'max_turn_requests' };
        throw new AcpError(ERR.internal, this.scrub(err.message).slice(0, 1000));
      }
      throw err instanceof AcpError ? err : new AcpError(ERR.internal, this.scrub(err && err.message ? err.message : String(err)).slice(0, 1000));
    } finally {
      s.busy = false;
      s.abort = null;
      if (mapper && mapper.contextUsed !== null) s.contextUsed = mapper.contextUsed;
      if (mapper && mapper.available) s.available = mapper.available;
      if (!activity.lastEventAt) activity.lastEventAt = new Date().toISOString();
      if (!s.closed) {
        this.persist(s, { ...IDLE, activity: { ...activity } });
        if (mapper) this.sendUsage(s);
      }
    }
  }

  // `zcode-agent watch` reads this: counts are for the whole session.
  recordActivity(s, activity) {
    if (!s.persisted) return;
    try {
      store.updateSession(s.id, { activity: { ...activity } }, this.env);
    } catch {
      /* best-effort */
    }
  }

  addUsage(s, usage) {
    if (!usage || !s.persisted) return;
    try {
      store.updateSession(s.id, (r) => {
        const t = r.usageTotal || { inputTokens: 0, outputTokens: 0, modelRequests: 0 };
        return {
          usageTotal: {
            inputTokens: (t.inputTokens || 0) + (usage.inputTokens || 0),
            outputTokens: (t.outputTokens || 0) + (usage.outputTokens || 0),
            modelRequests: (t.modelRequests || 0) + (usage.modelRequestCount || 0),
          },
        };
      }, this.env);
    } catch {
      /* best-effort */
    }
  }

  // Context use and the session's GLM cost so far (API list price, from the
  // engine's own ledger, as `zcode-agent cost` reports it).
  sendUsage(s) {
    const size = map.contextWindow(s.model, { available: s.available, created: s.engine && s.engine.created });
    const update = { sessionUpdate: 'usage_update', used: Math.max(0, Math.round(s.contextUsed || 0)), size };
    try {
      const cost = sessionCost(store.readSession(s.id, this.env), this.env);
      if (cost && Number.isFinite(cost.usd)) update.cost = { amount: Number(cost.usd.toFixed(6)), currency: 'USD' };
    } catch {
      /* cost is informational */
    }
    this.send(s, update);
  }

  saveImage(s, block, index) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[block.mimeType] || 'png';
    const dir = path.join(s.sessionEnv.ZCODE_TMP, 'attachments');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `image-${Date.now()}-${++s.images}-${index}.${ext}`);
    fs.writeFileSync(file, Buffer.from(block.data, 'base64'), { mode: 0o600 });
    return file;
  }

  cancel(params) {
    const s = this.sessions.get(params && params.sessionId);
    if (s && s.abort) s.abort.abort();
  }

  dropEngine(s) {
    if (s.client) s.client.kill();
    s.client = null;
    s.engine = null;
  }

  // Stops the running turn (or engine start), waits for it to unwind, then
  // frees everything the session holds.
  async closeSession(s, { reason = 'closed' } = {}) {
    s.closed = true;
    if (s.abort) s.abort.abort();
    if (s.engine && s.client && !s.client.dead) await s.client.stopSession(s.engine.sessionId, { timeoutMs: 1500 });
    if (!s.engine && s.client) this.dropEngine(s); // mid-start: the start fails fast
    await Promise.allSettled([s.starting, s.running].filter(Boolean));
    this.release(s, reason);
  }

  release(s, reason) {
    s.closed = true;
    this.dropEngine(s);
    if (s.persisted) this.persist(s, { state: 'finished', phase: 'done', status: 'completed', closedReason: reason });
    if (s.releasePort) s.releasePort();
    if (s.releaseOwner) s.releaseOwner();
    s.releasePort = null;
    s.releaseOwner = null;
    if (this.sessions.get(s.id) === s) this.sessions.delete(s.id);
  }

  // Process exit: synchronous, so it also runs from an 'exit' handler.
  shutdownSync(reason) {
    for (const s of [...this.sessions.values()]) {
      if (s.abort) s.abort.abort();
      this.release(s, reason);
    }
  }
}

// Runs the agent on this process's stdio until the client closes stdin.
function serve({ defaults, env = process.env, version, input = process.stdin, output = process.stdout } = {}) {
  const logFile = env.ZCODE_ACP_LOG;
  const log = logFile
    ? (dir, line) => {
        try {
          fs.appendFileSync(logFile, `${new Date().toISOString()} ${dir} ${line}\n`, { mode: 0o600 });
        } catch {
          /* debug log only */
        }
      }
    : null;
  const peer = new Peer({ input, output, log });
  const agent = new Agent({ peer, defaults, env, version });
  let done = false;
  const stop = (reason, code) => {
    if (done) return;
    done = true;
    peer.failPending('client disconnected');
    agent.shutdownSync(reason);
    if (code !== null) process.exit(code);
  };
  peer.onClose = () => stop('client closed stdin', 0);
  process.on('SIGTERM', () => stop('SIGTERM', 0));
  process.on('SIGINT', () => stop('SIGINT', 0));
  process.on('SIGHUP', () => stop('SIGHUP', 0));
  process.on('exit', () => stop('exit', null));
  return { peer, agent };
}

module.exports = { serve, Agent, Peer, AcpError, PROTOCOL_VERSION, ERR };

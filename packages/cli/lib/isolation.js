'use strict';
// Scratch-HOME isolation (DESIGN §6, reworked in 0.4): the engine runs with
// HOME pointed at a directory we own so the live ~/.zcode — which the
// desktop app is actively using — is never written by us, and the user's
// OAuth credentials.json is never copied.
//
// 0.4: one engine HOME per zcode session (<root>/sessions/<id>/home) instead
// of one shared HOME. The shared HOME was rm -rf'd and rebuilt whenever a
// volatile desktop file (agents-state.json, bot-config.v3.json, …) changed
// mtime — which deleted the engine's session database under every other
// session and made --session resume 404 — and per-run MCP/skills overlays
// rewrote files that concurrent runs were reading. Per-session HOMEs give
// each session its own engine DB, config and skills; config files are
// refreshed in place on every invocation and engine state (cli/db,
// cli/agents, rollout, logs) is never deleted.
//
// Invariant (§6.4): zcode performs no writes to the live ~/.zcode, and
// credentials.json is never copied.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DEFAULT_MODEL } = require('./models.js');

// The desktop app's live directory. ZAI_CODE_LIVE_DIR points elsewhere
// (e.g. a second desktop profile, or a fixture in tests).
function liveDir(env = process.env) {
  return env.ZAI_CODE_LIVE_DIR || path.join(os.homedir(), '.zcode');
}

const LIVE_ZCODE = liveDir({});
const LIVE_V2 = path.join(LIVE_ZCODE, 'v2');

// v2 top-level entries we deliberately never copy.
const V2_EXCLUDE_FILES = new Set(['credentials.json', '.DS_Store']);
function isV2Excluded(name) {
  return V2_EXCLUDE_FILES.has(name) || name.startsWith('tasks-index.sqlite');
}

// Root of zcode-agent's own state. MUST NOT be ~/.zcode: that is the
// desktop app's live directory (0.3.0/0.3.1 regression — the package rename
// made rootDir collide with it). Ours is ~/.zcode-agent (~/.zcode-cli
// before 1.0, migrated by migrateRoot).
function rootDir(env = process.env) {
  return env.ZAI_CODE_HOME || path.join(os.homedir(), '.zcode-agent');
}

function legacyRootDir() {
  return path.join(os.homedir(), '.zcode-cli');
}

// --- small fs helpers ---------------------------------------------------------

function writeJson600(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// --- provider/key rewriting -----------------------------------------------------

// Prune to exactly the zai-api rule and swap in the package key (§6.2 item 2).
function rewriteProviderConfig(target, key) {
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  const rules =
    parsed.config &&
    parsed.config.providerConfigRules &&
    parsed.config.providerConfigRules.providerRules;
  if (!Array.isArray(rules)) {
    throw new Error(`unexpected provider_config.json shape at ${target}`);
  }
  const zaiRules = rules.filter((r) => r && r.providerId === 'zai-api');
  if (zaiRules.length === 0) {
    throw new Error(`no zai-api rule found in provider_config.json at ${target}`);
  }
  const rule = zaiRules[0];
  rule.config = rule.config || {};
  rule.config.group = rule.config.group || 'standard-personal';
  rule.config.access = { type: 'api-key', apiKey: key };
  parsed.config.providerConfigRules.providerRules = [rule];
  writeJson600(target, parsed);
}

// Standalone (no app config to copy). modelConfigRules must be present,
// even empty: without it the engine registers no zai-api models and
// session/create fails with "Provider Registry 中不存在 Model:
// zai-api/GLM-5.3-Flash" (1.0, live-probed).
function synthesizedProviderConfig(key) {
  return {
    schemaVersion: 1,
    config: {
      modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      providerConfigRules: {
        providerRules: [
          {
            providerId: 'zai-api',
            templateId: 'zai-api',
            config: {
              group: 'standard-personal',
              access: { type: 'api-key', apiKey: key },
            },
          },
        ],
      },
    },
  };
}

// --- skills -------------------------------------------------------------------

// A --skills dir is either one skill (<dir>/SKILL.md) or a skills root
// (<dir>/<name>/SKILL.md). Returns [{name, dir}] of copyable skills.
function discoverSkillDirs(dir) {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    return [{ name: path.basename(path.resolve(dir)), dir }];
  }
  return listDir(dir)
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map((e) => ({ name: e.name, dir: path.join(dir, e.name) }));
}

// --- MCP ----------------------------------------------------------------------

// The live desktop MCP servers, read-only, honoring `enabled`.
function liveMcpServers(live = LIVE_ZCODE) {
  const cfg = readJson(path.join(live, 'cli', 'config.json'));
  const servers = cfg && cfg.mcp && cfg.mcp.servers;
  if (!servers || typeof servers !== 'object') return {};
  const out = {};
  for (const [name, def] of Object.entries(servers)) {
    if (!def || typeof def !== 'object' || def.enabled === false) continue;
    out[name] = def;
  }
  return out;
}

// Effective set for one invocation (1.0): the desktop's enabled servers
// are inherited by default, so people with the app get its MCP tools with
// no setup; --hermetic (inherit:false) keeps only the caller's --mcp
// servers. Specs always win by name. Remote servers that authenticate by
// OAuth are left out: their tokens live in the desktop's credentials.json,
// which is never copied, so they could only fail (and, live-probed in 0.4,
// stall the engine's connect pool) in a headless session.
// The desktop's local browser server (stdio, no OAuth) is inherited even
// when hermetic, so browser prompts open the same Playwright window the
// desktop opens. --no-browser drops it.
const BROWSER_SERVERS = ['playwright'];

// Standalone (no ZCode app, or an app without a Playwright server): the
// executor and the verifier still need a browser. Pinned so `zcode-agent
// doctor --install-browser` installs the exact Chromium build it drives.
const PLAYWRIGHT_MCP_VERSION = '0.0.83';
const DEFAULT_BROWSER_SERVER = {
  command: 'npx',
  args: ['-y', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, '--isolated', '--headless', '--browser', 'chromium'],
};

// The inherited Playwright MCP runs --isolated (0.7.1): a fresh in-memory
// profile per engine. A persistent profile in the session HOME was shared by
// the implementer's and every verifier's browser: "Browser is already in
// use" errors cost retries, and the verifier judged stale cached pages.
// A def that already picks its profile (--isolated, --user-data-dir) is kept.
function isolatedBrowser(def) {
  const args = Array.isArray(def.args) ? def.args : [];
  const isPlaywright = [def.command, ...args].some((a) => /@playwright\/mcp|playwright-mcp/.test(String(a)));
  if (!isPlaywright || args.some((a) => /^--(isolated|user-data-dir)\b/.test(String(a)))) return def;
  return { ...def, args: [...args, '--isolated'] };
}

// A remote server is treated as OAuth unless it carries its own static
// credentials (headers, or a key/token in the URL) or is a known public
// endpoint that needs no auth. The desktop's OAuth state is keyed by an
// opaque id, so it can't tell which servers hold tokens.
const PUBLIC_MCP_HOSTS = [
  /(^|\.)context7\.com$/,
  /^docs\.mcp\.cloudflare\.com$/,
  /^mcp\.exa\.ai$/,
  /^gitmcp\.io$/,
];

function isRemote(def) {
  return typeof def.url === 'string' && !def.command;
}

function needsOAuth(def) {
  if (!isRemote(def)) return false;
  if (def.headers && Object.keys(def.headers).length) return false;
  let url;
  try {
    url = new URL(def.url);
  } catch {
    return true;
  }
  if (/oauth/i.test(url.pathname)) return true;
  if ([...url.searchParams.keys()].some((k) => /key|token/i.test(k))) return false;
  return !PUBLIC_MCP_HOSTS.some((re) => re.test(url.hostname));
}

function inheritableMcpServers(live = LIVE_ZCODE) {
  const out = {};
  for (const [name, def] of Object.entries(liveMcpServers(live))) {
    if (!needsOAuth(def)) out[name] = def;
  }
  return out;
}

// Inherited servers that failed to connect are remembered for a while
// (<root>/mcp-health.json), so one dead server costs one session its
// connect timeout, not every session. Keyed by name + a hash of the
// server's definition: editing the server in the app retries it at once.
const MCP_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

function mcpSignature(def) {
  return crypto.createHash('sha256').update(JSON.stringify(def)).digest('hex').slice(0, 16);
}

function mcpHealthFile(root) {
  return path.join(root, 'mcp-health.json');
}

function readMcpHealth(root) {
  return (root && readJson(mcpHealthFile(root))) || {};
}

// Names from `health` whose failure is recent and whose definition is
// unchanged.
function unhealthyMcp(servers, health, now = Date.now()) {
  return Object.keys(servers).filter((name) => {
    const h = health[name];
    return h && h.sig === mcpSignature(servers[name]) && now - h.failedAt < MCP_RETRY_AFTER_MS;
  });
}

// statuses: the engine's mcp/list status map; inherited: {name: def} of the
// inherited servers this session registered. Failed ones are recorded,
// connected ones cleared. Never throws.
function recordMcpHealth(root, statuses, inherited, now = Date.now()) {
  if (!root || !statuses) return;
  try {
    const health = readMcpHealth(root);
    let changed = false;
    for (const [name, def] of Object.entries(inherited)) {
      const state = statuses[name] && statuses[name].status;
      if (state === 'failed') {
        const error = statuses[name].error;
        health[name] = {
          sig: mcpSignature(def),
          failedAt: now,
          error: error ? String(typeof error === 'string' ? error : JSON.stringify(error)).slice(0, 200) : null,
        };
        changed = true;
      } else if (state === 'connected' && health[name]) {
        delete health[name];
        changed = true;
      }
    }
    if (!changed) return;
    const file = mcpHealthFile(root);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(health, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch {
    /* health is an optimisation; a failed write just retries the server */
  }
}

function effectiveMcpServers({ inherit = true, browser = true, mcpSpecs = [], live = LIVE_ZCODE, health = {} } = {}) {
  const liveSet = liveMcpServers(live);
  const servers = inherit ? inheritableMcpServers(live) : {};
  for (const name of unhealthyMcp(servers, health)) {
    if (!BROWSER_SERVERS.includes(name)) delete servers[name];
  }
  for (const name of BROWSER_SERVERS) {
    if (!browser) delete servers[name];
    else if (liveSet[name]) servers[name] = isolatedBrowser(liveSet[name]);
  }
  if (browser && !BROWSER_SERVERS.some((n) => servers[n])) {
    servers[BROWSER_SERVERS[0]] = DEFAULT_BROWSER_SERVER;
  }
  for (const spec of mcpSpecs) {
    for (const [name, def] of Object.entries(spec)) servers[name] = def;
  }
  return servers;
}

// --- shared caches ------------------------------------------------------------

// Engine-populated caches that are expensive to recreate per session (the
// plugin marketplace cache is ~30 MB) are shared through symlinks into
// <root>/shared. A pre-0.4 shared HOME donates its caches once.
const SHARED_CACHES = [
  { name: 'plugins', rel: path.join('.zcode', 'cli', 'plugins') },
  { name: 'runtime', rel: path.join('.zcode', 'v2', 'runtime') },
];

function linkSharedCaches(home, root) {
  for (const cache of SHARED_CACHES) {
    const shared = path.join(root, 'shared', cache.name);
    if (!fs.existsSync(shared)) {
      const legacy = path.join(root, 'home', cache.rel);
      fs.mkdirSync(path.dirname(shared), { recursive: true, mode: 0o700 });
      try {
        if (fs.existsSync(legacy) && !fs.lstatSync(legacy).isSymbolicLink()) {
          fs.renameSync(legacy, shared);
        }
      } catch {
        /* fall through to an empty cache */
      }
      fs.mkdirSync(shared, { recursive: true, mode: 0o700 });
    }
    const target = path.join(home, cache.rel);
    if (fs.existsSync(target) || isDanglingLink(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.symlinkSync(shared, target, 'dir');
    } catch {
      /* engine recreates the cache itself */
    }
  }
}

function isDanglingLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink() && !fs.existsSync(p);
  } catch {
    return false;
  }
}

// --- build ------------------------------------------------------------------

// Creates or refreshes one engine HOME. Config is (re)written from the live
// sources + this invocation's flags; engine state under the HOME (cli/db,
// cli/agents, cli/rollout, logs, memories) is never touched, so a session
// stays resumable across invocations. Returns facts for reporting.
// Desktop skills that drive the app's own UI (the built-in browser pane):
// the CLI cannot serve them, and loading one steers the agent away from
// Playwright into a dead end.
// Our own orchestrator skill is never given to the executor: it would
// teach the executor to delegate to zcode-agent again.
const HOST_ONLY_SKILLS = new Set(['control-browser', 'zcode', 'zcode-agent']);

// The executor instructions every engine HOME gets as ~/.zcode/AGENTS.md.
// Named so that agents working on this repo don't read it as their own.
const EXECUTOR_AGENTS_MD = path.join(__dirname, '..', 'assets', 'executor-agents.md');
// `zcode-agent acp`: a person watches and approves in the client.
const ACP_AGENTS_MD = path.join(__dirname, '..', 'assets', 'acp-agents.md');

// Rewrites the frontmatter `model:` of an agent profile when it names
// GLM-5.3 / GLM-5.3-Flash (any prefix: "account:x/GLM-5.3",
// "custom:account%3Ax:GLM-5.3") so its model part is `model`.
function pinAgentModel(text, model) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!m) return text;
  const front = m[2].replace(/^(\s*model\s*:\s*["']?)([^\n"']*?)(?:\/|:)GLM-5\.3(?:-Flash)?(["']?\s*)$/im, (all, a, prefix, tail) => {
    const sep = all.slice(a.length + prefix.length, a.length + prefix.length + 1);
    return `${a}${prefix}${sep}${model}${tail}`;
  });
  return m[1] + front + text.slice(m[0].length - m[3].length);
}

function buildEngineHome({
  home,
  root,
  key,
  live = LIVE_ZCODE,
  mcpSpecs = [],
  hermetic = false,
  browser = true,
  skillsDirs = [],
  noSkills = false,
  inheritDesktop = false,
  profile = null,
  model = DEFAULT_MODEL,
  instructions = EXECUTOR_AGENTS_MD,
}) {
  const zdir = path.join(home, '.zcode');
  const v2 = path.join(zdir, 'v2');
  const cliDir = path.join(zdir, 'cli');
  fs.mkdirSync(v2, { recursive: true, mode: 0o700 });
  fs.mkdirSync(cliDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(home, 0o700);

  // v2: top-level files only, no credentials.json, no sqlite (§6.2 item 1).
  const liveV2 = path.join(live, 'v2');
  const v2Files = listDir(liveV2).filter((e) => e.isFile() && !isV2Excluded(e.name));
  for (const entry of v2Files) {
    fs.copyFileSync(path.join(liveV2, entry.name), path.join(v2, entry.name));
  }
  const providerConfig = path.join(v2, 'provider_config.json');
  const mode = v2Files.some((e) => e.name === 'provider_config.json')
    ? 'copied-v2-top-level'
    : 'synthesized';
  if (mode === 'synthesized') writeJson600(providerConfig, synthesizedProviderConfig(key));
  else rewriteProviderConfig(providerConfig, key);

  // cli/config.json: live copy (builtin:zai key swapped) + this run's MCP set.
  const cfg = readJson(path.join(live, 'cli', 'config.json')) || {};
  const zai = cfg.provider && cfg.provider['builtin:zai'];
  if (zai) {
    zai.options = zai.options || {};
    zai.options.apiKey = key;
  }
  const health = readMcpHealth(root);
  const servers = effectiveMcpServers({ inherit: !hermetic, browser, mcpSpecs, live, health });
  const added = mcpSpecs.flatMap((spec) => Object.keys(spec));
  const inheritedNames = hermetic ? [] : Object.keys(inheritableMcpServers(live));
  const inherited = Object.fromEntries(
    Object.entries(servers).filter(([name]) => inheritedNames.includes(name) && !added.includes(name))
  );
  const skippedUnhealthy = hermetic ? [] : unhealthyMcp(inheritableMcpServers(live), health).filter((n) => !servers[n]);
  cfg.mcp = { ...(cfg.mcp || {}), servers };
  // The desktop's plugins (browser-use, computer-use, …) inject skills and
  // tools meant for the app's own UI; the executor gets none unless
  // --inherit-desktop.
  if (!inheritDesktop) cfg.plugins = { ...(cfg.plugins || {}), enabled: false };
  writeJson600(path.join(cliDir, 'config.json'), cfg);

  // Agent profiles: only the profile this run names, unless
  // --inherit-desktop mirrors the live set.
  const agentsDir = path.join(zdir, 'agents');
  fs.rmSync(agentsDir, { recursive: true, force: true });
  for (const entry of listDir(path.join(live, 'agents'))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (!inheritDesktop && entry.name !== `${profile}.md`) continue;
    fs.mkdirSync(agentsDir, { recursive: true });
    // Profiles pinning a GLM-5.3 id would silently run another model than
    // the session's: the copy follows the session (the live file is never edited).
    const text = fs.readFileSync(path.join(live, 'agents', entry.name), 'utf8');
    fs.writeFileSync(path.join(agentsDir, entry.name), pinAgentModel(text, model));
  }

  // AGENTS.md: the package's own executor instructions (1.0). The desktop's
  // AGENTS.md is the user's guidance for interactive work (companion files
  // to read, skills to load, deploy rules); handed to an executor with a
  // binding contract it was re-litigated in the model's reasoning for
  // minutes per session (0.7.1), so it is appended only with
  // --inherit-desktop.
  const agentsMd = path.join(zdir, 'AGENTS.md');
  const parts = [fs.readFileSync(instructions, 'utf8').trim()];
  if (inheritDesktop && fs.existsSync(path.join(live, 'AGENTS.md'))) {
    parts.push(fs.readFileSync(path.join(live, 'AGENTS.md'), 'utf8').trim());
  }
  fs.writeFileSync(agentsMd, parts.join('\n\n') + '\n');

  // Skills: the desktop's user skills (1.0: inherited by default; not with
  // --hermetic or --no-skills), then this run's --skills on top.
  // Project skills (<cwd>/.zcode/skills) need no copy — the engine reads
  // them from the real workspace.
  const skillsDir = path.join(zdir, 'skills');
  fs.rmSync(skillsDir, { recursive: true, force: true });
  fs.mkdirSync(skillsDir, { recursive: true });
  let skillsCopied = 0;
  if (!noSkills && !hermetic) {
    // Most desktop skills are symlinks into ~/.claude/skills or ~/.agents:
    // follow them, and copy the target (the session HOME must not point
    // back into live directories).
    const liveSkills = path.join(live, 'skills');
    for (const entry of listDir(liveSkills)) {
      if (HOST_ONLY_SKILLS.has(entry.name)) continue;
      const from = path.join(liveSkills, entry.name);
      if (!fs.existsSync(path.join(from, 'SKILL.md'))) continue;
      fs.cpSync(from, path.join(skillsDir, entry.name), { recursive: true, dereference: true });
      skillsCopied++;
    }
  }
  const skillsInjected = [];
  if (!noSkills) {
    for (const dir of skillsDirs) {
      for (const { name, dir: skillDir } of discoverSkillDirs(dir)) {
        fs.rmSync(path.join(skillsDir, name), { recursive: true, force: true });
        fs.cpSync(skillDir, path.join(skillsDir, name), { recursive: true });
        skillsInjected.push(name);
      }
    }
  }

  if (root) linkSharedCaches(home, root);

  return {
    home,
    mode,
    copiedFiles: v2Files.length,
    skillsCopied,
    skillsInjected,
    mcp: {
      servers,
      // Names the caller explicitly added — the CLI waits for these to
      // settle before sending the prompt. Inherited servers are best-effort.
      added,
      // The desktop's servers this session registered ({name: def}), and
      // those left out because they failed recently (mcp-health.json).
      inherited,
      skippedUnhealthy,
    },
  };
}

// --- migration ----------------------------------------------------------------

// The only names pre-0.4 versions created at a root. migrateRoot moves
// exactly these out of legacy locations and never touches anything else.
const OUR_ARTIFACTS = ['credentials.json', 'build-stamp.json', 'injected-skills.json', 'home'];

// 0.3.2 migration: vacate our artifacts from (a) the live ~/.zcode, where
// 0.3.0/0.3.1 wrongly wrote them, and (b) the pre-rename ~/.zai-code root,
// into our root. Idempotent; never writes or deletes anything
// else in the live directory.
//
// 1.0 migration: the pre-rename ~/.zcode-cli root moves to ~/.zcode-agent
// whole, and a symlink is left in its place. Session records and engine
// HOMEs hold absolute paths under the old root; the link keeps them (and
// any still-running pre-1.0 process) resolving.
function migrateLegacyRoot(root) {
  const legacy = legacyRootDir();
  try {
    if (fs.existsSync(root) || !fs.lstatSync(legacy).isDirectory()) return;
    fs.renameSync(legacy, root);
    fs.symlinkSync(root, legacy, 'dir');
  } catch {
    /* no legacy root, or it stays where it is; nothing is lost */
  }
}

function migrateRoot(env = process.env) {
  const root = rootDir(env);
  if (!env.ZAI_CODE_HOME) migrateLegacyRoot(root);
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  } catch {
    return; // unwritable home — callers surface it
  }
  const sources = [liveDir(env), path.join(os.homedir(), '.zai-code')];
  for (const dir of sources) {
    let entries;
    try {
      entries = new Set(fs.readdirSync(dir));
    } catch {
      continue;
    }
    for (const name of OUR_ARTIFACTS) {
      if (!entries.has(name)) continue;
      const src = path.join(dir, name);
      const dest = path.join(root, name);
      try {
        if (fs.existsSync(dest)) fs.rmSync(src, { recursive: true, force: true });
        else fs.renameSync(src, dest);
      } catch {
        /* keep going; a missing artifact just rebuilds */
      }
    }
  }
}

// Env for the engine child process (§6.3): HOME=scratch, pinned builtin
// config, and the uncontrolled overrides deleted. cwd is set by the caller.
// `sessionEnv` (ZCODE_SESSION_ID, ZCODE_PORT, …) is applied last so nothing
// inherited can shadow it; the engine's tools inherit it.
function engineEnv({ home, builtinProviderConfig, parentEnv = process.env, sessionEnv = {} }) {
  const childEnv = { ...parentEnv };
  const realHome = parentEnv.HOME || os.homedir();
  // The scratch HOME hides the user's tool caches. Point Playwright and npm
  // back at the real ones so installed browsers and packages are found.
  if (!childEnv.PLAYWRIGHT_BROWSERS_PATH) {
    const cache = process.platform === 'darwin'
      ? path.join(realHome, 'Library', 'Caches', 'ms-playwright')
      : path.join(realHome, '.cache', 'ms-playwright');
    if (fs.existsSync(cache)) childEnv.PLAYWRIGHT_BROWSERS_PATH = cache;
  }
  if (!childEnv.npm_config_cache && !childEnv.NPM_CONFIG_CACHE) {
    childEnv.npm_config_cache = path.join(realHome, '.npm');
  }
  childEnv.HOME = home;
  childEnv.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtinProviderConfig;
  for (const name of [
    'ZCODE_STORAGE_DIR',
    'ZCODE_DATA_BASE_DIR',
    'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
  ]) {
    delete childEnv[name];
  }
  Object.assign(childEnv, sessionEnv);
  return childEnv;
}

module.exports = {
  buildEngineHome,
  pinAgentModel,
  engineEnv,
  rootDir,
  liveDir,
  migrateRoot,
  effectiveMcpServers,
  liveMcpServers,
  inheritableMcpServers,
  needsOAuth,
  EXECUTOR_AGENTS_MD,
  ACP_AGENTS_MD,
  DEFAULT_BROWSER_SERVER,
  PLAYWRIGHT_MCP_VERSION,
  readMcpHealth,
  recordMcpHealth,
  unhealthyMcp,
  mcpSignature,
  discoverSkillDirs,
  LIVE_ZCODE,
  LIVE_V2,
};

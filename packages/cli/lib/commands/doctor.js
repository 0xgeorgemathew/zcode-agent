'use strict';
// lib/commands/doctor.js — engine, key, inherited setup and browser report.
// Builds a probe engine HOME (<root>/doctor/home) exactly the way a session
// does, so what doctor reports is what a session gets. Never prints the key.
// --install-browser installs the Chromium build the default (standalone)
// Playwright server drives.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256File, engineVersion, packagedEngine } = require('../engine.js');
const { resolveRuntime, ConfigError } = require('../bootstrap.js');
const {
  buildEngineHome, engineEnv, rootDir, liveDir, liveMcpServers, DEFAULT_BROWSER_SERVER, PLAYWRIGHT_MCP_VERSION,
} = require('../isolation.js');
const store = require('../store.js');
const { modelLevels, modelVision } = require('../models.js');

// node:sqlite without a flag (the engine's session DB) arrived in 22.13.
const MIN_NODE = [22, 13];
const KEY_SOURCES = {
  env: 'ZAI_API_KEY',
  login: 'zcode-agent login',
  desktop: 'the ZCode app (read in place, never copied)',
};

function nodeOk(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

function testedEngineVersion() {
  try {
    return require('@zcode-agent/engine').version;
  } catch {
    return null;
  }
}

function playwrightCache(env) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  const home = env.HOME || os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright');
  return path.join(home, '.cache', 'ms-playwright');
}

function hasChromium(env) {
  try {
    return fs.readdirSync(playwrightCache(env)).some((n) => /^chromium(_headless_shell)?-\d+$/.test(n));
  } catch {
    return false;
  }
}

// `playwright install chromium` from the exact @playwright/mcp version the
// default server runs, so the browser revision matches.
function installBrowser() {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const res = spawnSync(npx, ['-y', '-p', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, 'playwright', 'install', 'chromium'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return res.status === 0;
}

module.exports = async function doctor(parsed) {
  const flags = parsed.flags;
  // First, so a machine without a key yet can still get its browser.
  const browserInstalled = flags.installBrowser ? installBrowser() : null;
  let runtime;
  try {
    runtime = resolveRuntime(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`zcode-agent: ${err.message}\n`);
      process.exit(err.exitCode);
    }
    throw err;
  }
  const { enginePath, builtinConfig, nodeBin } = runtime;
  const root = rootDir(process.env);
  const live = liveDir(process.env);
  const built = buildEngineHome({
    home: path.join(root, 'doctor', 'home'),
    root,
    key: runtime.key,
    live,
    hermetic: process.env.ZCODE_HERMETIC === '1',
  });
  const version = engineVersion(nodeBin, enginePath, engineEnv({ home: built.home, builtinProviderConfig: builtinConfig }));
  const tested = testedEngineVersion();
  const packaged = packagedEngine();
  const engineSource = process.env.ZAI_CODE_ENGINE
    ? 'ZAI_CODE_ENGINE'
    : packaged && path.resolve(packaged) === path.resolve(enginePath)
      ? '@zcode-agent/engine'
      : 'the ZCode app';
  const nodeVersion = process.versions.node;
  const sessions = store.listSessions(process.env);
  const liveSet = Object.keys(liveMcpServers(live));
  const servers = Object.keys(built.mcp.servers);
  const browserDef = built.mcp.servers.playwright;
  const defaultBrowser = browserDef === DEFAULT_BROWSER_SERVER;

  const chromium = hasChromium(process.env);

  const warnings = [];
  if (!nodeOk(nodeVersion)) warnings.push(`node ${nodeVersion} is too old: the engine needs node >= ${MIN_NODE.join('.')} (node:sqlite)`);
  if (tested && version && version !== tested) warnings.push(`engine ${version} differs from the tested ${tested}`);
  if (defaultBrowser && !chromium) warnings.push('no Playwright Chromium found for the default browser server: run zcode-agent doctor --install-browser');
  if (browserInstalled === false) warnings.push('browser install failed (see the output above)');

  const report = {
    ok: nodeOk(nodeVersion) && browserInstalled !== false,
    node: { version: nodeVersion, engineBin: nodeBin, minimum: MIN_NODE.join('.') },
    engine: {
      path: enginePath,
      source: engineSource,
      sha256: sha256File(enginePath),
      version,
      tested,
      builtinProviderConfig: builtinConfig,
    },
    key: { configured: true, source: runtime.keySource },
    models: modelLevels({ builtinConfig }),
    vision: modelVision({ builtinConfig }),
    desktop: {
      dir: live,
      found: fs.existsSync(live),
      mcpServers: liveSet.length,
    },
    isolation: {
      root,
      home: built.home,
      sessionsDir: store.sessionsDir(process.env),
      mode: built.mode,
      hermetic: process.env.ZCODE_HERMETIC === '1',
      mcpServers: servers,
      mcpSkippedOAuth: liveSet.filter((n) => !servers.includes(n)),
      skillsInherited: built.skillsCopied,
    },
    browser: {
      server: defaultBrowser ? `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION} (default, headless)` : browserDef ? 'the ZCode app\'s playwright server' : 'none (--no-browser)',
      chromium,
      ...(browserInstalled !== null && { installed: browserInstalled }),
    },
    sessions: {
      total: sessions.length,
      running: sessions.filter((s) => s.live).length,
      interrupted: sessions.filter((s) => s.state === 'interrupted').length,
    },
    warnings,
  };

  if (flags.json) {
    process.stdout.write(JSON.stringify(report) + '\n');
  } else {
    const iso = report.isolation;
    process.stdout.write(
      [
        'zcode-agent doctor',
        `  node ${nodeVersion} (${nodeBin})`,
        `  engine ${version ?? 'unknown'} from ${engineSource}${tested ? ` (tested: ${tested})` : ''}`,
        `    ${enginePath}`,
        `    sha256 ${report.engine.sha256}`,
        `  api key from ${KEY_SOURCES[runtime.keySource] || runtime.keySource} (never printed)`,
        `  models ${Object.entries(report.models).map(([id, l]) => `${id} (effort ${l.join('|')}, ${report.vision[id] ? 'images' : 'no images'})`).join(', ')}`,
        report.desktop.found ? `  ZCode app settings ${live}` : '  ZCode app not found: standalone mode',
        `  mcp servers ${servers.length ? servers.join(', ') : 'none'}${iso.mcpSkippedOAuth.length ? ` (skipped, OAuth: ${iso.mcpSkippedOAuth.join(', ')})` : ''}`,
        `  skills inherited ${iso.skillsInherited}${iso.hermetic ? ' (ZCODE_HERMETIC=1)' : ''}`,
        `  browser ${report.browser.server}; Playwright Chromium ${chromium ? 'found' : 'missing'}`,
        `  state ${root} (one engine HOME per session)`,
        `  sessions ${report.sessions.total} (${report.sessions.running} running, ${report.sessions.interrupted} interrupted)`,
        ...warnings.map((w) => `  ⚠ ${w}`),
      ].join('\n') + '\n'
    );
  }
  process.exit(report.ok ? 0 : 1);
};

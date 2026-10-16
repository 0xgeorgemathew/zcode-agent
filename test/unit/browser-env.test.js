'use strict';
// Browser requests get a usable answer, and the scratch HOME still sees the
// user's Playwright browsers and npm cache.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppServerClient } = require('../../lib/appserver.js');
const { engineEnv } = require('../../lib/isolation.js');

function fakeClient() {
  const client = Object.create(AppServerClient.prototype);
  client.sent = [];
  client.child = { stdin: { write: (line) => client.sent.push(JSON.parse(line)) } };
  return client;
}

test('browserList answers with an empty list, browserExecute with a clear error', () => {
  const c = fakeClient();
  c._handleServerRequest({ id: 1, method: 'interaction/browserList', params: {} });
  c._handleServerRequest({ id: 2, method: 'interaction/browserExecute', params: {} });
  assert.deepEqual(c.sent[0], { id: 1, result: { browsers: [] } });
  assert.match(c.sent[1].error.message, /Playwright/);
});

test('engine env points Playwright and npm at the real HOME caches', () => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-home-'));
  const cache = process.platform === 'darwin'
    ? path.join(real, 'Library', 'Caches', 'ms-playwright')
    : path.join(real, '.cache', 'ms-playwright');
  fs.mkdirSync(cache, { recursive: true });
  const env = engineEnv({ home: '/scratch', builtinProviderConfig: '/c', parentEnv: { HOME: real } });
  assert.equal(env.HOME, '/scratch');
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, cache);
  assert.equal(env.npm_config_cache, path.join(real, '.npm'));
  const kept = engineEnv({ home: '/s', builtinProviderConfig: '/c', parentEnv: { HOME: real, PLAYWRIGHT_BROWSERS_PATH: '/mine' } });
  assert.equal(kept.PLAYWRIGHT_BROWSERS_PATH, '/mine');
});

test('the desktop playwright server is inherited by default; --no-browser drops it', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-live-'));
  fs.mkdirSync(path.join(live, 'cli'));
  fs.writeFileSync(path.join(live, 'cli', 'config.json'), JSON.stringify({ mcp: { servers: {
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
    exa: { url: 'https://mcp.exa.ai/mcp' },
  } } }));
  const { effectiveMcpServers } = require('../../lib/isolation.js');
  assert.deepEqual(Object.keys(effectiveMcpServers({ live })), ['playwright']);
  assert.deepEqual(Object.keys(effectiveMcpServers({ live, browser: false })), []);
  assert.deepEqual(Object.keys(effectiveMcpServers({ live, inherit: true, browser: false })), ['exa']);
});

test('the desktop-only control-browser skill is not copied, even with --inherit-desktop', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-live-'));
  for (const name of ['control-browser', 'other']) {
    fs.mkdirSync(path.join(live, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(live, 'skills', name, 'SKILL.md'), '---\nname: x\n---\n');
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-eh-'));
  const { buildEngineHome } = require('../../lib/isolation.js');
  buildEngineHome({ home, live, key: 'k', inheritDesktop: true });
  assert.deepEqual(fs.readdirSync(path.join(home, '.zcode', 'skills')), ['other']);
});

test('hermetic by default: no desktop AGENTS.md, skills, plugins or unnamed agent profiles', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-live-'));
  fs.mkdirSync(path.join(live, 'skills', 'cloudflare'), { recursive: true });
  fs.writeFileSync(path.join(live, 'skills', 'cloudflare', 'SKILL.md'), '---\nname: x\n---\n');
  fs.writeFileSync(path.join(live, 'AGENTS.md'), 'Read CLOUDFLARE.md first.');
  fs.mkdirSync(path.join(live, 'agents'), { recursive: true });
  for (const n of ['flash.md', 'mine.md']) fs.writeFileSync(path.join(live, 'agents', n), '---\nname: x\n---\n');
  fs.mkdirSync(path.join(live, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(live, 'cli', 'config.json'), JSON.stringify({ plugins: { enabledPlugins: { 'a@b': true } } }));
  const { buildEngineHome } = require('../../lib/isolation.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-eh-'));
  const z = path.join(home, '.zcode');
  const built = buildEngineHome({ home, live, key: 'k', profile: 'mine' });
  assert.equal(built.skillsCopied, 0);
  assert.deepEqual(fs.readdirSync(path.join(z, 'skills')), []);
  assert.equal(fs.existsSync(path.join(z, 'AGENTS.md')), false);
  assert.deepEqual(fs.readdirSync(path.join(z, 'agents')), ['mine.md'], 'only the named profile');
  assert.equal(JSON.parse(fs.readFileSync(path.join(z, 'cli', 'config.json'), 'utf8')).plugins.enabled, false);
  buildEngineHome({ home, live, key: 'k', inheritDesktop: true });
  assert.deepEqual(fs.readdirSync(path.join(z, 'skills')), ['cloudflare']);
  assert.equal(fs.readFileSync(path.join(z, 'AGENTS.md'), 'utf8'), 'Read CLOUDFLARE.md first.');
  assert.deepEqual(fs.readdirSync(path.join(z, 'agents')).sort(), ['flash.md', 'mine.md']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(z, 'cli', 'config.json'), 'utf8')).plugins.enabled, undefined);
});

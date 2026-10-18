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

test('desktop MCP servers are inherited by default (OAuth-only remotes never); --hermetic keeps only the browser', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-live-'));
  fs.mkdirSync(path.join(live, 'cli'));
  fs.writeFileSync(path.join(live, 'cli', 'config.json'), JSON.stringify({ mcp: { servers: {
    playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
    exa: { url: 'https://mcp.exa.ai/mcp' },
    linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
    search: { type: 'http', url: 'https://search.example.com/mcp-oauth' },
    tokened: { type: 'http', url: 'https://jobs.example.com/mcp', headers: { Authorization: 'Bearer x' } },
    keyed: { type: 'http', url: 'https://api.example.com/mcp?api_key=x' },
    off: { command: 'off', enabled: false },
  } } }));
  const { effectiveMcpServers } = require('../../lib/isolation.js');
  assert.deepEqual(Object.keys(effectiveMcpServers({ live })).sort(), ['exa', 'keyed', 'playwright', 'tokened']);
  assert.deepEqual(Object.keys(effectiveMcpServers({ live, browser: false })).sort(), ['exa', 'keyed', 'tokened']);
  assert.deepEqual(Object.keys(effectiveMcpServers({ live, inherit: false })), ['playwright']);
  assert.deepEqual(Object.keys(effectiveMcpServers({ live, inherit: false, browser: false })), []);
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

test('by default: desktop skills, no desktop AGENTS.md, plugins or unnamed agent profiles; the package AGENTS.md always', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-live-'));
  fs.mkdirSync(path.join(live, 'skills', 'cloudflare'), { recursive: true });
  fs.writeFileSync(path.join(live, 'skills', 'cloudflare', 'SKILL.md'), '---\nname: x\n---\n');
  fs.writeFileSync(path.join(live, 'AGENTS.md'), 'Read CLOUDFLARE.md first.');
  fs.mkdirSync(path.join(live, 'agents'), { recursive: true });
  for (const n of ['flash.md', 'mine.md']) fs.writeFileSync(path.join(live, 'agents', n), '---\nname: x\n---\n');
  fs.mkdirSync(path.join(live, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(live, 'cli', 'config.json'), JSON.stringify({ plugins: { enabledPlugins: { 'a@b': true } } }));
  const { buildEngineHome, EXECUTOR_AGENTS_MD } = require('../../lib/isolation.js');
  const ours = fs.readFileSync(EXECUTOR_AGENTS_MD, 'utf8').trim();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-eh-'));
  const z = path.join(home, '.zcode');
  const built = buildEngineHome({ home, live, key: 'k', profile: 'mine' });
  assert.equal(built.skillsCopied, 1);
  assert.deepEqual(fs.readdirSync(path.join(z, 'skills')), ['cloudflare']);
  assert.equal(fs.readFileSync(path.join(z, 'AGENTS.md'), 'utf8'), ours + '\n');
  assert.deepEqual(fs.readdirSync(path.join(z, 'agents')), ['mine.md'], 'only the named profile');
  assert.equal(JSON.parse(fs.readFileSync(path.join(z, 'cli', 'config.json'), 'utf8')).plugins.enabled, false);

  buildEngineHome({ home, live, key: 'k', profile: 'mine', hermetic: true });
  assert.deepEqual(fs.readdirSync(path.join(z, 'skills')), [], '--hermetic: no desktop skills');
  assert.equal(fs.readFileSync(path.join(z, 'AGENTS.md'), 'utf8'), ours + '\n');

  buildEngineHome({ home, live, key: 'k', inheritDesktop: true });
  assert.deepEqual(fs.readdirSync(path.join(z, 'skills')), ['cloudflare']);
  assert.equal(fs.readFileSync(path.join(z, 'AGENTS.md'), 'utf8'), ours + '\n\nRead CLOUDFLARE.md first.\n');
  assert.deepEqual(fs.readdirSync(path.join(z, 'agents')).sort(), ['flash.md', 'mine.md']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(z, 'cli', 'config.json'), 'utf8')).plugins.enabled, undefined);
});

test('the desktop API key is used when no env key or login exists; OAuth tokens never are', () => {
  const { readDesktopKey, resolveKeyInfo } = require('../../lib/key.js');
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-live-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-root-'));
  fs.mkdirSync(path.join(live, 'v2'), { recursive: true });
  fs.writeFileSync(path.join(live, 'v2', 'credentials.json'), JSON.stringify({ 'oauth:zai:access_token': 'oauth-token' }));
  assert.equal(readDesktopKey(live), '');
  fs.writeFileSync(path.join(live, 'v2', 'config.json'), JSON.stringify({ provider: {
    'builtin:zai-start-plan': { enabled: true, options: { apiKey: 'plan-jwt' } },
    'builtin:zai-coding-plan': { enabled: true, options: { apiKey: 'plan-key' } },
  } }));
  assert.equal(readDesktopKey(live), 'plan-key');
  fs.writeFileSync(path.join(live, 'v2', 'provider_config.json'), JSON.stringify({ config: { providerConfigRules: { providerRules: [
    { providerId: 'other', config: { access: { type: 'api-key', apiKey: 'other-key' } } },
    { providerId: 'zai-api', config: { access: { type: 'api-key', apiKey: 'rule-key' } } },
  ] } } }));
  assert.equal(readDesktopKey(live), 'rule-key');

  const env = { ZAI_CODE_HOME: root, ZAI_CODE_LIVE_DIR: live };
  assert.deepEqual(resolveKeyInfo(env), { key: 'rule-key', source: 'desktop' });
  fs.writeFileSync(path.join(root, 'credentials.json'), JSON.stringify({ apiKey: 'login-key' }));
  assert.deepEqual(resolveKeyInfo(env), { key: 'login-key', source: 'login' });
  assert.deepEqual(resolveKeyInfo({ ...env, ZAI_API_KEY: 'env-key' }), { key: 'env-key', source: 'env' });
  fs.rmSync(path.join(root, 'credentials.json'));
  assert.throws(() => resolveKeyInfo({ ...env, ZCODE_NO_DESKTOP_KEY: '1' }), /zcode-agent login/);
});

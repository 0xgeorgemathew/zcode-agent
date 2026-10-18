'use strict';
// API key resolution (DESIGN §5): ZAI_API_KEY env →
// ~/.zcode-agent/credentials.json ({"apiKey":"…"}, mode 600, written by
// `zcode-agent login`) → the ZCode desktop app's own Z.ai API key (1.0:
// people with the app need no login). The desktop key is read in place,
// never copied anywhere but the per-session provider config, and only a
// plain API key qualifies: OAuth tokens (credentials.json) are never read.
// The key is never printed, logged, or echoed by anything in this package.
const fs = require('node:fs');
const path = require('node:path');
const { migrateRoot, rootDir, liveDir } = require('./isolation.js');

function credentialsPath(env = process.env) {
  return path.join(rootDir(env), 'credentials.json');
}

class NoKeyError extends Error {
  constructor() {
    super('No API key configured. Run "zcode-agent login" (key on stdin), set ZAI_API_KEY, or add a Z.ai API key in the ZCode app.');
    this.code = 'ZAI_NO_KEY';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Reads {"apiKey": ...} from the credentials file; returns '' when absent.
function readCredentialsKey(file) {
  const parsed = readJson(file);
  return parsed ? str(parsed.apiKey) : '';
}

// The desktop's Z.ai API key, in the order the app itself uses it: the
// zai-api provider rule (v2/provider_config.json), then the builtin:zai
// provider of the CLI config, then the enabled builtin Z.ai providers of
// v2/config.json. Plan tokens of other shapes (start-plan JWTs) are skipped.
function readDesktopKey(live) {
  const rules = readJson(path.join(live, 'v2', 'provider_config.json'));
  const list = rules && rules.config && rules.config.providerConfigRules && rules.config.providerConfigRules.providerRules;
  for (const rule of Array.isArray(list) ? list : []) {
    const access = rule && rule.providerId === 'zai-api' && rule.config && rule.config.access;
    if (access && access.type === 'api-key' && str(access.apiKey)) return str(access.apiKey);
  }
  const cli = readJson(path.join(live, 'cli', 'config.json'));
  const zai = cli && cli.provider && cli.provider['builtin:zai'];
  if (zai && zai.options && str(zai.options.apiKey)) return str(zai.options.apiKey);
  const v2 = readJson(path.join(live, 'v2', 'config.json'));
  for (const id of ['builtin:zai-coding-plan', 'builtin:zai', 'builtin:bigmodel-coding-plan', 'builtin:bigmodel']) {
    const p = v2 && v2.provider && v2.provider[id];
    if (p && p.enabled !== false && p.options && str(p.options.apiKey)) return str(p.options.apiKey);
  }
  return '';
}

// {key, source}: source is "env", "login" or "desktop". Throws NoKeyError
// when none holds a key.
function resolveKeyInfo(env = process.env) {
  migrateRoot(env); // vacate legacy roots first
  const fromEnv = str(env.ZAI_API_KEY);
  if (fromEnv) return { key: fromEnv, source: 'env' };
  const fromFile = readCredentialsKey(credentialsPath(env));
  if (fromFile) return { key: fromFile, source: 'login' };
  if (env.ZCODE_NO_DESKTOP_KEY !== '1') {
    const fromDesktop = readDesktopKey(liveDir(env));
    if (fromDesktop) return { key: fromDesktop, source: 'desktop' };
  }
  throw new NoKeyError();
}

function resolveKey(env = process.env) {
  return resolveKeyInfo(env).key;
}

module.exports = { resolveKey, resolveKeyInfo, readDesktopKey, credentialsPath, rootDir, NoKeyError };

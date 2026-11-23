'use strict';
// lib/commands/mcp-list.js — print the effective MCP server set for this
// invocation as one JSON line and exit 0. Never spawns the engine and needs
// no key; the set is exactly what a run with the same flags registers, with
// credentials redacted (headers, env and URLs commonly hold tokens, and
// Z.ai's own MCP servers hold the Z.ai key).
const { effectiveMcpServers, liveDir, rootDir, readMcpHealth } = require('../isolation.js');

const SECRET_HEADER = /authorization|api[-_]?key|token|secret|cookie/i;
const SECRET_ENV = /key|token|secret|password|auth/i;
const SECRET_PARAMS = new Set(['key', 'api_key', 'apikey', 'token', 'access_token', 'secret']);

function redactUrl(url) {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    for (const name of [...u.searchParams.keys()]) {
      if (SECRET_PARAMS.has(name.toLowerCase())) u.searchParams.set(name, '***');
    }
    return u.toString();
  } catch {
    return url;
  }
}

function redact(def) {
  const out = { ...def };
  const mask = (obj, re) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, re.test(k) ? '***' : v]));
  if (out.headers && typeof out.headers === 'object') out.headers = mask(out.headers, SECRET_HEADER);
  if (out.env && typeof out.env === 'object') out.env = mask(out.env, SECRET_ENV);
  if (typeof out.url === 'string') out.url = redactUrl(out.url);
  return out;
}

module.exports = async function mcpList(parsed) {
  const { flags } = parsed;
  // The same app dir and MCP health a run reads, so servers a run would skip
  // (recently failed) are not listed.
  const servers = effectiveMcpServers({
    inherit: !flags.hermetic && process.env.ZCODE_HERMETIC !== '1',
    browser: !flags.noBrowser,
    mcpSpecs: flags.mcpSpecs,
    live: liveDir(process.env),
    health: readMcpHealth(rootDir(process.env)),
  });
  let line = JSON.stringify({ type: 'mcp', servers: Object.fromEntries(Object.entries(servers).map(([n, d]) => [n, redact(d)])) });
  // Best effort: the key itself, wherever a definition carries it (args).
  try {
    const { key } = require('../key.js').resolveKeyInfo(process.env);
    if (key) line = line.split(key).join('***');
  } catch {
    /* no key configured: nothing to remove */
  }
  process.stdout.write(line + '\n');
  process.exit(0);
};

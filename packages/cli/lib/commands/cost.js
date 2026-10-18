'use strict';
// lib/commands/cost.js — `zcode cost [<dir>] [--app] [--json]`: what the GLM
// work in a directory cost at API list price, per session and in total.
// Read-only over the session store and the engine DBs; no engine, no key.
const path = require('node:path');
const cost = require('../cost.js');

function row(cols, widths) {
  return cols.map((c, i) => (i >= cols.length - 5 ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  ').trimEnd();
}

function table(entries, title) {
  const head = [title, 'status', 'model', 'req', 'input', 'cached', 'output', 'cost'];
  const rows = entries.map((e) => {
    const c = e.cost;
    return [
      e.id.length > 40 ? `${e.id.slice(0, 39)}…` : e.id,
      e.status || '',
      e.model || '',
      c ? c.requests : '-',
      c ? cost.formatTokens(c.input) : '-',
      c ? cost.formatTokens(c.cached) : '-',
      c ? cost.formatTokens(c.output) : '-',
      c ? `${cost.formatUsd(c.usd)}${c.estimate ? '~' : ''}` : '-',
    ];
  });
  const widths = head.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)));
  return [row(head, widths), ...rows.map((r) => row(r, widths))].join('\n');
}

module.exports = async function costCommand(parsed) {
  const { flags, prompts } = parsed;
  if (prompts.length > 1) {
    process.stderr.write('zcode-agent: cost takes at most one directory.\n');
    process.exit(2);
  }
  const dir = path.resolve(prompts[0] || flags.cwd || process.cwd());
  const sessions = cost.dirSessions(dir);
  const app = flags.app ? cost.appSessions(dir) : null;
  const zTotal = cost.sumCosts(sessions.map((s) => s.cost));
  const aTotal = app ? cost.sumCosts(app.map((s) => s.cost)) : null;
  const total = cost.sumCosts([zTotal, aTotal]);

  if (flags.json) {
    const out = { type: 'cost', dir, currency: 'USD', basis: 'Z.ai API list price', total, sessions };
    if (flags.app) out.app = app === null ? { error: `desktop app DB not readable` } : { total: aTotal, sessions: app };
    process.stdout.write(JSON.stringify(out) + '\n');
    return;
  }
  const lines = [];
  if (sessions.length) lines.push(table(sessions, 'zcode-agent session'));
  else lines.push(`no zcode-agent sessions in ${dir}`);
  if (flags.app) {
    if (app === null) lines.push('', 'desktop app: DB not readable');
    else if (!app.length) lines.push('', `no desktop app sessions in ${dir}`);
    else lines.push('', table(app.map((s) => ({ ...s, id: s.title || s.id, status: 'app' })), 'desktop session'));
  }
  const n = sessions.length + (app ? app.length : 0);
  lines.push(
    '',
    `total  ${n} session${n === 1 ? '' : 's'}  ${total.requests} requests  ` +
      `${cost.formatTokens(total.input)} input (${cost.formatTokens(total.cached)} cached)  ` +
      `${cost.formatTokens(total.output)} output  ${cost.formatUsd(total.usd)}${total.estimate ? '~' : ''}`,
    `Z.ai API list price${total.estimate ? '; ~ = no cache split, priced as uncached input' : ''}; ZCODE_PRICES overrides`
  );
  process.stdout.write(lines.join('\n') + '\n');
};

'use strict';
// Cost of GLM usage at API list price. The source of truth is the engine's
// own per-request ledger (model_usage in <session home>/.zcode/cli/db/
// db.sqlite): every request of the implementer, its subagents and the visual
// verifier, with cached input split out (GLM agents run ~95% cached, so
// pricing all input at the full rate would overstate cost ~5x). Sessions
// without an engine DB fall back to the record's usageTotal (no cache split:
// marked `estimate`). Read-only; never blocks the engine (WAL readers).
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store.js');
const { liveDir } = require('./isolation.js');

// USD per million tokens, Z.ai API list prices. ZCODE_PRICES (JSON, same
// shape, keyed by model id, case-insensitive) overrides or adds models.
// `provisional`: Z.ai has published no API price yet (GLM-5.4 shipped on the
// Coding Plan first, 2026-11-23); priced like GLM-5.1 to 5.3, which all list
// at the same rate, and marked as an estimate until the real price is in.
const LIST_PRICES = {
  'GLM-5.4': { input: 1.4, cached: 0.26, output: 4.4, provisional: true },
  'GLM-5.3-Flash': { input: 0.15, cached: 0.03, output: 0.5 },
  'GLM-5.3': { input: 1.4, cached: 0.26, output: 4.4 },
};

function priceTable(env = process.env) {
  const table = {};
  for (const [k, v] of Object.entries(LIST_PRICES)) table[k.toLowerCase()] = v;
  if (env.ZCODE_PRICES) {
    try {
      const extra = JSON.parse(env.ZCODE_PRICES);
      for (const [k, v] of Object.entries(extra || {})) {
        // A caller's own price is not provisional.
        if (v && typeof v === 'object') table[k.toLowerCase()] = { ...table[k.toLowerCase()], provisional: false, ...v };
      }
    } catch {
      /* ignored: list prices */
    }
  }
  return table;
}

// USD for one model's token counts, or null when the model has no price.
// `input` includes cached and cache-write tokens, as the engine records it.
function priceOf(model, { input = 0, cached = 0, cacheWrite = 0, output = 0 }, env = process.env) {
  const p = priceTable(env)[String(model || '').toLowerCase()];
  if (!p) return null;
  const fresh = Math.max(0, input - cached - cacheWrite);
  return (fresh * p.input + cached * (p.cached ?? p.input) + cacheWrite * (p.cacheWrite ?? p.input) + output * p.output) / 1e6;
}

// --- sqlite (node:sqlite on Node >= 22.5, else the sqlite3 CLI) ---------------

let nodeSqlite;
function loadNodeSqlite() {
  if (nodeSqlite !== undefined) return nodeSqlite;
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (/sqlite/i.test(String(w)) ? undefined : emit.call(process, w, ...rest));
  try {
    nodeSqlite = require('node:sqlite');
  } catch {
    nodeSqlite = null;
  } finally {
    process.emitWarning = emit;
  }
  return nodeSqlite;
}

// Rows of `sql` against `file` opened read-only, or null when unreadable.
function query(file, sql, params = []) {
  if (!fs.existsSync(file)) return null;
  const mod = loadNodeSqlite();
  if (mod && mod.DatabaseSync) {
    let db;
    try {
      db = new mod.DatabaseSync(file, { readOnly: true });
      return db.prepare(sql).all(...params);
    } catch {
      return null;
    } finally {
      try {
        if (db) db.close();
      } catch {
        /* closed */
      }
    }
  }
  return null;
}

const SUMS = `count(*) AS requests,
  coalesce(sum(input_tokens), 0) AS input,
  coalesce(sum(cache_read_input_tokens), 0) AS cached,
  coalesce(sum(cache_creation_input_tokens), 0) AS cacheWrite,
  coalesce(sum(output_tokens), 0) AS output`;

function engineDbOf(id, env = process.env) {
  return path.join(store.sessionDir(id, env), 'home', '.zcode', 'cli', 'db', 'db.sqlite');
}

// Fold per-model rows into {requests, input, cached, cacheWrite, output,
// usd, models: {model: {...counts, usd}}, unpriced?: [models]}.
function fold(rows, env) {
  const total = { requests: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, usd: 0, models: {} };
  const unpriced = [];
  const table = priceTable(env);
  for (const r of rows) {
    const counts = {
      requests: Number(r.requests) || 0,
      input: Number(r.input) || 0,
      cached: Number(r.cached) || 0,
      cacheWrite: Number(r.cacheWrite) || 0,
      output: Number(r.output) || 0,
    };
    const usd = priceOf(r.model, counts, env);
    if (usd === null) unpriced.push(r.model);
    const price = table[String(r.model || '').toLowerCase()];
    if (price && price.provisional && counts.requests + counts.input + counts.output > 0) total.estimate = true;
    total.models[r.model] = { ...counts, usd };
    for (const k of ['requests', 'input', 'cached', 'cacheWrite', 'output']) total[k] += counts[k];
    total.usd += usd || 0;
  }
  if (unpriced.length) total.unpriced = unpriced;
  return total;
}

// Mtime-keyed cache so `zcode watch` can ask every 2 s without re-querying an
// idle session's DB.
const cache = new Map();
function dbStamp(file) {
  let s = '';
  for (const f of [file, `${file}-wal`]) {
    try {
      const st = fs.statSync(f);
      s += `${st.mtimeMs}:${st.size};`;
    } catch {
      s += '-;';
    }
  }
  return s;
}

// Cost of one zcode session (every invocation and resume, verifier and
// subagents included), or null when nothing is known.
function sessionCost(record, env = process.env) {
  if (!record || !record.id) return null;
  const file = engineDbOf(record.id, env);
  const stamp = dbStamp(file);
  const hit = cache.get(file);
  if (hit && hit.stamp === stamp) return hit.cost;
  let cost = null;
  const rows = query(file, `SELECT model_id AS model, ${SUMS} FROM model_usage GROUP BY model_id`);
  if (rows && rows.length) {
    cost = fold(rows, env);
  } else if (record.usageTotal && (record.usageTotal.inputTokens || record.usageTotal.outputTokens)) {
    const u = record.usageTotal;
    cost = fold([{ model: record.model, requests: u.modelRequests || 0, input: u.inputTokens || 0, output: u.outputTokens || 0 }], env);
    cost.estimate = true; // no cache split: priced as uncached input
  }
  cache.set(file, { stamp, cost });
  return cost;
}

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

// Is `p` the directory `dir` or inside it? (symlinks resolved: /var vs /private/var)
function within(p, dir) {
  if (!p) return false;
  const rel = path.relative(real(dir), real(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// zcode sessions whose workspace is `dir` or below it, newest first, each
// {id, status, model, label, cwd, createdAt, updatedAt, cost}.
function dirSessions(dir, env = process.env) {
  const out = [];
  for (const v of store.listSessions(env)) {
    if (!within(v.cwd, dir) && !within(v.workspaceRoot, dir)) continue;
    out.push({
      id: v.id,
      status: v.state === 'finished' ? v.status || 'finished' : v.state,
      model: v.model,
      label: v.label || null,
      cwd: v.cwd,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      cost: sessionCost(v, env),
    });
  }
  return out;
}

// The desktop app's own sessions (its DB, not zcode's) whose directory is
// `dir` or below it, in the app directory every other command reads
// (ZAI_CODE_LIVE_DIR). ZCODE_APP_DB overrides the path (tests).
function appDb(env = process.env) {
  return env.ZCODE_APP_DB || path.join(liveDir(env), 'cli', 'db', 'db.sqlite');
}

function appSessions(dir, env = process.env) {
  const file = appDb(env);
  // The app stores the directory as it was opened: match the given and the
  // symlink-resolved spelling.
  const forms = [...new Set([path.resolve(dir), real(dir)])].map((d) => d.replace(/\/+$/, '') || '/');
  // LIKE wildcards in the directory name itself (my_app, 100%) are literal.
  const like = (d) => `${d === '/' ? '' : d.replace(/[\\%_]/g, '\\$&')}/%`;
  const where = forms.map(() => "(s.directory = ? OR s.directory LIKE ? ESCAPE '\\')").join(' OR ');
  const rows = query(
    file,
    `SELECT s.id AS id, s.title AS title, s.directory AS cwd, m.model_id AS model, ${SUMS},
       min(m.started_at) AS startedAt, max(coalesce(m.completed_at, m.started_at)) AS endedAt
     FROM model_usage m JOIN session s ON s.id = m.session_id
     WHERE ${where}
     GROUP BY s.id, m.model_id`,
    forms.flatMap((d) => [d, like(d)])
  );
  if (!rows) return null;
  const byId = new Map();
  for (const r of rows) {
    const e = byId.get(r.id) || { id: r.id, title: r.title, cwd: r.cwd, rows: [], startedAt: r.startedAt, endedAt: r.endedAt };
    e.rows.push(r);
    e.startedAt = Math.min(e.startedAt, r.startedAt);
    e.endedAt = Math.max(e.endedAt, r.endedAt);
    byId.set(r.id, e);
  }
  return [...byId.values()]
    .map((e) => ({
      id: e.id,
      title: e.title,
      cwd: e.cwd,
      model: e.rows.map((r) => r.model).join(','),
      createdAt: new Date(Number(e.startedAt)).toISOString(),
      updatedAt: new Date(Number(e.endedAt)).toISOString(),
      cost: fold(e.rows, env),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sumCosts(costs) {
  const t = { requests: 0, input: 0, cached: 0, cacheWrite: 0, output: 0, usd: 0 };
  for (const c of costs) {
    if (!c) continue;
    for (const k of Object.keys(t)) if (k !== 'unpriced') t[k] += c[k] || 0;
    if (c.estimate) t.estimate = true;
    // Models with no known price add nothing to usd: carried so it shows.
    if (c.unpriced && c.unpriced.length) t.unpriced = [...new Set([...(t.unpriced || []), ...c.unpriced])];
  }
  return t;
}

function formatUsd(usd) {
  if (usd === null || usd === undefined) return '$?';
  return usd < 10 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(1)}`;
}

function formatTokens(n) {
  if (n >= 999950) return `${(n / 1e6).toFixed(1)}M`; // 999,950 would print "1000.0k"
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

module.exports = {
  priceOf,
  sessionCost,
  dirSessions,
  appSessions,
  sumCosts,
  formatUsd,
  formatTokens,
  engineDbOf,
  query,
};

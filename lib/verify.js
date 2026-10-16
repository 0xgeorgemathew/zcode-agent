'use strict';
// The independent visual verifier (v0.6). The implementer never decides
// `visual`: after its turn zcode opens a fresh engine session on an
// image-capable model that did not build the result, has it screenshot the
// running app and LOOK at the pixels, and parses its `zcode-visual` block.
// This file is the prompt and the (lenient) parser; the orchestration is in
// lib/executor.js.
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_VIEWPORTS } = require('./contract.js');

// The Playwright MCP browser profile lives in the session's engine home and
// outlives every engine session, so a verifier round would otherwise judge the
// HTTP cache and the storage the implementer (or the previous round) left:
// a live round passed a stale pre-fix page (http-server max-age 3600). Wiped
// before each round; the browser is not running then (each round is a new
// client). Errors are ignored.
const PROFILE_STATE = ['Cache', 'Code Cache', 'Service Worker', 'Local Storage', 'Session Storage', 'IndexedDB'];
function resetBrowserState(home) {
  const root = path.join(home, 'Library', 'Caches', 'ms-playwright-mcp');
  let profiles = [];
  try {
    profiles = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const p of profiles) {
    for (const d of PROFILE_STATE) {
      try {
        fs.rmSync(path.join(root, p, 'Default', d), { recursive: true, force: true });
      } catch {
        /* ignored */
      }
    }
  }
}

// Always judged in addition to the declared criteria.
const BUILTIN_CRITERION =
  'All text the page means to show is readable after animations finish: not clipped, hidden, transparent, off-screen or overlapped.';

const bullets = (items) => items.map((i) => `- ${i}`).join('\n');

const clip = (text, max) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
};

const WAIT_SCRIPT =
  'await document.fonts.ready; await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))';

// contract: the task contract; session: {id, port, out, tmp}; round: 1-based.
function buildVerifierPrompt(contract, { session, round = 1 }) {
  const viewports = contract.viewports && contract.viewports.length ? contract.viewports : DEFAULT_VIEWPORTS;
  const dir = `${session.out}/verify/${round}`;
  return [
    'You are an independent visual verifier. You did not build this and have not seen it. Assume it is broken until the pixels prove otherwise. DOM or text presence is NOT evidence: only what you can see in a screenshot counts.',
    '',
    `## What was built\n${clip(contract.objective, 500)}`,
    '',
    '## Criteria',
    bullets([...contract.visual, BUILTIN_CRITERION]),
    '',
    '## How (be fast: few, batched tool calls)',
    '- Use only Bash and the Playwright MCP tools. Do not load skills or other browser tools; everything you need is here.',
    contract.serve
      ? `- Serve the app with \`${contract.serve}\` on $ZCODE_PORT=${session.port} in the background (build first if it needs one; put build output under $ZCODE_OUT=${session.out}, not in the workspace).`
      : `- Serve the app on $ZCODE_PORT=${session.port} in the background (pick the dev/preview command from package.json, build first if needed; put build output under $ZCODE_OUT=${session.out}, not in the workspace).`,
    `- Capture EVERYTHING in ONE Playwright run-code call (browser_run_code_unsafe or browser_run_code), not one tool call per step. The script first disables the HTTP cache (\`const cdp = await page.context().newCDPSession(page); await cdp.send('Network.setCacheDisabled', {cacheDisabled: true})\`), then for each viewport (${viewports.join(', ')}): set the viewport, goto the page, \`${WAIT_SCRIPT}\` (race it against an 8 s timer), wait 500 ms; then scroll down one window height at a time (at most 12 steps), waiting 400 ms and the same animation wait at each, saving a viewport screenshot per step to ${dir}/<viewport>-<n>.png (n from 1 at the top); also drive every state a criterion names (open a dialog, fill a step, …) and save ${dir}/<viewport>-<state>.png. Return the list of paths.`,
    '- Then LOOK at the images: read every PNG in ONE batch of parallel Read calls. Judge every criterion at every viewport. For each verdict QUOTE the text you can actually read in the relevant region (`seen`); if you read none, say so.',
    '- Only when a region is genuinely unclear, take a targeted extra screenshot (an element or a clip) and read it; do not re-capture everything.',
    `- Make NO edits: write only files under ${session.out}. Stop any server you started.`,
    '',
    '## Reply',
    'End with exactly one fenced block, a JSON array with one entry per criterion per viewport:',
    '```zcode-visual',
    '[{"criterion": "text of the criterion", "viewport": "1440x900", "met": true, "seen": "text you read there", "note": "what is wrong, if anything", "shot": "path of the screenshot"}]',
    '```',
  ].join('\n');
}

const BLOCK_RE = /```zcode-visual[^\n]*\n([\s\S]*?)```/g;

function normMet(v) {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', 'yes', 'met', 'pass'].includes(t)) return true;
    if (['false', 'no', 'unmet', 'not met', 'fail'].includes(t)) return false;
  }
  return null;
}

// {entries: [{criterion, viewport?, met: true|false|null, seen, note, shot}],
// error}. The LAST block wins; an unparsable or empty block is an error.
function parseVisualBlock(text) {
  const matches = [...String(text || '').matchAll(BLOCK_RE)];
  if (!matches.length) return { entries: [], error: 'no zcode-visual block' };
  let raw;
  try {
    raw = JSON.parse(matches[matches.length - 1][1]);
  } catch (err) {
    return { entries: [], error: `invalid JSON: ${err.message}` };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    raw = Array.isArray(raw.visual) ? raw.visual : Array.isArray(raw.entries) ? raw.entries : [raw];
  }
  if (!Array.isArray(raw)) return { entries: [], error: 'not a JSON array' };
  const entries = raw
    .filter((e) => e && typeof e === 'object' && !Array.isArray(e) && e.criterion !== undefined)
    .map((e) => ({
      criterion: String(e.criterion),
      ...(e.viewport ? { viewport: String(e.viewport) } : {}),
      met: normMet(e.met),
      seen: e.seen === undefined || e.seen === null ? '' : String(e.seen),
      note: e.note === undefined || e.note === null ? '' : String(e.note),
      ...(e.shot ? { shot: String(e.shot) } : {}),
    }));
  return entries.length ? { entries, error: null } : { entries: [], error: 'no usable entries' };
}

// Entries for criteria that could not be judged: met:null, never met:false
// (a verifier failure is not the implementer's fault).
function notVerified(criteria, why) {
  return criteria.map((criterion) => ({ criterion, met: null, seen: '', note: `not verified: ${why}` }));
}

module.exports = { buildVerifierPrompt, parseVisualBlock, notVerified, resetBrowserState, BUILTIN_CRITERION };

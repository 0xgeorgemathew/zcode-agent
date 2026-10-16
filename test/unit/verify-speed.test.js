'use strict';
// 0.7 verifier: batched capture, cache-disabled browser, browser state wiped
// between rounds (a live round judged a stale cached page).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildVerifierPrompt, resetBrowserState } = require('../../lib/verify.js');

test('verifier prompt asks for one capture script, a disabled cache and one read batch', () => {
  const p = buildVerifierPrompt(
    { objective: 'O', visual: ['h1 readable'], viewports: ['1440x900'] },
    { session: { id: 's', port: 41001, out: '/w/.zcode/out/s', tmp: '/t' }, round: 2 }
  );
  assert.match(p, /ONE Playwright run-code call/);
  assert.match(p, /Do not load skills/);
  assert.match(p, /Network\.setCacheDisabled/);
  assert.match(p, /ONE batch of parallel Read calls/);
  assert.match(p, /\/w\/\.zcode\/out\/s\/verify\/2\/<viewport>-<n>\.png/);
});

test('resetBrowserState wipes cache and storage of the MCP browser profile, keeps the rest', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-rbs-'));
  const def = path.join(home, 'Library', 'Caches', 'ms-playwright-mcp', 'mcp-chrome-1', 'Default');
  for (const d of ['Cache', 'Code Cache', 'Local Storage', 'Preferences-dir']) {
    fs.mkdirSync(path.join(def, d), { recursive: true });
    fs.writeFileSync(path.join(def, d, 'x'), 'x');
  }
  resetBrowserState(home);
  assert.equal(fs.existsSync(path.join(def, 'Cache')), false);
  assert.equal(fs.existsSync(path.join(def, 'Code Cache')), false);
  assert.equal(fs.existsSync(path.join(def, 'Local Storage')), false);
  assert.equal(fs.existsSync(path.join(def, 'Preferences-dir', 'x')), true);
  resetBrowserState(path.join(home, 'missing')); // no profile: no throw
  fs.rmSync(home, { recursive: true, force: true });
});

test('a runaway verifier request is ended and retried; still runaway gives met:null with the reason', async () => {
  const { setupFake, handback, invocation } = require('../helpers/fake.js');
  const { execute } = require('../../lib/executor.js');
  const fake = setupFake();
  process.env.ZCODE_VERIFIER_MAX_STREAM_CHARS = '5';
  try {
    const vblock = '```zcode-visual\n[{"criterion":"CTA visible","viewport":"390x844","met":true,"seen":"Buy"}]\n```';
    fake.setScript({ turns: [{ response: handback({ status: 'done', summary: 'ok' }) }, { response: vblock }, { response: vblock }] });
    const r = await execute(invocation(fake, { id: 'ra-1', contract: { visual: ['CTA visible'], checks: ['true'] } }));
    assert.equal(r.status, 'partial');
    assert.equal(r.visual[0].met, null);
    assert.match(r.visual[0].note, /ran away \(over 5 chars streamed without a tool call\)/);
  } finally {
    delete process.env.ZCODE_VERIFIER_MAX_STREAM_CHARS;
    fake.cleanup();
  }
});

'use strict';
// 0.7 verifier: batched capture to the bottom of the page; 0.7.1: the browser
// runs --isolated (fresh profile per engine: no stale cache, no profile lock).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildVerifierPrompt } = require('../../lib/verify.js');
const { effectiveMcpServers } = require('../../lib/isolation.js');

test('verifier prompt asks for one capture script to the bottom of the page and one read batch', () => {
  const p = buildVerifierPrompt(
    { objective: 'O', visual: ['h1 readable'], viewports: ['1440x900'] },
    { session: { id: 's', port: 41001, out: '/w/.zcode/out/s', tmp: '/t' }, round: 2 }
  );
  assert.match(p, /ONE Playwright run-code call/);
  assert.match(p, /Do not load skills/);
  assert.match(p, /to the bottom of the page/);
  assert.doesNotMatch(p, /at most \d+ steps/);
  assert.match(p, /ONE batch of parallel Read calls/);
  assert.match(p, /\/w\/\.zcode\/out\/s\/verify\/2\/<viewport>-<n>\.png/);
});

test('the inherited Playwright MCP runs --isolated; a def that picks its profile is kept', () => {
  const live = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-iso-'));
  const write = (pw) => {
    fs.mkdirSync(path.join(live, 'cli'), { recursive: true });
    fs.writeFileSync(path.join(live, 'cli', 'config.json'), JSON.stringify({ mcp: { servers: { playwright: pw } } }));
  };
  write({ type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'] });
  assert.deepEqual(effectiveMcpServers({ live }).playwright.args, ['@playwright/mcp@latest', '--isolated']);
  write({ type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--user-data-dir=/x'] });
  assert.deepEqual(effectiveMcpServers({ live }).playwright.args, ['@playwright/mcp@latest', '--user-data-dir=/x']);
  write({ type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--isolated'] });
  assert.deepEqual(effectiveMcpServers({ live }).playwright.args, ['@playwright/mcp@latest', '--isolated']);
  fs.rmSync(live, { recursive: true, force: true });
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

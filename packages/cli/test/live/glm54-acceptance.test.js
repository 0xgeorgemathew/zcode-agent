'use strict';
// LIVE — GLM-5.4, the default model (1.4). No engine release lists it yet,
// so every session registers it in its own provider config (models.js
// ADDED_MODELS): these runs are the proof the real engine accepts that, with
// the ZCode app's config and without one, that a resumed session stays on
// it, and that it really reads images. Model evidence is engine-side
// (model_request_started), not the wrapper's echo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { cli, checkEngine, loadEnvKey } = require('../helpers/env.js');
const { numberPng } = require('../helpers/png.js');

function preconditions() {
  assert.ok(checkEngine().engineOk, 'engine bundle must exist for the live test');
  assert.ok(loadEnvKey(), 'test API key must be loadable from .env');
}

// One retry on a wrong answer, a turn failure or a timeout (the API is busy
// on a launch day), never on config errors (exit 2/3/4).
async function turn(args, { work, env, accept, timeoutMs = 300000 }) {
  let why = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { code, stdout, stderr } = await cli(['--json', '--full', '--cwd', work, ...args], { cwd: work, env, timeoutMs })
      .catch((err) => ({ code: -1, stdout: '', stderr: String(err.message) }));
    if (code === 2 || code === 3 || code === 4) assert.fail(`config error exit ${code}: ${stderr.trim()}`);
    let events = [];
    try {
      events = stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch {
      /* judged below */
    }
    const result = events[events.length - 1];
    if (code === 0 && result && result.type === 'result' && result.ok && accept(result)) return { result, events };
    why = `exit ${code}: ${stderr.trim().slice(0, 300)} | ${JSON.stringify(result ?? null).slice(0, 300)}`;
    if (attempt === 1) console.log(`[retry] ${why}`);
  }
  return assert.fail(`second attempt failed: ${why}`);
}

function assertOnTheWire({ result, events }) {
  assert.equal(result.model, 'GLM-5.4');
  assert.equal(result.modelRequested, 'GLM-5.4');
  const started = events.filter((e) => e.type === 'model_request_started');
  assert.ok(started.length >= 1, 'engine reported the model request');
  for (const e of started) {
    assert.equal(e.modelId, 'GLM-5.4', 'engine-reported model is GLM-5.4');
    assert.equal(e.providerId, 'zai-api');
  }
}

test('LIVE glm-5.4 is the default: no --model, on the wire, and a resumed session stays on it', async () => {
  preconditions();
  const work = mkdtempSync(path.join(tmpdir(), 'zcode-glm54-'));
  try {
    const first = await turn(['Remember the secret word MANGO. Reply with exactly: OK'], {
      work,
      accept: (r) => (r.response || '').trim() === 'OK',
    });
    assertOnTheWire(first);
    assert.equal(first.result.effort, 'high', 'the default effort');
    const second = await turn(['--session', first.result.sessionId, 'Reply with only the secret word I told you earlier.'], {
      work,
      accept: (r) => /MANGO/.test(r.response || ''),
    });
    assertOnTheWire(second);
    assert.equal(second.result.resumed, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('LIVE glm-5.4 standalone: without the ZCode app the synthesized config registers it too', async () => {
  preconditions();
  const work = mkdtempSync(path.join(tmpdir(), 'zcode-glm54-solo-'));
  const noApp = mkdtempSync(path.join(tmpdir(), 'zcode-noapp-'));
  try {
    const run = await turn(['--no-browser', 'Reply with exactly the word OK and nothing else.'], {
      work,
      env: { ZAI_CODE_LIVE_DIR: noApp },
      accept: (r) => (r.response || '').trim() === 'OK',
    });
    assertOnTheWire(run);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(noApp, { recursive: true, force: true });
  }
});

test('LIVE glm-5.4 reads an image: the number in a PNG comes back', async () => {
  preconditions();
  const work = mkdtempSync(path.join(tmpdir(), 'zcode-glm54-img-'));
  try {
    const number = String(1000 + Math.floor(Math.random() * 9000));
    writeFileSync(path.join(work, 'number.png'), numberPng(number));
    const run = await turn(['--no-browser', 'Open number.png in this directory with your Read tool. Reply with only the number written in it.'], {
      work,
      accept: (r) => (r.response || '').includes(number),
    });
    assertOnTheWire(run);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

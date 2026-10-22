'use strict';
// Every command defaults to GLM-5.3 at effort high; --model / --effort override.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgv } = require('../../bin/zcode-agent.js');

test('default model is GLM-5.3 at effort high for run, task and agent', () => {
  for (const cmd of ['run', 'task', 'agent']) {
    const { flags } = parseArgv([cmd, 'x']);
    assert.equal(flags.model, 'GLM-5.3', cmd);
    assert.equal(flags.effort, 'high', cmd);
  }
});

test('--model and --effort override the defaults', () => {
  const { flags } = parseArgv(['task', '--model', 'flash', '--effort', 'low', 'x']);
  assert.equal(flags.model, 'GLM-5.3-Flash');
  assert.equal(flags.effort, 'low');
});

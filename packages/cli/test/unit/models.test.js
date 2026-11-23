'use strict';
// Effort validation before any engine spawn: levels come from the engine's
// builtin provider config (fallback table when unreadable), unsupported
// model+effort pairs exit 2 with one line, and doctor lists the levels.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cli } = require('../helpers/env.js');
const { setupFake, handback } = require('../helpers/fake.js');
const { supportedEfforts, modelLevels, effortProblem } = require('../../lib/models.js');

let fake;
beforeEach(() => {
  fake = setupFake({ turns: [{ response: handback({ status: 'done', summary: 's' }) }] });
});
afterEach(() => fake.cleanup());

const MATCH = '.*glm-5\\.3(?:-flash)?(?:[.\\-:/\\[].*)?';
function builtin(name, rules) {
  const file = path.join(fake.base, name);
  fs.writeFileSync(file, JSON.stringify({ config: { modelConfigRules: { modelRules: rules } } }));
  return file;
}

test('levels are read from the builtin provider config; the last matching rule with values wins', () => {
  const file = builtin('b1.json', [
    { modelMatch: '.*glm-5(?:[.\\-:/\\[].*)?', config: { optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'] } } } },
    { modelMatch: MATCH, config: { optionSpecs: { reasoningLevel: { values: ['low', 'medium', 'max'] } } } },
    { modelMatch: '.*other.*', config: { optionSpecs: { reasoningLevel: { values: ['high'] } } } },
  ]);
  assert.deepEqual(supportedEfforts('GLM-5.3', { builtinConfig: file }), ['low', 'medium', 'max']);
  assert.deepEqual(supportedEfforts('GLM-5.3-Flash', { builtinConfig: file }), ['low', 'medium', 'max']);
  assert.equal(effortProblem('GLM-5.3', 'high', { builtinConfig: file }), '--effort high is not supported by GLM-5.3 (supported: low, medium, max).');
  assert.equal(effortProblem('GLM-5.3', 'medium', { builtinConfig: file }), null);
});

test('unreadable or non-matching config falls back to the built-in table', () => {
  assert.deepEqual(supportedEfforts('GLM-5.3', { builtinConfig: path.join(fake.base, 'missing.json') }), ['low', 'high', 'max']);
  const noMatch = builtin('b2.json', [{ modelMatch: '.*other.*', config: { optionSpecs: { reasoningLevel: { values: ['low'] } } } }]);
  assert.deepEqual(supportedEfforts('GLM-5.3-Flash', { builtinConfig: noMatch }), ['low', 'high', 'max']);
  assert.deepEqual(modelLevels({ builtinConfig: noMatch }), { 'GLM-5.4': ['low', 'high', 'max'], 'GLM-5.3': ['low', 'high', 'max'], 'GLM-5.3-Flash': ['low', 'high', 'max'] });
});

// The bundled engine's own config (after `npm run build:engine`), else the
// macOS app's: whichever real one this machine has.
const REAL_BUILTIN = [
  (() => {
    try {
      return require('@zcode-agent/engine').builtinProviderConfig;
    } catch {
      return null;
    }
  })(),
  '/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json',
].find((f) => f && fs.existsSync(f));

test('a real ZCode builtin config gives GLM-5.3 and Flash low|high|max, and what GLM-5.4 needs when it is not listed', { skip: !REAL_BUILTIN && 'no engine built and no ZCode app' }, () => {
  assert.deepEqual(supportedEfforts('GLM-5.3', { builtinConfig: REAL_BUILTIN }), ['low', 'high', 'max']);
  assert.deepEqual(supportedEfforts('GLM-5.3-Flash', { builtinConfig: REAL_BUILTIN }), ['low', 'high', 'max']);
  const { supportsImage, visionModel, addedModelRegistration } = require('../../lib/models.js');
  assert.equal(supportsImage('GLM-5.3', { builtinConfig: REAL_BUILTIN }), false);
  assert.equal(supportsImage('GLM-5.3-Flash', { builtinConfig: REAL_BUILTIN }), true);
  assert.equal(visionModel({ builtinConfig: REAL_BUILTIN }), 'GLM-5.3-Flash', 'the verifier stays on Flash');
  // Registered only while the engine does not list it: its own rules win after that.
  const listed = JSON.parse(fs.readFileSync(REAL_BUILTIN, 'utf8')).config.providerConfigRules.templateRules
    .find((t) => t.templateId === 'zai-api').config.builtinModelIds.includes('GLM-5.4');
  assert.deepEqual(addedModelRegistration(REAL_BUILTIN).ids, listed ? [] : ['GLM-5.4']);
  if (!listed) {
    assert.deepEqual(supportedEfforts('GLM-5.4', { builtinConfig: REAL_BUILTIN }), ['low', 'high', 'max']);
    assert.equal(supportsImage('GLM-5.4', { builtinConfig: REAL_BUILTIN }), true, 'not the generic glm-5 rule (text only)');
  }
});

const run = (args, opts) => cli(args, { cwd: fake.work, timeoutMs: 60000, ...opts });

test('--effort medium is refused with exit 2 and one line, before any engine spawn', async () => {
  const r = await run(['task', '--effort', 'medium', '--id', 'e-1', 'Do it']);
  assert.equal(r.code, 2);
  assert.equal(r.stderr, 'zcode-agent: --effort medium is not supported by GLM-5.4 (supported: low, high, max).\n');
  assert.deepEqual(fake.log(), [], 'the engine was never spawned');
  assert.equal(require('../../lib/store.js').readSession('e-1'), null, 'no session record either');

  const r53 = await run(['run', '--model', 'flash', '--effort', 'xhigh', 'hi']);
  assert.equal(r53.code, 2);
  assert.match(r53.stderr, /--effort xhigh is not supported by GLM-5\.3-Flash \(supported: low, high, max\)/);
  assert.deepEqual(fake.log(), []);
});

test('contract effort is validated too (JSON contract, with and without a --model override)', async () => {
  const file = path.join(fake.base, 'c.json');
  fs.writeFileSync(file, JSON.stringify({ objective: 'x', effort: 'medium' }));
  const r = await run(['task', '--task', file]);
  assert.equal(r.code, 2);
  assert.equal(r.stderr, 'zcode-agent: contract effort medium is not supported by GLM-5.4 (supported: low, high, max).\n');

  fs.writeFileSync(file, JSON.stringify({ objective: 'x', model: 'flash', effort: 'xhigh' }));
  const r2 = await run(['task', '--task', file]);
  assert.equal(r2.code, 2);
  assert.match(r2.stderr, /contract effort xhigh is not supported by GLM-5\.3-Flash /);
  assert.deepEqual(fake.log(), []);

  // A flag overrides the contract's effort and is itself what gets validated.
  const ok = await run(['task', '--task', file, '--effort', 'high', '--json', '--quiet']);
  assert.notEqual(ok.code, 2, ok.stderr);
});

test('supported efforts still run; doctor --json lists models: {id: [levels]}', async () => {
  const ok = await run(['task', '--effort', 'high', '--quiet', '--json', 'Do it']);
  assert.notEqual(ok.code, 2, ok.stderr);
  assert.ok(fake.log().length > 0, 'the engine was spawned');

  const d = await run(['doctor', '--json']);
  assert.equal(d.code, 0, d.stderr);
  assert.deepEqual(JSON.parse(d.stdout).models, { 'GLM-5.4': ['low', 'high', 'max'], 'GLM-5.3': ['low', 'high', 'max'], 'GLM-5.3-Flash': ['low', 'high', 'max'] });
});

test('GLM-5.4: aliases, and the engine-unknown model takes its levels and vision from zcode-agent until the engine lists it', () => {
  const { normalizeModel, supportsImage, addedModelRegistration } = require('../../lib/models.js');
  for (const a of ['GLM-5.4', 'glm-5.4', '5.4', '54']) assert.equal(normalizeModel(a), 'GLM-5.4', a);
  // An engine config that predates GLM-5.4: only the generic glm-5 rule (text only, disabled|enabled) matches it.
  const old = path.join(fake.base, 'old.json');
  fs.writeFileSync(old, JSON.stringify({ config: {
    providerConfigRules: { templateRules: [{ templateId: 'zai-api', config: { builtinModelIds: ['GLM-5.3', 'GLM-5.3-Flash'] } }] },
    modelConfigRules: { modelRules: [{ modelMatch: '.*glm-5(?:[.\\-:/\\[].*)?', config: { properties: { inputFormat: { supportsImage: false } }, optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'] } } } }] },
  } }));
  assert.deepEqual(supportedEfforts('GLM-5.4', { builtinConfig: old }), ['low', 'high', 'max']);
  assert.equal(supportsImage('GLM-5.4', { builtinConfig: old }), true);
  const reg = addedModelRegistration(old);
  assert.deepEqual(reg.ids, ['GLM-5.4']);
  assert.equal(reg.rules[0].providerId, 'zai-api');
  assert.equal(reg.rules[0].config.enabled, true);
  assert.deepEqual(reg.rules[0].config.optionSpecs.reasoningLevel.values, ['low', 'high', 'max']);
  assert.match(reg.rules[0].config.optionSpecs.reasoningLevel.map, /"effort": reasoningLevel/);
  // An engine whose zai-api template lists GLM-5.4 itself: its own rules decide, nothing is registered.
  const fresh = path.join(fake.base, 'fresh.json');
  fs.writeFileSync(fresh, JSON.stringify({ config: {
    providerConfigRules: { templateRules: [{ templateId: 'zai-api', config: { builtinModelIds: ['GLM-5.4', 'GLM-5.3'] } }] },
    modelConfigRules: { modelRules: [{ modelMatch: '.*glm-5\\.4.*', config: { properties: { inputFormat: { supportsImage: true } }, optionSpecs: { reasoningLevel: { values: ['low', 'medium', 'high', 'max'] } } } }] },
  } }));
  assert.deepEqual(supportedEfforts('GLM-5.4', { builtinConfig: fresh }), ['low', 'medium', 'high', 'max']);
  assert.deepEqual(addedModelRegistration(fresh), { ids: [], rules: [] });
});

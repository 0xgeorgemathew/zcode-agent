'use strict';
// The ONLY place model ids are chosen (DESIGN §7). The wrapper constructs
// every engine request itself, so nothing outside this allowlist can reach
// the wire.

const fs = require('node:fs');

const DEFAULT_MODEL = 'GLM-5.4';
const DEFAULT_EFFORT = 'high';

// Case-insensitive aliases → official ids (exact ids pass through verbatim;
// they are exactly "GLM-5.4" / "GLM-5.3" / "GLM-5.3-Flash").
const ALIASES = new Map([
  ['glm-5.4', 'GLM-5.4'],
  ['5.4', 'GLM-5.4'],
  ['54', 'GLM-5.4'],
  ['glm-5.3', 'GLM-5.3'],
  ['5.3', 'GLM-5.3'],
  ['53', 'GLM-5.3'],
  ['glm-5.3-flash', 'GLM-5.3-Flash'],
  ['5.3-flash', 'GLM-5.3-Flash'],
  ['flash', 'GLM-5.3-Flash'],
  ['53f', 'GLM-5.3-Flash'],
]);

const SUPPORTED = ['glm-5.4', 'glm-5.3', 'glm-5.3-flash'];

// Effort enum per the bundle's schema (DESIGN §8). `high` is the default;
// `low|high|max` are the levels every supported model accepts.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

function normalizeEffort(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  return EFFORT_LEVELS.includes(raw) ? raw : null;
}

// Returns the official model id, or null when input is not allowed.
function normalizeModel(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  return ALIASES.get(raw.toLowerCase()) ?? null;
}

function unknownModelMessage(input) {
  return (
    `unknown model "${input}". zcode-agent supports only ` +
    `${SUPPORTED.join(', ')} (official ids: ${OFFICIAL_IDS.join(', ')}).`
  );
}

// --- models the engine does not know yet -------------------------------------
//
// GLM-5.4 (2026-11-23) is newer than every ZCode release's builtin provider
// config: the zai-api template's builtinModelIds stop at GLM-5.3 /
// GLM-5.3-Flash, so the engine would refuse it ("Provider Registry 中不存在
// Model"). zcode-agent registers it in each session's own provider config the
// way the app registers a model a user adds by hand: the id in the zai-api
// rule's personalModelIds plus a providerModelRules entry giving the config
// the engine needs to call it (window, image input, reasoning levels and the
// Anthropic-API mapping of a level, copied from the glm-5.3 rules). Once an
// engine's template lists the id itself, its builtin rules are used instead.
const REASONING_MAP = '{\n  "thinking": {\n    "type": "enabled"\n  },\n  "output_config": {\n    "effort": reasoningLevel\n  }\n}';
const ADDED_MODELS = {
  'GLM-5.4': { contextWindow: 1000000, supportsImage: true, levels: ['low', 'high', 'max'], maxOutputTokens: 128000 },
};

// --- supported effort levels per model ---------------------------------------
//
// The engine rejects an unsupported reasoning level only after it has been
// spawned and a session opened (GLM-5.3 refused `medium` that way in a real
// run). The levels live in the engine's builtin provider config
// (config/provider/zcode-builtin.json, the path `zcode doctor` reports):
// modelConfigRules.modelRules[] = {modelMatch: <regex>, config:
// {optionSpecs: {reasoningLevel: {values: […]}}}}. Later rules refine
// earlier ones (a generic `glm-5` rule lists disabled/enabled; the
// `glm-5.3(-flash)?` rule after it lists low/high/max), so the LAST matching
// rule that lists values wins. Unreadable or unmatched → the table below
// (observed in zcode-builtin.json shipped with ZCode 0.16.x).
const FALLBACK_LEVELS = {
  'GLM-5.4': ADDED_MODELS['GLM-5.4'].levels,
  'GLM-5.3': ['low', 'high', 'max'],
  'GLM-5.3-Flash': ['low', 'high', 'max'],
};
const OFFICIAL_IDS = Object.keys(FALLBACK_LEVELS);

const configCache = new Map(); // path → {stamp, rules, zaiModelIds}

// {rules: modelRules[], zaiModelIds: the zai-api template's builtinModelIds}
// of a builtin provider config; empty when unreadable.
function readBuiltin(file) {
  try {
    const st = fs.statSync(file);
    const stamp = `${st.mtimeMs}:${st.size}`;
    const hit = configCache.get(file);
    if (hit && hit.stamp === stamp) return hit;
    const config = (JSON.parse(fs.readFileSync(file, 'utf8')) || {}).config || {};
    const rules = config.modelConfigRules && config.modelConfigRules.modelRules;
    const templates = config.providerConfigRules && config.providerConfigRules.templateRules;
    const zai = Array.isArray(templates) && templates.find((t) => t && t.templateId === 'zai-api');
    const ids = zai && zai.config && zai.config.builtinModelIds;
    const entry = { stamp, rules: Array.isArray(rules) ? rules : [], zaiModelIds: Array.isArray(ids) ? ids : [] };
    configCache.set(file, entry);
    return entry;
  } catch {
    return { rules: [], zaiModelIds: [] };
  }
}

const readRules = (file) => readBuiltin(file).rules;

// The ADDED_MODELS entry zcode-agent registers for `model`, or null when the
// model is not one of them or the engine's own config already lists it.
function addedModel(model, file) {
  const added = ADDED_MODELS[model];
  if (!added) return null;
  return file && readBuiltin(file).zaiModelIds.includes(model) ? null : added;
}

// What buildEngineHome adds to a session's provider config: the ids for the
// zai-api rule's personalModelIds and their providerModelRules entries.
function addedModelRegistration(builtinConfig) {
  const ids = Object.keys(ADDED_MODELS).filter((id) => addedModel(id, builtinConfig));
  const rules = ids.map((modelId) => {
    const m = ADDED_MODELS[modelId];
    return {
      providerId: 'zai-api',
      modelId,
      config: {
        enabled: true,
        properties: { contextWindow: m.contextWindow, inputFormat: { supportsImage: m.supportsImage } },
        optionSpecs: {
          reasoningLevel: { values: [...m.levels], map: REASONING_MAP },
          maxOutputTokens: { max: m.maxOutputTokens },
        },
      },
    };
  });
  return { ids, rules };
}

function builtinConfigPath(env) {
  try {
    const { resolveEngine, resolveBuiltinProviderConfig } = require('./engine.js');
    return resolveBuiltinProviderConfig(resolveEngine(env), env);
  } catch {
    return null;
  }
}

// Efforts (a subset of EFFORT_LEVELS, in enum order) the model accepts.
function supportedEfforts(model, { env = process.env, builtinConfig } = {}) {
  const file = builtinConfig || builtinConfigPath(env);
  const added = addedModel(model, file);
  if (added) return [...added.levels];
  let values = null;
  if (file) {
    for (const rule of readRules(file)) {
      let match = false;
      try {
        match = new RegExp(`^(?:${rule.modelMatch})$`, 'i').test(model);
      } catch {
        /* a malformed pattern matches nothing */
      }
      const v = match && rule.config && rule.config.optionSpecs && rule.config.optionSpecs.reasoningLevel
        && rule.config.optionSpecs.reasoningLevel.values;
      if (Array.isArray(v)) values = v;
    }
  }
  const levels = values ? EFFORT_LEVELS.filter((l) => values.includes(l)) : [];
  return levels.length ? levels : FALLBACK_LEVELS[model] || [];
}

// {modelId: [levels]} for every supported model (doctor).
function modelLevels(opts) {
  return Object.fromEntries(OFFICIAL_IDS.map((id) => [id, supportedEfforts(id, opts)]));
}

// --- image input per model ---------------------------------------------------
//
// Same resolution as reasoning levels: modelRules[].config.properties
// .inputFormat.supportsImage, last matching rule that sets it wins (the
// generic `glm-5.3(-flash)?` rule says false, the later `glm-5.3-flash` rule
// true). GLM-5.3 cannot see images: reading a PNG returns only an upload
// confirmation, so it must never be the judge of a screenshot. GLM-5.4 sees
// images (Z.ai, 2026-11-23); until an engine lists it, its ADDED_MODELS entry
// decides, since only the generic glm-5 rule (text only) would match it.
const FALLBACK_IMAGES = { 'GLM-5.4': true, 'GLM-5.3': false, 'GLM-5.3-Flash': true };

function supportsImage(model, { env = process.env, builtinConfig } = {}) {
  const file = builtinConfig || builtinConfigPath(env);
  const added = addedModel(model, file);
  if (added) return added.supportsImage;
  let value = null;
  if (file) {
    for (const rule of readRules(file)) {
      let match = false;
      try {
        match = new RegExp(`^(?:${rule.modelMatch})$`, 'i').test(model);
      } catch {
        /* a malformed pattern matches nothing */
      }
      if (!match) continue;
      const v = rule.config && rule.config.properties && rule.config.properties.inputFormat
        && rule.config.properties.inputFormat.supportsImage;
      if (typeof v === 'boolean') value = v;
    }
  }
  return value === null ? FALLBACK_IMAGES[model] === true : value;
}

// {modelId: bool} for every supported model (doctor).
function modelVision(opts) {
  return Object.fromEntries(OFFICIAL_IDS.map((id) => [id, supportsImage(id, opts)]));
}

// The model that judges screenshots for the visual verifier: GLM-5.3-Flash,
// the cheapest image-capable model (the verifier only looks and reports),
// else the first image-capable one.
const VERIFIER_PREFERENCE = ['GLM-5.3-Flash', ...OFFICIAL_IDS.filter((id) => id !== 'GLM-5.3-Flash')];
function visionModel(opts) {
  return VERIFIER_PREFERENCE.find((id) => supportsImage(id, opts)) || DEFAULT_MODEL;
}

// Context window by model for display (ACP usage): the engine's own value
// when it reports one wins over this.
const CONTEXT_WINDOWS = { 'GLM-5.4': ADDED_MODELS['GLM-5.4'].contextWindow, 'GLM-5.3': 1000000, 'GLM-5.3-Flash': 200000 };

// null when `effort` is usable with `model`, else the one-line refusal.
// `source` names where the value came from ("--effort", "contract effort").
function effortProblem(model, effort, { source = '--effort', ...opts } = {}) {
  const levels = supportedEfforts(model, opts);
  if (levels.includes(effort)) return null;
  return `${source} ${effort} is not supported by ${model} (supported: ${levels.join(', ')}).`;
}

module.exports = {
  addedModelRegistration,
  CONTEXT_WINDOWS,
  OFFICIAL_IDS,
  supportsImage,
  modelVision,
  visionModel,
  supportedEfforts,
  modelLevels,
  effortProblem,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  normalizeModel,
  unknownModelMessage,
  normalizeEffort,
  EFFORT_LEVELS,
};

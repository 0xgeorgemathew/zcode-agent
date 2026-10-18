'use strict';
// Paths into the bundled headless ZCode engine. Built by
// scripts/build-engine.mjs from the zai-org/ZCode tag in engine.json; the
// layout is the engine's own (dist/zcode.cjs finds dist/provider/ and
// dist/packages/ next to itself).
const path = require('node:path');
const { engineVersion, tag } = require('./engine.json');

const dist = path.join(__dirname, 'dist');

module.exports = {
  enginePath: path.join(dist, 'zcode.cjs'),
  builtinProviderConfig: path.join(dist, 'provider', 'zcode-builtin.json'),
  version: engineVersion,
  upstreamTag: tag,
};

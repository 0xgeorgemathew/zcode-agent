'use strict';
// lib/commands/acp.js — `zcode-agent acp`: serve the Agent Client Protocol
// on stdio (lib/acp.js) until the client closes stdin. Flags set the
// defaults of every session; clients change mode, model and effort per
// session through ACP config options.
const { serve } = require('../acp.js');
const { MODE_IDS } = require('../acp-map.js');

module.exports = function acpCommand(parsed) {
  const { flags, given } = parsed;
  if (parsed.prompts.length) {
    process.stderr.write(`zcode-agent: acp takes no arguments (got "${parsed.prompts.join(' ')}"); it speaks ACP on stdio.\n`);
    process.exit(2);
  }
  const mode = flags.mode || process.env.ZCODE_ACP_MODE || 'build';
  if (!MODE_IDS.includes(mode)) {
    process.stderr.write(`zcode-agent: unknown mode "${mode}". --mode accepts ${MODE_IDS.join(' | ')}.\n`);
    process.exit(2);
  }
  serve({
    version: require('../../package.json').version,
    defaults: {
      model: flags.model,
      effort: flags.effort,
      mode,
      mcpSpecs: flags.mcpSpecs,
      hermetic: flags.hermetic,
      browser: !flags.noBrowser,
      skillsDirs: flags.skillsDirs.map((d) => require('node:path').resolve(d)),
      noSkills: flags.noSkills,
      inheritDesktop: flags.inheritDesktop,
      timeoutMs: given.has('timeoutMs') ? flags.timeoutMs : null,
    },
  });
};

#!/usr/bin/env node
'use strict';
// `zcode-agent-acp [options]` = `zcode-agent acp [options]`, for ACP clients
// whose settings take only an executable (T3 Code's provider form).
const { main } = require('./zcode-agent.js');

process.argv.splice(2, 0, 'acp');
main().catch((err) => {
  process.stderr.write(`zcode-agent: internal error: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});

'use strict';
// lib/commands/login.js — read the API key from piped stdin and store it at
// <root>/credentials.json (mode 600, root mode 700) (DESIGN §5, §10).
// Never interactive (1.0): a terminal on stdin is refused instead of
// waiting for a paste. The key is never echoed. Output deliberately
// contains no key material.
const fs = require('node:fs');
const path = require('node:path');
const { rootDir } = require('../key.js');

module.exports = async function login() {
  if (process.stdin.isTTY) {
    process.stderr.write(
      'zcode-agent login: pipe the key in, e.g. printf %s "$ZAI_API_KEY" | zcode-agent login\n' +
        '(not needed with the ZCode app installed: its key is used automatically)\n'
    );
    process.exit(2);
  }
  let input = '';
  await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (input += c));
    process.stdin.on('end', resolve);
    process.stdin.on('error', resolve);
  });
  const key = input.trim();
  if (!key) {
    process.stderr.write('zcode-agent login: no key received on stdin.\n');
    process.exit(2);
  }

  const root = rootDir(process.env);
  fs.mkdirSync(root, { recursive: true });
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'credentials.json');
  fs.writeFileSync(file, JSON.stringify({ apiKey: key }, null, 2) + '\n', {
    mode: 0o600,
  });
  fs.chmodSync(file, 0o600);
  // No cache to invalidate: every invocation rewrites its session's
  // provider config from the current key.
  process.stdout.write(`zcode-agent login: key stored at ${file} (mode 600)\n`);
  process.exit(0);
};

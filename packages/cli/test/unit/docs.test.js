'use strict';
// The skills and README must describe the interface that exists: every
// --flag and every `zcode <command>` they mention is checked against the
// CLI's own usage text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { USAGE } = require('../../bin/zcode-agent.js');

const pkg = path.join(__dirname, '..', '..');
const repo = path.join(pkg, '..', '..');
const DOCS = [
  path.join(repo, 'README.md'),
  path.join(pkg, 'skills/README.md'),
  path.join(pkg, 'skills/claude-code/zcode-agent/SKILL.md'),
  path.join(pkg, 'skills/codex/zcode-agent/SKILL.md'),
];
const NOT_ZCODE_FLAGS = new Set(['--test-concurrency', '--workspace']); // npm/node flags quoted in docs

test('docs only mention flags and commands the CLI accepts', () => {
  const known = new Set(USAGE.match(/--[a-z][a-z-]*/g));
  const commands = new Set(['task', 'run', 'agent', 'resume', 'status', 'wait', 'cancel', 'login', 'doctor', 'skills', 'result', 'list', 'plan', 'watch', 'cost', 'acp']);
  for (const rel of DOCS) {
    const text = fs.readFileSync(rel, 'utf8');
    for (const flag of new Set(text.match(/(?<![\w-])--[a-z][a-z-]*/g) || [])) {
      if (NOT_ZCODE_FLAGS.has(flag)) continue;
      assert.ok(known.has(flag), `${rel} mentions ${flag}, which zcode-agent does not accept`);
    }
    const stale = text.match(/`zcode (?:task|run|agent|resume|status|wait|cancel|login|doctor|skills|result|plan|watch|cost)\b/);
    assert.equal(stale, null, `${rel} still invokes the pre-1.0 "zcode" command: ${stale && stale[0]}`);
    for (const m of text.matchAll(/`zcode-agent ([a-z]+)/g)) {
      const word = m[1];
      if (commands.has(word)) continue;
      // `zcode "<prompt>"` style is fine; a bare lowercase word must be a command.
      assert.fail(`${rel} mentions "zcode-agent ${word}", which is not a zcode-agent command`);
    }
  }
});

test('both skills carry valid frontmatter with the same name', () => {
  for (const rel of DOCS.slice(2)) {
    const text = fs.readFileSync(rel, 'utf8');
    const fm = text.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
    assert.ok(fm, `${rel} has name + description frontmatter`);
    assert.equal(fm[1], 'zcode-agent');
    assert.ok(fm[2].length > 40 && fm[2].length < 1024);
  }
});

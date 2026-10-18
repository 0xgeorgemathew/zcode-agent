'use strict';
// The orchestrator skills shipped in the package, and where
// `zcode-agent skills` installs them:
//
//   skills/claude-code/zcode-agent  ->  ~/.claude/skills/zcode-agent
//   skills/codex/zcode-agent        ->  ${CODEX_HOME:-~/.codex}/skills/zcode-agent
//
// Only the zcode-agent skill directory is ever replaced or removed — plus
// the pre-1.0 `zcode` skill directory when its SKILL.md is ours (name: zcode),
// so an upgraded machine doesn't keep two skills for the same CLI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pkgRoot = path.join(__dirname, '..');
const PLATFORMS = ['claude', 'codex'];
const NAME = 'zcode-agent';
const LEGACY_NAME = 'zcode';

function targets(env = process.env) {
  const home = env.HOME || os.homedir();
  const claudeSkills = path.join(home, '.claude', 'skills');
  const codexSkills = path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills');
  return [
    {
      platform: 'claude',
      name: 'Claude Code',
      from: path.join(pkgRoot, 'skills', 'claude-code', NAME),
      to: path.join(claudeSkills, NAME),
      legacy: path.join(claudeSkills, LEGACY_NAME),
    },
    {
      platform: 'codex',
      name: 'Codex',
      from: path.join(pkgRoot, 'skills', 'codex', NAME),
      to: path.join(codexSkills, NAME),
      legacy: path.join(codexSkills, LEGACY_NAME),
    },
  ];
}

function select(platforms, env) {
  const want = platforms && platforms.length ? new Set(platforms) : new Set(PLATFORMS);
  return targets(env).filter((t) => want.has(t.platform));
}

// The pre-1.0 skill is ours only when its frontmatter says `name: zcode`.
function isLegacyOurs(dir) {
  try {
    return /^---\r?\nname:\s*zcode\s*\r?\n/.test(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
  } catch {
    return false;
  }
}

function removeLegacy(t) {
  if (!isLegacyOurs(t.legacy)) return false;
  fs.rmSync(t.legacy, { recursive: true, force: true });
  return true;
}

function installSkills({ platforms, env = process.env } = {}) {
  const done = [];
  for (const t of select(platforms, env)) {
    fs.mkdirSync(path.dirname(t.to), { recursive: true });
    fs.rmSync(t.to, { recursive: true, force: true });
    fs.cpSync(t.from, t.to, { recursive: true });
    done.push({ ...t, legacyRemoved: removeLegacy(t) });
  }
  return done;
}

function uninstallSkills({ platforms, env = process.env } = {}) {
  const done = [];
  for (const t of select(platforms, env)) {
    const legacyRemoved = removeLegacy(t);
    if (!fs.existsSync(t.to) && !legacyRemoved) continue;
    fs.rmSync(t.to, { recursive: true, force: true });
    done.push({ ...t, legacyRemoved });
  }
  return done;
}

function skillStatus({ env = process.env } = {}) {
  return targets(env).map((t) => ({
    ...t,
    installed: fs.existsSync(path.join(t.to, 'SKILL.md')),
    legacy: isLegacyOurs(t.legacy) ? t.legacy : null,
  }));
}

module.exports = { installSkills, uninstallSkills, skillStatus, targets, PLATFORMS };

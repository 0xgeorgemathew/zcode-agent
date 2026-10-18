# Orchestrator skills

These skills teach an orchestrating agent to make the design and logic decisions once, delegate the implementation to zcode-agent (one session with units, parallel sessions, or a plan), and read the compact handbacks, spending its own tokens only on decisions and exceptions. Both describe the same CLI; they differ only in runtime notes (tool timeouts for Claude Code, sandbox and network escalation for Codex).

| platform | skill in this repo | format |
|---|---|---|
| Claude Code | `skills/claude-code/zcode-agent/SKILL.md` | `SKILL.md` with `name` + `description` frontmatter |
| Codex | `skills/codex/zcode-agent/SKILL.md` + `agents/openai.yaml` | `SKILL.md` with `name` + `description` frontmatter; optional UI metadata in `agents/openai.yaml` |

## Install

After `npm install -g zcode-agent`, install both skills with:

```sh
zcode-agent skills install          # or: zcode-agent skills install claude | codex
```

This copies the Claude Code skill to `~/.claude/skills/zcode-agent` and the Codex skill to `${CODEX_HOME:-~/.codex}/skills/zcode-agent`, replacing only an earlier copy of the skill (and removing the pre-1.0 `zcode` skill if it is there). Run it again after upgrading zcode-agent to refresh them. `zcode-agent skills` shows what is installed, and `zcode-agent skills uninstall` removes them. The package runs no install scripts, so npm never asks to allow one.

To copy them by hand instead, run these from a checkout of this repo, or from the installed package (`$(npm root -g)/zcode-agent`), which ships `skills/`.

**Claude Code.** Personal skills, available in every project:

```sh
mkdir -p ~/.claude/skills
cp -R skills/claude-code/zcode-agent ~/.claude/skills/zcode-agent
```

For a single project, copy it to `<project>/.claude/skills/zcode-agent` instead and commit it so the whole team gets it. Claude Code discovers the skill from its description. You can also invoke it directly with `/zcode-agent`.

**Codex.** User skills live in `$CODEX_HOME/skills`, which defaults to `~/.codex/skills`:

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/codex/zcode-agent "${CODEX_HOME:-$HOME/.codex}/skills/zcode-agent"
```

Skills are discovered when a session starts, so open a new Codex session if `$zcode-agent` doesn't appear. The skill is selected automatically from its description, or explicitly with `$zcode-agent`.

Both skills assume `zcode-agent` is on `PATH` (`npm install -g zcode-agent`) and that `zcode-agent doctor` passes.

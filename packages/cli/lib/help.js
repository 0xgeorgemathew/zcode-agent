'use strict';
// Per-command help: `zcode <command> --help` prints the command's usage and
// only the flags that apply to it (each text <= 2000 bytes). The full text
// (bin/zcode-agent.js USAGE) is for `zcode --help` with no command.
const SESSION = `  --id <id>        name the session (existing id is never re-run: use resume)
  --label <text>   free-form label shown in status
  --detach         start in the background, print the id, exit 0
  --cwd <dir>      workspace (default: current dir)
  --owns <path>    repeatable: paths this session may change (default: whole workspace)
  --allow-overlap  start despite overlapping ownership`;
const EXEC = `  --model <id>     glm-5.3 | glm-5.3-flash (default glm-5.3)
  --effort <lvl>   low | high | max (default high)
  --mcp <json|@f>  add MCP servers (repeatable)   --mcp-inherit   --no-browser
  --skills <dir>   add skills (repeatable)        --no-skills
  --inherit-desktop  give the executor the desktop's AGENTS.md, skills, plugins
  --json           NDJSON events; last line is the compact brief (--full: whole record)
  --quiet          no progress feed; with --json only the result line`;

const HELP = {
  task: `usage: zcode-agent task [options] <objective...>
Execute a task contract, verify it with zcode-run checks, hand back.

contract:
  --task <file|->       JSON contract or markdown brief (- = stdin)
  --accept <text>       repeatable acceptance criterion
  --check <command>     repeatable shell check zcode-agent runs after the work
  --file <path>         repeatable file to read first
  --context <text|@f>   repeatable context   --decision <text> / --decisions <@f>
  --touch <path>        repeatable minimal edits allowed outside --owns
  --unit "n: goal [owns a,b]"  repeatable subagent unit
  --visual <criterion>  repeatable   --viewport <WxH>   --serve <cmd>
  --preflight           read-only: list open questions, no edits
  --max-repairs <n>     default 2     --check-timeout-ms <n>  default 300000
session:
${SESSION}
  --timeout-ms <n>      whole invocation (default 7200000 = 2 h)
${EXEC}
Full reference: zcode-agent --help`,
  run: `usage: zcode-agent [run] [options] <prompt...>
One-shot turn (prompt via stdin when piped).
  --session <id>   continue a session
  --timeout-ms <n> default 600000
  --thinking | --no-thinking   mirror reasoning to stderr
${SESSION}
${EXEC}
Full reference: zcode-agent --help`,
  agent: `usage: zcode-agent agent [options] <instructions...>
Turn that MUST dispatch a subagent.
  --profile <name> subagent profile (default general-purpose)
  --timeout-ms <n> default 600000
${SESSION}
${EXEC}
Full reference: zcode-agent --help`,
  resume: `usage: zcode-agent resume <id> [message...]
Continue a session: answer questions, follow up, or retry after a timeout.
Pass "-" as the message to read it from stdin.
  --timeout-ms <n>  --max-repairs <n>  --check-timeout-ms <n>
  --model <id>  --effort <lvl>
  --json  --full  --quiet  --include-reasoning
Start-time flags (--id, --owns, --cwd, ...) cannot change on resume.`,
  status: `usage: zcode-agent status [<id>] [--all] [--json]
One session in detail, or the 15 most recent (--all: every session).
  --json   machine-readable list or detail`,
  wait: `usage: zcode-agent wait <id...> [--any] [--json] [--full] [--timeout-ms n]
Block until sessions finish; print each handback.
  --any            return when the FIRST id finishes
  --timeout-ms <n> one line per pending session, exit 124
  --json           briefs   --full  full records`,
  watch: `usage: zcode-agent watch [<id>… | --plan <name>] [--stall-min n]
Live view of sessions, no model tokens. One line each:
  id  state phase[ n/m]  elapsed  last: <tool> <age> ago  req <n>  sub <running>  $cost
"thinking 12m 40k chars" / "writing …" appears while one model request streams.
cost: every GLM request so far (implementer, subagents, verifier) at Z.ai API
list price, from the engine's own ledger; with several sessions a total line
follows. STALLED? is appended when a running session has had no engine event for
--stall-min minutes (default 8). Nothing is done automatically.
  <id…>        the sessions to watch
  --plan name  every session of a plan
  (no args)    live sessions and those finished in the last 10 minutes
TTY: redraws every 2 s. Piped: a line is printed only when a session changes.
Exits 0 when every watched session has finished; Ctrl-C exits 0.`,
  cost: `usage: zcode-agent cost [<dir>] [--app] [--json]
GLM cost of every zcode-agent session whose workspace is <dir> or below it (default:
the current directory), per session and in total, at Z.ai API list price
(USD per M tokens: GLM-5.3-Flash 0.15 input / 0.03 cached / 0.50 output;
GLM-5.3 1.40 / 0.26 / 4.40). Counts come from each session's engine DB:
every request of the implementer, its subagents and the visual verifier,
across resumes. ~ marks an estimate (no cache split).
  --app    also the desktop app's own sessions in that directory
  --json   {type:"cost", dir, total, sessions[, app]}
ZCODE_PRICES='{"GLM-5.3-Flash":{"input":0.15,"cached":0.03,"output":0.5}}' overrides.`,
  result: `usage: zcode-agent result <id> [--json] [--full]
Print a finished session's handback without waiting (exit 7 if running).
  --json  compact brief   --full  the whole record`,
  cancel: `usage: zcode-agent cancel <id> [--json]
Stop a running session (SIGTERM, SIGKILL after 15 s). No-op when finished.`,
  plan: `usage: zcode-agent plan <subcommand>
  zcode-agent plan check <file>              validate (ids, after, cycles, owns, effort)
  zcode-agent plan run <file> [--preflight] [--detach] [--timeout-ms n] [--id name] [--json]
  zcode-agent plan wait|status <name> [--timeout-ms n] [--json]
  zcode-agent plan resume <name> [message...] [--session <id>]
plan file: {cwd?, decisions?, context?, files?, model?, effort?, limits?,
  sessions:[{id, after?:[ids], label?, ...task contract keys}]}
  top-level decisions/context/files are prepended to every session; limits
  ({timeoutMs,maxRepairs,checkTimeoutMs}) default every session; "@file"
  resolves next to the plan file, then against its cwd.
  --preflight  read-only preflight of every session (sessions with "after"
               are told to assume their prerequisites)
  --detach     supervise in a background process
  --id <name>  plan name (default: file basename)
  --cwd <dir>  workspace override
Exit: 0 completed, 10 blocked, 8 partial/failed, 124 timeout.`,
  login: `usage: printf %s "$ZAI_API_KEY" | zcode-agent login
Store a Z.ai API key (read from piped stdin, never echoed) in ~/.zcode-agent.
Not needed when ZAI_API_KEY is set or the ZCode app holds a key.`,
  doctor: `usage: zcode-agent doctor [--json] [--install-browser]
Engine, key, inherited MCP servers and skills, and browser report.
--install-browser installs the Chromium build the default Playwright server
drives (needed only without the ZCode app's own Playwright server).`,
  skills: `usage: zcode-agent skills [install|uninstall] [claude|codex]
Install the orchestrator skills (default: show status).`,
  acp: `usage: zcode-agent acp [options]
Serve the Agent Client Protocol (ACP v1) on stdio: T3 Code, Zed and any ACP
client run GLM-5.3 through it. Each ACP session is a zcode-agent session
(status, watch, cost see it); clients switch mode, model and effort per session.
  --mode <mode>    default for new sessions: build (ask before edits and
                   commands) | edit (accept edits) | plan | yolo (full access)
                   default build (or $ZCODE_ACP_MODE)
  --model <id>     glm-5.3 | glm-5.3-flash (default glm-5.3)
  --effort <lvl>   low | high | max (default high)
  --timeout-ms <n> per prompt (default: none)
  --mcp <json|@f>  add MCP servers (repeatable)   --hermetic   --no-browser
  --mcp-inherit    also the desktop's MCP servers (default: the client's
                   servers and Playwright only; or $ZCODE_ACP_INHERIT_MCP=1)
  --skills <dir>   add skills (repeatable)        --no-skills
  --inherit-desktop  also the desktop's AGENTS.md, plugins and agent profiles
A new session's engine starts 1.5 s after session/new, so the first prompt
does not wait for it ($ZCODE_ACP_PREWARM_MS: delay in ms, or "off").
T3 Code: an ACP Registry provider, source "Local command", executable
zcode-agent-acp (see the README). $ZCODE_ACP_LOG=<file> logs every frame.`,
};

function commandHelp(command) {
  return HELP[command] || null;
}

module.exports = { commandHelp };

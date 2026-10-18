<p align="center">
  <img src="https://raw.githubusercontent.com/0xgeorgemathew/zcode-agent/main/docs/assets/hero.svg" alt="Run sheet of a real four-session zcode-agent plan: scaffold, then landing and apply in parallel, then integration. Each bar is build time followed by verifier time. GLM cost per session $0.50, $0.69, $0.95 and $0.81; the Opus orchestrator cost $2.17 and 779 Flash requests cost $2.95." width="960">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/zcode-agent"><img src="https://img.shields.io/npm/v/zcode-agent.svg?color=2E2A7A&label=npm" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.13-2E2A7A" alt="node 22.13 or later">
  <img src="https://img.shields.io/badge/dependencies-engine%20only-2E2A7A" alt="one dependency: the engine">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2E2A7A" alt="MIT license"></a>
</p>

**zcode-agent lets an expensive model decide and a cheap one build.** Claude Code or Codex writes the decisions and a task contract; zcode-agent implements it with GLM-5.3-Flash, runs your checks itself, has a second Flash session that never saw the code screenshot and judge the UI, repairs what fails, and hands back one short line of evidence. The orchestrator spends its tokens on decisions and exceptions, nothing else.

| who | does | never does |
|---|---|---|
| **Orchestrator** (Opus, Codex, any agent with a shell) | product, design and logic decisions; shapes the work into sessions; answers questions | writes code, re-runs checks, looks at screenshots |
| **zcode-agent implementer** (GLM-5.3-Flash) | builds inside `--owns`, uses subagents for units, fixes failing checks | invents anything user-visible the decisions left open, commits, deploys |
| **zcode-agent verifier** (a fresh Flash session) | serves the app, screenshots every viewport, quotes the text it can actually read, judges each criterion | edits files, trusts the DOM over the pixels |

The run above was a real one: a one-page site with an apply flow, four sessions, every check and all 36 visual criteria passing on the first verifier round. Your own numbers are one command away:

```text
$ zcode-agent cost ~/projects/white-credit
zcode-agent session  status     model          req  input  cached  output   cost
wc3-integration      completed  GLM-5.3-Flash  235  24.6M   24.3M   72.8k  $0.81
wc3-apply            completed  GLM-5.3-Flash  201  26.5M   26.0M  177.7k  $0.95
wc3-landing          completed  GLM-5.3-Flash  209  15.6M   14.9M  274.9k  $0.69
wc3-scaffold         completed  GLM-5.3-Flash  134  13.6M   13.2M   99.0k  $0.50

total  4 sessions  779 requests  80.3M input (78.4M cached)  624.4k output  $2.95
```

The same brief built earlier on GLM-5.3 cost $20 to $35 a run in GLM alone. Agent loops re-send their context on every request, so 97% of input is cached; zcode-agent prices cached input separately (Z.ai list price, `ZCODE_PRICES` overrides).

&nbsp;

## Quick start

```sh
npx zcode-agent doctor               # engine, key, MCP servers, skills, browser
npx zcode-agent skills install       # teach Claude Code and Codex to delegate to zcode-agent

npx zcode-agent task --check "npm test" "Fix the off-by-one in src/paginate.ts"
```

Or install it once: `npm install -g zcode-agent`, then drop the `npx`. Node 22.13 or later.

**With the ZCode app installed** there is nothing to set up: zcode-agent uses the app's Z.ai API key (read in place, never copied or printed), its MCP servers and its skills. OAuth-only remote MCP servers are left out, because a headless session can't sign in; servers that fail to connect are skipped for six hours. The app's plugins, agent profiles and your global `AGENTS.md` stay out unless you pass `--inherit-desktop`; `--hermetic` leaves out the app's MCP servers and skills too.

**Without the app**, give it a Z.ai API key and a browser for visual checks:

```sh
export ZAI_API_KEY=…                          # or: printf %s "$KEY" | zcode-agent login
npx zcode-agent doctor --install-browser      # Chromium for the default headless Playwright server
```

The engine itself ships with the package: `@zcode-agent/engine` is the headless ZCode engine built unmodified from the Apache-2.0 [zai-org/ZCode](https://github.com/zai-org/ZCode) source, pinned to the version zcode-agent is tested with. Every session also gets zcode-agent's own executor instructions as its `AGENTS.md`: headless rules, the session's port and output dirs, and when to split work across subagents.

`zcode-agent skills install` puts the Claude Code skill in `~/.claude/skills/zcode-agent` and the Codex skill in `${CODEX_HOME:-~/.codex}/skills/zcode-agent`, and removes a pre-1.0 `zcode` skill (`zcode-agent skills install claude | codex` for one, `zcode-agent skills` to see what is installed, `zcode-agent skills uninstall` to remove). The package runs no install scripts. Details are in [`skills/`](packages/cli/skills/README.md).

&nbsp;

## The loop

With the skill installed, the orchestrator works in four steps, and only the first is expensive:

1. **Decide.** Read the repo, then write every user-visible and behavioural decision down once (`docs/decisions.md`: palette, copy, motion, validation rules, storage keys) as dense statements.
2. **Shape.** One session by default. `--unit`s when one deliverable has separable parts that share context (the executor runs a subagent per unit), parallel `--detach`ed sessions when independent deliverables own disjoint paths, a `zcode-agent plan` when there are dependencies. Splitting is optional and only pays when the work really splits; the skill spells out when.
3. **Dispatch and wait.** One background `zcode-agent wait` or `zcode-agent plan wait`; no polling.
4. **Handle exceptions.** `completed` needs nothing. Anything else comes with the questions, failing check tail or unmet criterion, answered with a one-line `zcode-agent resume`.

While it runs, you (not the orchestrator) can watch it:

```text
$ zcode-agent watch --plan plan
wc3-scaffold     completed  51m  last: Read 8m ago  req 133  sub 0  $0.50
wc3-landing      running verifying round 1  1h12m  last: Read 4s ago  req 154  sub 0  $0.61
wc3-apply        running executing  1h12m  last: Edit 12s ago  req 188  sub 0  $0.83
wc3-integration  queued  0s  last: -  req 0  sub 0
total  $1.94  (3 sessions, Z.ai list price)
```

While a model request streams, the line says so (`thinking 12m 40k chars`), so a long think does not look stuck. `STALLED?` is appended when a running session has had no engine event at all for 8 minutes (`--stall-min`). Nothing is done automatically.

&nbsp;

## Hand off a task

```sh
zcode-agent task --cwd ./site --id page-1 \
  --owns src/pages/pricing/ \
  --check "npm run build" --check "npm test -- pricing" \
  --accept "Three plan cards, the middle one highlighted" \
  --context @design/pricing.md \
  "Implement the pricing page from the supplied design notes"
```

zcode-agent turns this into an execution contract and runs a fresh engine session in yolo mode, with `--cwd` as the blast radius. The model may split the work across subagents. When it finishes, **zcode-agent runs the checks itself**. If a check fails, zcode-agent feeds the failure output back for a bounded number of repair turns (`--max-repairs`, default 2), then reports:

```text
✓ completed  page-1  142.3s
  Pricing page with three plan cards; middle card highlighted per design notes.
changed  3 files
  A src/pages/pricing/index.tsx
  A src/pages/pricing/PlanCard.tsx
  M src/pages/pricing/styles.css
checks   2/2 passed  ·  1 repair turn
  ✓ npm run build
  ✓ npm test -- pricing
not verified
  - prose acceptance criteria are confirmed only by the executor's own report
```

That summary goes to stdout; the live feed (session header, phases, tools, subagents, check results) goes to stderr. With `--json` you get the compact brief as one machine-readable result line (see [Machine interface](#machine-interface)). For small work the objective alone is enough: `zcode-agent task "Fix the typo in the README heading"`.

### What a status means

| status | meaning | exit |
|---|---|---|
| `completed` | zcode-agent's own checks ran and passed, the executor reports done, no unmet criteria, nothing changed outside `--owns` | 0 |
| `unverified` | executor reports done, but no checks were declared (or no usable handback), so completion is self-reported | 9 |
| `partial` | work remains: executor says partial, a criterion is unmet, or files changed outside the owned scope | 8 |
| `blocked` | needs the orchestrator: `questions` lists what is missing | 10 |
| `failed` | checks still failing after the repair budget (`error.kind: checks_failed`, exit 8), engine/turn error (5), or timeout (124) | 5 / 8 / 124 |
| `cancelled` | stopped by `zcode-agent cancel`, Ctrl-C, or SIGTERM | 130 |

A model claiming success is never enough on its own. A subagent ending `success` only means it returned. The handback block the model writes is reported as `handback` (a claim), and the status is derived from what zcode-agent observed. `notVerified` lists anything zcode-agent could not check itself.

### The contract

Flags cover the common fields. For richer handoffs, pass `--task contract.json`, `--task brief.md`, or `--task -` to read stdin. Only `objective` is required; unknown keys are rejected so a typo never silently drops a requirement.

```json
{
  "objective": "Implement page 2 (Team) per the design spec",
  "scope": ["Team page route and its components"],
  "constraints": ["No new dependencies", "Keep existing routing untouched"],
  "decisions": ["Grid of 3 columns ≥1024px, 1 column below", "Use tokens from src/theme.ts only"],
  "acceptance": ["Every member card shows name, role, avatar"],
  "checks": ["npm run build", "npm test -- team"],
  "visual": ["every member's name and role is readable at 390 and 1440"],
  "files": ["src/theme.ts", "src/pages/home/index.tsx"],
  "references": ["design/team.png described in design/team.md"],
  "context": ["Copy lives in content/team.json"],
  "owns": ["src/pages/team/**", "content/team.json"],
  "limits": { "timeoutMs": 7200000, "maxRepairs": 2, "checkTimeoutMs": 300000 },
  "effort": "high"
}
```

**Decisions** (`--decision "…"`, repeatable, and `--decisions @file`; `design` is an alias) are presented as binding: the executor implements them and does not revisit them. `@file` entries inside contract `decisions`/`context` lists are inlined (relative to the contract file, then to `--cwd`; the error names both paths). If something user-visible or behavioural is left open, the executor does not guess: when it blocks the work it reports `blocked` with a structured question `{"q", "options": [...], "recommend"}`; otherwise it takes the most conservative choice and lists it in the handback `decisions: [{what, why}]`, which the brief carries so the orchestrator can overrule it. A file passed with `--file` and also inlined with `--context @file` reaches the executor once; identical context and acceptance entries are deduped.

**Preflight.** `--preflight` runs a read-only turn over the same contract: the executor lists every open question it would otherwise guess and makes no edits; zcode-agent runs no checks. The result is `blocked` with `questions`, or `completed` with summary `no open questions`; any changed file fails it (`preflight_wrote`). `zcode-agent resume <id> "<answers>"` then switches the session to execution with the full task protocol, checks and visual verification. It costs the orchestrator a round trip, so it pays off only when the decisions have known gaps.

**Units.** `--unit "name: objective [owns a,b]"` (repeatable; contract `units: [{name, objective, owns?}]`) makes the executor dispatch each unit to its own subagent inside this one session, in parallel where independent, then integrate and verify the whole. Unit `owns` must lie within the session's `--owns` and be disjoint from each other (exit 2 otherwise). The handback `units: [{name, status, note}]` is listed under `notVerified` as executor claims; zcode-agent's checks still verify the integrated result.

### Visual verification

`--visual "criterion"` (repeatable; contract `visual`), `--viewport WxH` (repeatable, default `390x844` and `1440x900`; contract `viewports`) and `--serve "cmd"` (contract `serve`; must honour `$ZCODE_PORT`, default: the executor reads `package.json`) make zcode-agent, not the implementer, judge the rendered result. Phrase criteria as what must be readable: "hero headline 'Your money, simplified' is fully readable at 390 and 1440".

After the implementer's turn, once the checks pass, zcode-agent opens a **fresh engine session** on the first image-capable model (GLM-5.3-Flash, effort `high`, same workspace and session environment). It serves the app on `$ZCODE_PORT`, then in one scripted Playwright pass per round, in a fresh isolated browser profile so it never judges a stale copy, waits for fonts and animations at every viewport, scrolls a window height at a time to the bottom of the page and saves a screenshot per step (plus every state a criterion names) into `$ZCODE_OUT/verify/<round>/`. It reads them all in one batch, makes no edits, and answers with a `zcode-visual` block `[{criterion, viewport, met, seen, note, shot}]`, quoting the text it can read (`seen`). It always judges one built-in criterion too: all text the page means to show is readable after animations finish (not clipped, hidden, transparent, off-screen or overlapped).

Those entries are the result's `visual`; the implementer's own claims survive only as `executorVisual` in the full record. Unmet criteria spend the repair budget like failing checks: the repair turn goes to the implementer with the verifier's `seen`, note and shot paths, then checks and a new verifier round run. A verifier that fails or returns no parsable block is retried once; still nothing gives `met: null`, status `partial` and the issue `visual not verified`. Still unmet after the budget: `partial` with `visual criteria unmet: …`. An implementer on a model that cannot see images (`--model glm-5.3`) is told so and to self-check visibility in the DOM instead. Files the verifier changes outside `.zcode/` (and outside any concurrent session's ownership) are reported as the issue `verifier edited files: …`. A verifier request that streams far past any real one (200k characters without a tool call) is ended and retried, so a runaway generation costs minutes, not the engine's 128k-token cap. Verifier turns count in `usage` and in `zcode-agent cost`. Without `--visual` nothing changes.

&nbsp;

## Models and effort

Every command runs on GLM-5.3-Flash (it sees images) at effort `max` unless you pass a flag. Plan sessions, units, resume, `run`, `agent` and the verifier all default to Flash. `--model glm-5.3` is an explicit override and cannot see images (`zcode-agent doctor` shows `images` / `no images` per model). Subagent profiles copied from your desktop that pin a GLM-5.3 id are rewritten, in the session's copy only, to the session's model.

| setting | flag | values | default |
|---|---|---|---|
| model | `--model` | `glm-5.3-flash` (aliases `flash`, `5.3-flash`, `53f`), `glm-5.3` (aliases `5.3`, `53`) | `glm-5.3-flash` |
| effort | `--effort` | `low`, `high`, `max` (the engine's levels for both models; `zcode-agent doctor` lists them) | `max` |

A task contract can set `"model"` and `"effort"`; flags override the contract. A resumed session keeps its original model and effort unless you pass the flags again.

&nbsp;

## Sessions

Every invocation gets a session: `--id page-1`, or a generated `zc-xxxxxxxx`. Each session has its own engine HOME (`~/.zcode-agent/sessions/<id>/home`), so conversation state, engine database, MCP servers, and skills never leak between sessions. An existing id is never re-run, so retrying a start you lost track of fails fast instead of doing the work twice.

```sh
zcode-agent task --detach --id page-1 --owns src/pages/home/ --check "npm run build" "Build page 1"
zcode-agent task --detach --id page-2 --owns src/pages/team/ --check "npm run build" "Build page 2"
zcode-agent watch                  # live: phase, last tool, requests, cost, STALLED?
zcode-agent status page-1 --json   # one session: state, phase, activity, recent events, result
zcode-agent wait page-1 page-2     # block until both finish; print each handback
zcode-agent wait page-1 page-2 --any   # return as soon as the first one finishes
zcode-agent result page-1          # a finished session's handback, without waiting
zcode-agent resume page-2 "Use the 2-column variant below 1024px."   # answer / follow up / retry
zcode-agent cancel page-1          # stop the turn and any running check; recorded as cancelled
zcode-agent cost                   # what the sessions in this directory cost
```

- **Lifecycle.** A session is `queued`, then `running`, then `finished` with a status. If the process that owned a running session dies, the session shows as `interrupted`, which can be resumed.
- **Resume** sends your message into the same engine conversation. For task sessions, the model is told that earlier work is already applied to the workspace, and zcode-agent re-runs the checks and repairs and produces a fresh handback. A resume with no message (task sessions) means "continue from where you stopped".
- **Never automatically re-sent.** zcode-agent retries only engine start-up, which happens before anything reaches the model. A prompt that was delivered is never re-sent automatically. Continuing is always an explicit `resume`.
- **Detached sessions** write their NDJSON to `~/.zcode-agent/sessions/<id>/stdout.ndjson` and diagnostics to `stderr.log`. The handback lands in `result.json`. You never need to read these files: `status` and `wait` print everything.

### Concurrency and ownership

`--owns` declares what a session may change: a path owns its subtree, and globs are supported. Patterns are relative to `--cwd`. A session without `--owns` owns the whole workspace, which is right for a one-off task in its own checkout.

- Starting a session whose ownership **overlaps a running session in the same workspace** is refused with exit 7, unless `--allow-overlap` is passed. The workspace is the git toplevel, so sibling directories of one repo count as one workspace. Disjoint owners (`src/pages/home/` vs `src/pages/team/`) run side by side.
- After the work, zcode-agent diffs the workspace and reports each changed file. Changes outside the session's ownership are listed in `scopeViolations`, and for task sessions they make the result `partial`. Files that fall in a concurrent session's ownership (including one that started a moment later) are attributed to that session, not counted against this one.
- For overlapping or risky parallel work, give each session its own git worktree via `--cwd`.
- `ZAI_CODE_MAX_ACTIVE` (default 8) is a soft machine-wide cap. Sessions beyond it wait in `queued`.
- **Session environment.** Every session's executor and every check run with `ZCODE_SESSION_ID`, `ZCODE_PORT` (a free TCP port from 41000-48999, reserved per session and unique among live sessions), `ZCODE_OUT` (`<cwd>/.zcode/out/<id>`, created) and `ZCODE_TMP` (a per-session scratch dir). The task prompt tells the executor to use them for dev and preview servers, build output dirs and test artifacts, so parallel sessions cannot collide on a port or a `dist/`. Files under `.zcode/` never count as changes or scope violations, and zcode-agent lists `.zcode/` and `.playwright-mcp/` in the repo's local `.git/info/exclude` (never `.gitignore`).
- **`--touch <path|glob>`** (repeatable; contract key `touch`) allows minimal edits outside `--owns` without declaring ownership. Touched files are listed in `touched` and are not scope violations. Starting is refused with exit 7 if a running session owns a matching path; a touch reserves nothing, so it never blocks another session's `--owns`.

### Plans: several sessions with dependencies

`zcode-agent plan` runs a set of task sessions as one unit, in dependency order, and returns a single summary.

```json
{ "decisions": ["@decisions.md"], "context": ["@brief.md"], "effort": "high",
  "sessions": [
    { "id": "tokens", "objective": "Design tokens", "owns": ["src/tokens/**"], "checks": ["npm run lint"] },
    { "id": "home",   "objective": "Home page", "after": ["tokens"], "owns": ["src/home/**"] },
    { "id": "team",   "objective": "Team page", "after": ["tokens"], "owns": ["src/team/**"] }
  ] }
```

Optional top-level keys: `cwd` (relative to the plan file), `decisions`, `context`, `files` (prepended to every session; `@file` entries are read relative to the plan file, then against the plan's cwd), `model`, `effort`, `limits` (`timeoutMs`, `maxRepairs`, `checkTimeoutMs`: the default for every session; a session's own `limits` override per key). Each session has an `id` (its zcode-agent session id), optional `after` (ids), optional `label` (the session label becomes `plan:<name> <label>`) and any task contract keys. In `plan run --preflight`, a session with `after` is told which upstream sessions have not run yet and to assume they deliver their objectives.

```sh
zcode-agent plan check plan.json              # validate: exit 2, one line per problem
zcode-agent plan run plan.json --preflight    # read-only questions per session (<id>.pre); exit 10 if any
zcode-agent plan run plan.json --detach       # supervise in the background
zcode-agent plan wait plan   --json --timeout-ms 7000000   # one line; exit 124 on timeout
zcode-agent plan status plan                  # one line per session
zcode-agent watch --plan plan                 # live view with cost, for humans
zcode-agent plan resume plan "answers…"       # resume failed/partial/blocked sessions, relaunch skipped ones
```

A session starts once everything it is `after` has completed; sessions that can run together must own disjoint paths (`plan check` enforces it). A session that ends without completing marks its downstream `skipped` while the others continue. The summary is `{"type":"plan","name","status","sessions":[{"id","status"}],"briefs":[…]}` with a brief for each finished session that did not complete. Exit codes: 0 completed, 10 blocked, 8 partial or failed, 124 timeout. Plan status is derived from the sessions, so it stays accurate even if the supervisor process dies; `plan resume` restarts it. The plan name is the file's basename (`--id` overrides); ids that already exist as sessions are refused, so re-run through `plan resume`.

The critical path is what you wait for. Put visual criteria on sessions that build finished UI, not on a scaffold of stubs, and give an integration session only cross-cutting criteria: each verifier round is minutes of Flash time.

&nbsp;

## Cost

`zcode-agent cost [<dir>]` totals every zcode-agent session whose workspace is `<dir>` or below it (default: the current directory): one row per session and a total, priced at Z.ai's API list price in USD per million tokens.

| model | input | cached input | output |
|---|---|---|---|
| GLM-5.3-Flash | 0.15 | 0.03 | 0.50 |
| GLM-5.3 | 1.40 | 0.26 | 4.40 |

The counts come from each session's own engine database: every request of the implementer, its subagents and the verifier, across every resume. `--app` adds the desktop app's own sessions opened in that directory; `--json` prints `{type:"cost", dir, total, sessions[, app]}`. A session without an engine database falls back to its recorded token totals, marked `~` (no cache split, so priced high). Set `ZCODE_PRICES='{"GLM-5.3-Flash":{"input":0.15,"cached":0.03,"output":0.5}}'` to price a plan or a different provider. `zcode-agent watch` shows the same figure per session as it grows. If you are on a Z.ai coding plan, this is what the work would have cost at API rates, not what you are billed.

&nbsp;

## One-shot turns and subagent dispatch

`zcode-agent` with a prompt (or `zcode-agent run`) is a plain turn. The answer streams to stdout, and thinking is mirrored to stderr as `│ ` lines.

```sh
zcode-agent "What is 17*23? Reply with only the number."
zcode-agent --effort high "Draft a commit message for the staged diff"
echo "$PROMPT" | zcode-agent
```

`zcode-agent agent "<instructions>"` forces a dispatch through the engine's Agent tool. It is verified from `session/subagents`: exit 6 if no subagent ran or any ended in a status other than `success`. `--profile` picks the subagent profile (default `general-purpose`). Inside `zcode-agent task`, subagents are optional: the executor decides when to use them, gives each a bounded scope and file ownership, and must verify the integrated result.

&nbsp;

## Machine interface

`--json`: stdout carries NDJSON events, then exactly one final `{"type":"result",…}` line. With `--quiet`, the result line is the only output. For task sessions, text/reasoning deltas are left out of the events unless you pass `--stream`, so an orchestrator reading the output pays only for lifecycle events.

The final line is the compact **brief** (`zcode.brief/1`), sized for an orchestrator that spends tokens on decisions. Keys with empty values are omitted:

```json
{"type":"result","schema":"zcode.brief/1","status":"failed","ok":false,"id":"page-1","label":"home",
 "summary":"…(≤600 chars)…","files":["src/pages/home/index.tsx"],
 "checks":[{"command":"npm run lint","ok":true},{"command":"npm test","ok":false,"exitCode":1,"tail":"…last 1500 chars…"}],
 "questions":[],"issues":["…"],"unresolved":[],"scopeViolations":[],"error":{"kind":"checks_failed"},
 "result":"/…/sessions/page-1/result.json"}
```

The brief lists unmet visual criteria only (`visualMet: "M/N"` counts them all), at most 6 `decisions` (`decisionsMore`) and 40 `files` (`filesMore`, concurrent sessions' files excluded). `run` and `agent` briefs also carry `response`, because the text answer is the product there. Only failing checks are listed (`checksPassed: N` counts the passing ones); a failing check carries `exitCode`, `timedOut` and the last 1500 characters of its output as `tail`. `result` is the path to the full record: `result.json` on disk is always the full `zcode.result/1` record, and `--full` prints that same record instead of the brief (on `task`/`run`/`agent`/`resume`/`wait`/`result`):

```json
{"type":"result","schema":"zcode.result/1","ok":true,"status":"completed","id":"page-1","kind":"task",
 "summary":"…","response":"…executor report…","issues":[],"questions":[],"unresolved":[],"notVerified":[],
 "changes":{"tracking":"git","files":[{"path":"src/pages/home/index.tsx","change":"added","owned":true}]},
 "scopeViolations":[],"checks":[{"command":"npm run build","ok":true,"exitCode":0,"timedOut":false,"durationMs":8123,"output":"…tail…"}],
 "checksPassed":true,"repairs":0,"handback":{"status":"done","summary":"…","changes":[],"checks":[],"criteria":[],"unresolved":[],"questions":[],"notes":""},
 "subagents":[{"agentId":"agent_…","profileId":"general-purpose","status":"success","summary":"…","durationMs":59765}],
 "error":null,"cwd":"/abs/site","workspaceRoot":"/abs/site","owns":["src/pages/home/"],"sessionId":"sess_…","resumed":false,"turns":1,
 "model":"GLM-5.3-Flash","effort":"max","mode":"yolo","usage":{"inputTokens":19608,"outputTokens":3120},
 "toolCalls":14,"durationMs":142301,"files":{"session":"…/sessions/page-1","result":"…/result.json","events":"…/events.ndjson"}}
```

`model` and `effort` are engine-reported (from the engine's `model_request_started` event), not echoes. `sessionId` is the engine's session id; `id` is the zcode-agent session id you pass to `status`, `wait`, `result`, `resume`, and `cancel`. A run that fails still ends with a parseable result line.

| event | meaning |
|---|---|
| `{"type":"session","id","kind","cwd","owns","checks","model","effort","resumed"}` | which session is active, and its scope |
| `{"type":"phase","phase":"starting\|executing\|reporting\|checking\|repairing\|queued"}` | what is running |
| `{"type":"tool","name":"Edit","phase":"started"}` | tool lifecycle (`scheduled`, `started`, `result`, `error`) |
| `{"type":"subagent","phase":"started\|returned\|error"}` | subagent activity |
| `{"type":"check","phase":"finished","command","ok","exitCode","durationMs"}` | zcode-run verification |
| `{"type":"mcp","name","status"}` · `{"type":"retry",…}` · `{"type":"model_request_started",…}` | MCP settling, start-up retry, engine model evidence |
| `{"type":"stream","kind":"text_delta\|reasoning_delta","delta"}` | live text (run/agent; task with `--stream`) |

`zcode-agent status <id> --json` returns `{"type":"status", state, status, phase, pid, live, activity, recent:[…], result?}`. `zcode-agent wait --json` prints one brief per session as each finishes (`--full`: full records; `--any`: stop at the first). When `--timeout-ms` elapses first it prints exactly one line per session still running, `{"type":"pending","id","state","phase","elapsedMs"}` (human mode: `<id> <state> <phase> 12m`), and exits 124. `zcode-agent watch [<id>… | --plan <name>] [--stall-min 8]` is a live view for humans (no model tokens): one line per session, `id  state phase[ n/m]  elapsed  last: <tool> <age> ago  req <n>  sub <running>  $cost` (and a `total` line for several sessions on a TTY), with `STALLED?` appended when a running session has had no engine event for `--stall-min` minutes (default 8). On a TTY it redraws every 2 s; piped, it prints a line when a session changes; it exits 0 when every watched session has finished (no arguments: live sessions and those finished in the last 10 minutes). `status <id>` (human and `--json`) gains `idleMs` and `stalled: true` for running sessions by the same rule, and `wait` / `plan wait` pending lines carry `idleMs` (`stalled: true` when so). Nothing is done automatically. `zcode-agent cost [<dir>] [--app] [--json]` is covered under [Cost](#cost). `zcode-agent result <id> [--json] [--full]` prints a finished session's handback without waiting (exit 7 if it is still running). `zcode-agent status` without an id is one line for each of the 15 most recent sessions plus `… N more (zcode-agent status --all)`. `zcode-agent <command> --help` prints only that command's usage (under 2000 bytes); bare `zcode-agent --help` is the full reference. Usage errors are always a single line (`zcode-agent: unknown flag (did you mean …?)` for a mistyped option), never the help text.

&nbsp;

<details>
<summary><b>Options</b></summary>

| option | applies to | default | notes |
|---|---|---|---|
| `--id`, `--label` | run, task, agent | `zc-<random>` | session identity |
| `--detach` | run, task, agent, resume | off | background worker; prints the id |
| `--cwd` | run, task, agent | current dir | the workspace and blast radius |
| `--owns` | run, task, agent | whole workspace | repeatable path or glob |
| `--touch` | task | | repeatable; minimal edits outside `--owns`, reported as `touched` |
| `--allow-overlap` | run, task, agent | off | start despite overlapping ownership |
| `--task` | task | | JSON contract, markdown brief, or `-` |
| `--accept`, `--check`, `--file`, `--context` | task | | repeatable; `--context @file` reads a file (a `--file` also inlined this way is listed once) |
| `--decision`, `--decisions` | task | | repeatable binding decisions; `--decisions @file` reads a file |
| `--preflight` | task | off | read-only turn that returns the open questions; `resume <id> "<answers>"` then executes |
| `--unit` | task | | repeatable `"name: objective [owns a,b]"`; one subagent per unit |
| `--visual`, `--viewport`, `--serve` | task | viewports `390x844`, `1440x900` | an independent image-capable verifier screenshots the app and judges each criterion |
| `--max-repairs` | task, resume | `2` | repair turns after failing checks |
| `--check-timeout-ms` | task, resume | `300000` | per check; checks get `CI=1` when unset |
| `--model` | all turns | `glm-5.3-flash` | `glm-5.3` plus aliases `5.3`, `53`, `flash`, `5.3-flash`, `53f` |
| `--effort` | all turns | `max` | the model's levels: `low`, `high`, `max` |
| `--timeout-ms` | all turns; wait | run 600000, task 7200000 (2 h) | the whole invocation incl. checks and repairs |
| `--session` | run | | 0.3 compat: continue by zcode-agent id or engine `sess_` id |
| `--profile` | agent | `general-purpose` | subagent profile |
| `--mcp` / `--mcp-list` | run, task, agent | the app's servers | add MCP servers (inline JSON or `@file`); print the effective set |
| `--hermetic` | run, task, agent | off | leave out the app's MCP servers and skills (`ZCODE_HERMETIC=1` for every session) |
| `--no-browser` | run, task, agent | off | drop the `playwright` MCP server (the app's, or the default headless one) |
| `--skills` / `--no-skills` | run, task, agent | the app's skills | add skills; or run with none at all |
| `--inherit-desktop` | run, task, agent | off | also give the executor the app's `AGENTS.md`, plugins and agent profiles |
| `--install-browser` | doctor | off | install the Chromium build the default Playwright server drives |
| `--json`, `--full`, `--quiet` | all | | see Machine interface |
| `--any` | wait | off | return when the first listed session finishes |
| `--app` | cost | off | also count the desktop app's sessions in the directory |
| `--thinking` / `--no-thinking` | turns | run on, task off | mirror reasoning to stderr |
| `--stream`, `--include-reasoning` | turns | off | deltas in task events; full reasoning in the result |

Only `glm-5.3` and `glm-5.3-flash` are accepted; anything else exits 2 before any spawn. The effort levels each model accepts are read from the engine's builtin provider config (`zcode-agent doctor --json` lists them as `models`; a built-in table is the fallback). An unsupported model and effort pair, whether from `--effort`, the task contract, or a resumed session's stored setting, exits 2 with one line naming the supported values, before any engine is spawned.

</details>

<details>
<summary><b>Exit codes</b></summary>

| code | meaning |
|---|---|
| 0 | completed |
| 1 | unexpected internal error |
| 2 | usage error (bad flag, model, effort, contract, unknown or duplicate session id) |
| 3 | no API key (`ZAI_API_KEY`, `zcode-agent login`, or a key in the ZCode app) |
| 4 | engine or builtin provider config not found (reinstall: the engine ships with the package) |
| 5 | failed: engine or turn error |
| 6 | `agent`: no subagent dispatched or none ended `success` |
| 7 | workspace conflict, or the session is already running |
| 8 | partial, or checks still failing after repairs |
| 9 | unverified |
| 10 | blocked |
| 124 | `--timeout-ms` exceeded |
| 130 | cancelled |

</details>

<details>
<summary><b>Under the hood</b></summary>

**Key handling.** The key comes from the `ZAI_API_KEY` env var, then `zcode-agent login` (stored at `~/.zcode-agent/credentials.json`, mode 600), then the ZCode app's own Z.ai API key, read in place from its settings (`ZCODE_NO_DESKTOP_KEY=1` turns that off). The app's OAuth tokens are never read. The key is never printed or logged. Engine messages and check output are scrubbed before they are stored or shown. The only files the key ever lands in are each session's scratch provider config, which the engine requires to register the provider.

**Isolation.** This package's state lives under `~/.zcode-agent` (a pre-1.0 `~/.zcode-cli` is moved there on first run and left as a symlink), never under `~/.zcode`, which belongs to the desktop app. Each session's engine runs with `HOME` pointed at its own scratch directory. On every invocation zcode-agent rewrites the scratch config from your live desktop config: the provider rule with your key, the app's enabled MCP servers (minus OAuth-only remote ones and those that failed in the last six hours, recorded in `~/.zcode-agent/mcp-health.json`), and the app's user skills, symlinked ones included. The app's plugins, agent profiles (except the one `--profile` names) and global `AGENTS.md` are left out by default, because guidance written for interactive work (companion files to read, skills to load) was re-argued in the model's reasoning against the task contract; `--inherit-desktop` adds them. Every session gets zcode-agent's own executor instructions as `AGENTS.md`. The Playwright server runs isolated: a fresh browser profile per engine, so the implementer's and the verifier's browsers never share a lock or a cache. zcode-agent never touches the engine's database there, so sessions stay resumable. The desktop's `credentials.json` is never copied, and the live `~/.zcode` is never written. The engine's plugin cache is shared between sessions through a symlink.

**The engine.** `@zcode-agent/engine` (a pinned dependency) is the headless ZCode engine, `zcode.cjs`, built unmodified from [zai-org/ZCode](https://github.com/zai-org/ZCode) at the tag in `packages/engine/engine.json`, with the content plugins and bundled skills the app ships and upstream's `LICENSE`, `NOTICE.md` and third-party notices. `ZAI_CODE_ENGINE` points at another `zcode.cjs`; without the package, the ZCode app's own engine is used. `zcode-agent doctor` shows which engine runs and warns when its version differs from the tested one.

**Yolo mode.** Tool side effects are auto-approved, matching the engine's own headless default; `--cwd` is the blast radius. If a headless turn requests interactive input, the result is reported as `blocked` instead of hanging. The executor contract forbids commits, pushes, deploys, and other external side effects unless the task explicitly asks for them.

**Environment.** `ZAI_API_KEY`, `ZAI_CODE_HOME` (state root), `ZAI_CODE_ENGINE` (engine bundle), `ZAI_CODE_NODE` (engine interpreter), `ZAI_CODE_BUILTIN_PROVIDER_CONFIG`, `ZAI_CODE_LIVE_DIR` (desktop config dir, default `~/.zcode`), `ZCODE_HERMETIC=1`, `ZCODE_INHERIT_DESKTOP=1`, `ZCODE_NO_DESKTOP_KEY=1`, `ZAI_CODE_MAX_ACTIVE`, `ZCODE_PRICES` (cost rates, USD per M tokens), `ZCODE_APP_DB` (desktop DB for `cost --app`), `NO_COLOR`.

</details>

&nbsp;

## Development

An npm workspace with two packages: [`packages/cli`](packages/cli) (`zcode-agent`: plain CommonJS, no build step, no dependencies but the engine) and [`packages/engine`](packages/engine) (`@zcode-agent/engine`, built from upstream).

```sh
npm install                  # links the workspace
npm run build:engine         # builds packages/engine/dist from the pinned zai-org/ZCode tag (git + network)
npm test                     # unit suite: in-process, scripted fake engine, no CLI spawn, no API calls
npm run test:live            # functional suite: spawns the CLI against the real engine and GLM API
npm run accept:flash --workspace zcode-agent   # black-box acceptance runs (real API); also accept:subagent, accept:53
```

Live tests load the key from the repo `.env`, which is never committed or shipped. The design record and the wire-protocol facts pinned live are in `DESIGN.md` and `docs/BUILD-REPORT.md`.

## License

MIT for zcode-agent. The bundled engine is Apache-2.0 (upstream's license and notices ship inside `@zcode-agent/engine`). Source and issues: [github.com/0xgeorgemathew/zcode-agent](https://github.com/0xgeorgemathew/zcode-agent).

zcode-agent is an independent project, not affiliated with, endorsed by, or sponsored by Zhipu AI / Z.ai. ZCode and GLM are Z.ai's.

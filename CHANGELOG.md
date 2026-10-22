# Changelog

## Unreleased

- **Drawings.** The hero gives GLM-5.3 (builds and checks, green) and GLM-5.3-Flash (the verifier, blue) their own colours, and mentions `zcode-agent acp`; the ACP drawing marks Flash the same way. The README image URLs are pinned to a commit SHA, because raw.githubusercontent.com ignores a `?v=` query and kept serving the old file for up to five minutes.

## 1.2.1

The README drawings (hero and ACP) load with a `?v=1.2.1` query, so GitHub and npm refetch them instead of showing the images cached before 1.2.0. No code changes.

## 1.2.0

**GLM-5.3 at effort high is the default**, in the CLI and in `zcode-agent acp`. Both models stay available everywhere: `--model flash` (or the model picker in an ACP client) switches to GLM-5.3-Flash.

### Changed

- **Default model and effort.** Every command (`run`, `task`, `agent`, plans, resumed sessions without saved settings) now starts on GLM-5.3 at effort `high`. It was GLM-5.3-Flash at `max`. Contracts and plans that set `model` or `effort`, and the flags, still win.
- **Model picker.** ACP clients list GLM-5.3 first, then GLM-5.3-Flash; switching model keeps the effort level.
- **Images need Flash.** GLM-5.3 cannot read images, so with the new default the executor does not look at its own screenshots. The visual verifier is unaffected: it always runs a fresh GLM-5.3-Flash session. Pass `--model flash` when the executor itself should see images; an ACP prompt with images on GLM-5.3 says so and suggests Flash.
- **README.** New drawing for the ACP section (`docs/assets/acp-*.svg`, built by `build-acp.mjs`), and the hero now says GLM-5.3 builds and checks while Flash looks. Shared colours and fonts moved to `docs/assets/palette.mjs`. The orchestrator skills no longer tell the agent to expect Flash.
- Live tests that assert Flash (`run-flash`, `effort-flag`, `reasoning`, `agent`) pass `--model flash` explicitly.

## 1.1.0

**ACP support.** `zcode-agent acp` (or `zcode-agent-acp`) is an Agent Client Protocol (v1) agent on stdio, so T3 Code, Zed and any other ACP client chat with GLM-5.3 directly. Verified inside T3 Code through its ACP Registry provider (local command), with GLM-5.3-Flash reading, writing and running commands.

### Added

- **`zcode-agent acp`**: `initialize`, `authenticate`, `session/new`, `session/load` (history replayed: user and agent messages, reasoning, tool calls, the last plan), `session/list` (by cwd), `session/prompt`, `session/cancel`, `session/set_mode`, `session/set_model`, `session/set_config_option` and `session/close`.
  - **Updates sent:** message and thought chunks, tool calls (title, kind, locations, diffs for Write/Edit/MultiEdit, command output), the TodoWrite list as `plan`, `current_mode_update`, `config_option_update`, `session_info_update` (title) and `usage_update`. The usage update carries context used and size, plus the session's GLM cost at API list price.
  - **Config options:** mode (`build` asks before edits and commands, `edit`, `plan`, `yolo`), model (GLM-5.3-Flash, GLM-5.3) and effort (the levels the model accepts).
  - **Permissions:** engine permission requests become `session/request_permission`, with the engine's own options (allow once, always allow in this project, deny). ExitPlanMode becomes a switch-mode approval.
  - **Prompt input:** images, embedded resources and resource links; the client's MCP servers (stdio, HTTP, SSE) are added to the session.
  - **Lazy start:** the store record and the engine are created at the first prompt, so `session/new` probes leave nothing behind. No key → `session/new` fails with `auth_required`.
- **Every ACP session is a zcode-agent session** (`kind: "acp"`), with its own engine HOME, `$ZCODE_PORT` and tmp dir. `status`, `watch` and `cost` include it. The session's `AGENTS.md` is `assets/acp-agents.md`, written for a person watching (ask in the reply, use TodoWrite, no external side effects), instead of the headless executor rules.
- **`zcode-agent-acp` bin** for clients whose settings take only an executable (T3 Code's provider form). `--mode` and `ZCODE_ACP_MODE` set the default mode; `ZCODE_ACP_LOG=<file>` logs every frame.

### Fixed

- **Headless permission replies.** The reply carried an extra `resolvedAt`, which the engine's strict reply schema rejects. Live-probed: in any mode that asks, every tool was denied with "Permission request failed". yolo never asks, so 1.0 runs were unaffected. The reply is now the request's own allow-once response.

## 1.0.0

Renamed to **zcode-agent** (npm `zcode-agent`, command `zcode-agent`, `npx zcode-agent …`), and it now runs anywhere: with the ZCode app it needs no login, without it the engine ships as a dependency. Everything else (task contracts, the independent verifier, plans, briefs) is unchanged. 0.7.0 and 0.7.1 were never published under the old name; their changes ship here.

### Changed

- **Name.** Package `@0xgeorgemathew/zcode` → `zcode-agent`; command `zcode` → `zcode-agent` (no longer shadows upstream's own `zcode`); state `~/.zcode-cli` → `~/.zcode-agent`, moved on first run with a symlink left behind so pre-1.0 session paths still resolve. The repo is an npm workspace: `packages/cli` (zcode-agent) and `packages/engine` (@zcode-agent/engine).
- **No login with the ZCode app.** The key comes from `ZAI_API_KEY`, then `zcode-agent login`, then the app's own Z.ai API key, read in place (`ZCODE_NO_DESKTOP_KEY=1` turns it off). OAuth tokens are never read.
- **The app's MCP servers and skills are inherited by default** (0.7.1 was hermetic). Left out: OAuth-only remote servers (no headers, no key in the URL, not a known public endpoint), which can't sign in headless. Skills that are symlinks are followed; the orchestrator's own `zcode`/`zcode-agent` skill is never given to the executor. `--hermetic` (or `ZCODE_HERMETIC=1`) restores the 0.7.1 set; `--mcp-inherit` is accepted and does nothing. Plugins, agent profiles and the global `AGENTS.md` still need `--inherit-desktop`.
- **One dead MCP server no longer stalls every session.** The engine answers no RPC until its MCP connect settles (live-probed: one unreachable server held `session/send` for its full 30 s timeout, failing the run). The connect is now awaited, and inherited servers that fail are recorded in `~/.zcode-agent/mcp-health.json` and skipped for six hours (at once retried if their definition changes). Failures show in the feed as `mcp <name> failed`.
- **Executor instructions ship with the package** (`assets/executor-agents.md`, the session's `AGENTS.md`): headless rules, `$ZCODE_PORT`/`$ZCODE_OUT`/`$ZCODE_TMP`, no external side effects, and when to fan out to subagents (disjoint files only) or keep work in one agent. With `--inherit-desktop` the app's `AGENTS.md` is appended.
- **Standalone.** `@zcode-agent/engine` 0.16.9 is the headless ZCode engine built unmodified from zai-org/ZCode v3.15.1 (`npm run build:engine`; ~5 MB tarball with the app's content plugins and upstream's LICENSE/NOTICE). It is preferred over the app's engine; `ZAI_CODE_ENGINE` still overrides. App engine paths for Windows and Linux are probed too. Without the app, a pinned headless Playwright server (`@playwright/mcp@0.0.83 --isolated --headless --browser chromium`) serves the executor and the verifier; `zcode-agent doctor --install-browser` installs its Chromium.
- **Standalone provider config fixed.** Without an app config to copy, the synthesized `provider_config.json` lacked `modelConfigRules`, and the engine then registered no zai-api model (`session/create`: "Provider Registry 中不存在 Model: zai-api/GLM-5.3-Flash"). Verified end to end on a clean install with no ZCode app: a task with a visual criterion completed, verifier 4/4, $0.02.
- **Never interactive.** `login` refuses a terminal on stdin (pipe the key instead).
- **`doctor`** reports the key source, which engine runs (and the tested version), the inherited MCP servers and those skipped, inherited skills and the browser; exits 1 on node < 22.13 (the engine's `node:sqlite`).
- **Skills** (`zcode-agent skills install` replaces a pre-1.0 `zcode` skill): a Parallelizing section — units inside one session first, parallel sessions only for independent deliverables with disjoint paths, shared files owned by a scaffold, dependencies installed once, 2–4 concurrent sessions, and when not to split.
- Node ≥ 22.13 (was ≥ 20).
- README rewritten for any orchestrating agent, with a new hero diagram in light and dark versions (`docs/assets/build-hero.mjs` generates both).

### Measured (trivial `run`, this machine: 9 inherited MCP servers, 111 skills)

| | first-request input | wall |
|---|---|---|
| `--hermetic` (0.7.1 set) | 17.4k tokens | 9 s |
| inherited MCP servers, no skills | 32.4k tokens | — |
| inherited MCP servers and skills | 37.1k tokens | 10 s (45 s the first time, with one unreachable server) |

Inherited tools are re-sent with every request (mostly from cache): on a large desktop setup that is the cost of no setup. Trim the app's MCP servers, or pass `--hermetic`, when it matters.

## 0.7.1

Hermetic executor. The engine DBs of the White Credit v3 plan showed the CLI's long sessions were not a CLI-vs-desktop speed gap (same engine, same SQLite writes; engine start ~1 s, MCP connect ~1.4 s, all inter-request gaps 2.6–8.6 min of 50–94) but a handful of requests: in scaffold, landing and apply, 2–6 requests of 13–21 min each took 29–48% of model time, each drafting the whole build in its reasoning (176k chars, 188 code blocks in one) and re-arguing the desktop's `AGENTS.md` ("I must read CLOUDFLARE.md…") against the contract.

### Changed

- The executor is hermetic by default: no desktop `AGENTS.md`, user skills, plugins (`plugins.enabled: false`) or agent profiles (only the one `--profile` names). `--inherit-desktop` (or `ZCODE_INHERIT_DESKTOP=1`) mirrors them as before. Every v3 session had loaded the desktop-only `browser-use:control-browser` plugin skill, which the user-skill filter could not catch.
- The inherited Playwright MCP runs `--isolated` (fresh in-memory profile per engine) unless its args already pick a profile. The persistent profile in the session home caused "Browser is already in use" errors in verifier sessions (up to 12 a run) and the stale-cache rounds; the 0.7.0 cache wipe and CDP cache-disable step are removed.
- Verifier capture scrolls to the bottom of the page (steps from the page height) instead of at most 12 steps, which could miss the end of a long page on mobile.
- Verifier runaway guard raised from 80k to 200k streamed chars: a safety net far above any real request (peak ~36k), never applied to the implementer.
- Task prompt: "don't re-weigh the decisions or draft files in your reasoning".
- Skills: keep the plan's critical path short (the scaffold mounts every feature's stub; integration, if any, is a small cross-feature pass).

### Measured (live A/B, same 5-section static-site contract, 2 viewports, 3 visual criteria, Flash, effort high, run side by side)

| | 0.7.0 | 0.7.1 |
|---|---|---|
| wall time | 19.5 min | 16.7 min |
| first request input | 29.3k tokens | 19.1k tokens |
| desktop files read / mentioned in first reasoning | CLOUDFLARE.md read twice, 12 mentions | none |
| verifier | 10 requests, 5.4 min | 8 requests, 3.5 min |
| result | completed, checks pass, visual 8/8, 0 repairs | completed, checks pass, visual 8/8, 0 repairs |
| GLM cost | $0.087 | $0.073 |

One run each, so treat the margin as indicative. Both runs still spent their first request (6 min, ~60k chars of reasoning, 50–70 code blocks) planning the whole build before the first tool call: the hermetic home removes the distraction, not the habit.

## 0.7.0

Speed and cost, from a real four-session Flash plan (3 h 16 min, Opus $2.17, GLM $2.95). Per request the CLI matches the desktop app (time to first token 8–9 s vs 10–11 s, 40–46 vs 47–53 output tokens/s, 1–2.6 s between requests vs 2.6 s); the wall time was workload: the verifier made one tool call per model request (36–149 requests, 8–27 min a round), the implementer ran its own screenshot rounds before the verifier repeated them, and one first request reasoned for 20 minutes before its first tool call.

### Added

- `zcode cost [<dir>] [--app] [--json]`: GLM cost of every zcode session whose workspace is `<dir>` or below it, per session and in total, at Z.ai API list price (GLM-5.3-Flash $0.15 / $0.03 cached / $0.50 output per M; GLM-5.3 $1.40 / $0.26 / $4.40). Counts come from each session's engine DB (`model_usage`: implementer, subagents and verifier, across resumes) with cached input priced separately; sessions without a DB fall back to `usageTotal`, marked `~`. `--app` adds the desktop app's sessions opened in that directory. `ZCODE_PRICES` overrides rates. Uses `node:sqlite` (Node >= 22.5), else the `sqlite3` CLI.
- `zcode watch` shows each session's cost so far and, on a TTY with several sessions, a total line. While one model request streams it shows `thinking 12m 40k chars` (or `writing …`), so a long think is not mistaken for a stall (the session record's `activity.current`).

### Changed

- Verifier runaway guard: a live verifier request streamed reasoning to the engine's 128k-token cap over 20 minutes. zcode now ends a verifier attempt when one request streams more than 80k characters without a tool call (real requests peak near 36k) and retries once; still runaway gives `met: null` with the reason. (The engine's RPC model options accept only `reasoningLevel`, so there is no server-side cap.) The verifier is told to use only Bash and the Playwright MCP tools and to load no skills (it was loading the desktop's `browser-use` skill first).
- Verifier: captures everything in one Playwright run-code script per round (per viewport: wait for fonts and animations, scroll a window height at a time, one screenshot per step, plus named states), reads all PNGs in one parallel batch, and takes targeted extra shots only for unclear regions.
- Implementer (image-capable): no own screenshot rounds; one batched sanity capture, since the verifier judges. All task prompts: decisions are made, so don't draft every file in your head first; start writing and batch tool calls.
- Skills: the Claude Code orchestrator waits once in the background (`--timeout-ms 7000000`, Bash `run_in_background`) instead of 9-minute foreground slices (25 Opus calls in the run above); visual criteria go on sessions that build finished UI, not scaffolds, and integration sessions get only cross-cutting ones.
- README redesigned around a run sheet of the real plan.

### Fixed

- Verifier rounds judged stale pages: the Playwright MCP browser profile lives in the session home and kept its HTTP cache and storage across rounds, so a live round 2 saw the pre-fix HTML (http-server `max-age=3600`) and forced an extra repair. zcode now wipes the profile's cache and storage before each verifier round, and the capture script disables the cache over CDP.
- `verifier edited files` false positive: a parallel plan sibling that registered a few ms after this session was missing from the concurrent-ownership map during the verifier diff; live leases are now re-read before attributing changes.
- `package.json` listed the package itself (`@0xgeorgemathew/zcode@^0.4.0`) as a dependency, so every install pulled a nested 0.4.0 copy. Removed: zero dependencies again.

## 0.6.0

Independent visual verification and live progress, from a real run whose hero headline was invisible while the executor reported it visible: GLM-5.3 cannot see images (reading a PNG returns only an upload confirmation), so it judged from the DOM, and it graded its own work.

### Added

- `supportsImage(model)` (lib/models.js): read from the engine's builtin provider config (`modelRules[].config.properties.inputFormat.supportsImage`, last matching rule wins), fallback `{GLM-5.3: false, GLM-5.3-Flash: true}`. `zcode doctor` prints `images` / `no images` per model; `doctor --json` gains `vision: {id: bool}`.
- Independent visual verifier (lib/verify.js, lib/executor.js): for tasks with `--visual`, zcode opens a fresh engine session on the first image-capable model (GLM-5.3-Flash, effort `high`), which serves the app, screenshots every viewport into `$ZCODE_OUT/verify/<round>/`, looks at the images and answers with a `zcode-visual` block (`criterion, viewport, met, seen, note, shot`), plus a built-in readability criterion. Its entries are the authoritative `visual`; the implementer's claims move to `executorVisual` (full record only). Unmet entries trigger a repair turn to the implementer (shared repair budget) and a new round; a verifier that fails twice yields `met: null` and `partial` with `visual not verified`. New phase `verifying` (`verifying round N`); verifier turns count in `usage`; briefs carry `seen` (200 chars) for unmet entries.
- `zcode watch [<id>… | --plan <name>] [--stall-min 8]`: live one-line-per-session view (TTY redraw every 2 s, piped: print on change). `status` gains `idleMs`/`stalled`, `wait`/`plan wait` pending lines gain `idleMs`/`stalled`. The session record's `activity` gains `modelRequests`, `subagentsRunning`, `lastToolAt`; `phaseDetail` carries the repair attempt / verify round.

### Changed

- The implementer prompt depends on image support: a model that cannot see images is told not to judge screenshots or report `visual` and to self-check visibility in the DOM; one that can is told an independent verifier re-judges. The report-only visual follow-up is removed (the verifier replaces it). The `notVerified` line now reads "visual criteria judged by an independent <model> verifier from its own screenshots (M of N met)".
- Flash everywhere by default: agent profiles copied from the desktop into a session's engine home have a frontmatter `model:` naming GLM-5.3 or GLM-5.3-Flash rewritten to the session's model (prefix kept; the live files are never edited). README examples use the default model.

## 0.5.2

Fixes from a real orchestrated run: smaller briefs, friendlier plan files, long tasks that survive, quieter discovery.

### Changed

- Briefs carry failing checks only (`checksPassed: N` counts the rest) and unmet visual entries only (`visualMet: "M/N"` always when visual was declared; criterion clipped to 160, note to 300). `decisions` are capped at 6 (`{what: 160, why: 120}`, `decisionsMore: K`), `files` at 40 (`filesMore: K`) and exclude files attributed to a concurrent session; question options are clipped to 300. The full record (`result.json`, `--full`) is unchanged.
- Default task timeout is 2 h (`7200000`, was 30 min); run/agent unchanged. A timeout's error message says how to continue: `zcode resume <id> "continue"` (plan sessions: `zcode plan resume <name> "continue"`).
- `zcode <command> --help` prints only that command's usage and flags (under 2000 bytes; `zcode plan --help` covers the subcommands). `zcode --help` keeps the full text.
- `zcode status` lists the 15 most recent sessions and one `… N more (zcode status --all)` line; `--all` lists everything. `--json` is unchanged.

### Added

- Plan files: `@file` in `decisions`/`context` resolves next to the plan file, then against the plan's cwd (same fallback for `--task contract.json`: contract dir, then `--cwd`); the error names both paths. Per-session `label` (session label becomes `plan:<name> <label>`). Top-level `limits` (timeoutMs, maxRepairs, checkTimeoutMs) default every session; a session's own limits win per key. Taken ids print one trailing `hint:` line instead of repeating advice per id.
- `plan run --preflight`: a session with `after` gets a short paragraph naming the upstream sessions (id + objective, 200 chars) that have not run yet, so it does not ask about their absence.
- Usage accounting survives failures: model requests are counted per turn (also on timeout/failure); the full result `usage` gains `modelRequests` and `incomplete: true`; the session record accumulates `usageTotal` across resumes (full result includes it, the brief does not).
- Target-repo hygiene: at task/run/agent start in a git workspace, `.zcode/` and `.playwright-mcp/` are appended to the repo's local exclude file (`git rev-parse --git-path info/exclude`; never `.gitignore`).

## 0.5.0

Quiet orchestration: the orchestrator reads less, decides once, and the executor stops guessing.

### Breaking

- `--json` now prints the **brief** (schema `zcode.brief/1`) as the final line. Use `--full` for the old full record (`zcode.result/1`). `result.json` on disk is always the full record.

### Added

- Brief output by default (one compact result); `--full` and `zcode result <id> [--full]` for the whole record.
- One-line `wait` timeout; `wait --any` returns on the first finished session.
- Quiet errors: usage errors are one line; `--quiet` drops progress.
- Effort/model validated against the engine's levels before any spawn (exit 2).
- Per-session `ZCODE_PORT` / `ZCODE_OUT` / `ZCODE_TMP` env for parallel-safe sessions; `.zcode/` and `.playwright-mcp/` are never reported as task changes.
- `--touch` for minimal edits outside `--owns`, reported as "touched".
- Decisions: `--decision` / `--decisions`, structured questions (`q`/`options`/`recommend`), and executor-reported decisions in the handback; dedupe of repeated context/files.
- Missing `visual` results trigger one cheap report-only follow-up (no repair budget) before any visual repair turn; the prompt says every declared criterion must be reported.
- `--preflight`: read-only pass listing the open questions before any edit.
- `--unit "n: goal [owns a,b]"`: one subagent per unit inside a session.
- Visual verification: `--visual`, `--viewport`, `--serve`; screenshots judged per criterion, results in the brief.
- `zcode plan check|run|wait|status|resume`: a DAG of task sessions with shared decisions/context.
- Orchestrator skills rewritten for decide-once orchestration.

### Fixed

- Playwright MCP scratch files in `--cwd` no longer turn visual sessions `partial`.
- `plan wait` timeout prints a single line in human mode.
- Live tests updated for engine 0.16.9 (default playwright MCP server, no `state.updated` mode frame) and a bad require path.

### Measured (`node scripts/measure.js --compare docs/baseline.json`)

| Gate | Result |
| --- | --- |
| result <= 20% of baseline | 480 B vs 2970 B (16.2%) |
| wait timeout <= 120 B/session | 192 B for 2 sessions (96 B each; baseline 1518 B) |
| prompt (bare contract) <= baseline + 400 B | 6389 B vs 5995 B |
| prompt as sent <= baseline + 800 B | 6734 B vs 5995 B |
| wall time <= baseline +5% (+300 ms) | 310 ms vs 299 ms |

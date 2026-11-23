# Changelog

## 1.4.0

GLM-5.4 becomes the default model, and a full audit of the code fixed what it found. Three changes can alter what an existing caller sees; they are marked **Changes behaviour**.

### Added

- **GLM-5.4, the new default.** **Changes behaviour.** Z.ai released GLM-5.4 on 23 November 2026, and every command, plan and `zcode-agent acp` session now runs on it at effort `high`. It reads images, so the executor can look at its own screenshots and at images attached in ACP clients, and it has a 1M context. `--model glm-5.4` (or `5.4`, `54`) selects it; GLM-5.3 and GLM-5.3-Flash stay one `--model` away. A run without `--model` used GLM-5.3: pass `--model glm-5.3` to keep it. No ZCode engine release lists GLM-5.4 yet, so zcode-agent registers it on the Z.ai provider of each session's own engine config, the way the ZCode app registers a model you add by hand, and stops once the engine lists it itself. Checked against the real engine and API on release day: `npm run test:live` runs it with and without the ZCode app's config, resumes a session on it and has it read a number out of an image.
- **ACP: GLM-5.4 in the model picker**, first and selected by default. The agent's title no longer names a single model, and the picker no longer labels one model "default" (`--model` decides that per agent).
- **ACP `session/resume`.** Reopens a session without replaying its history, for a client that already shows the conversation. `session/load` still replays.
- **A typo is not a prompt.** A single bare word one or two letters away from a command name (`stauts`) exits 2 with the correction instead of being sent to the model as a prompt; `zcode-agent run <word>` sends it anyway. An unknown single-dash flag exits 2 too, and `-v` prints the version.
- **`status --json --all`** lists every session; `--all` only affected the human listing and JSON stopped at 50.
- **`npm run accept:54`** (`scripts/accept.js glm54`), the acceptance run for the default model.

### Changed

- **The visual verifier stays on GLM-5.3-Flash.** It used the first image-capable model; with GLM-5.4 able to see, that would have moved every verifier round to the larger model. It now prefers the cheapest one.
- **GLM-5.4 is priced provisionally.** Z.ai has published no API price for it. `cost` and `watch` price it at the GLM-5.3 list rate and mark every amount that includes it with `~` (the ACP usage update carries the same amount; the protocol has no field for the marker). A rate given in `ZCODE_PRICES` is used as is and not marked.
- **A check ends when its shell exits.** **Changes behaviour.** A check such as `npm run preview & sleep 2; curl -f localhost:$ZCODE_PORT` hung until the check timeout, because the background server kept the output pipe open, and was then reported as timed out and repaired for nothing. The check now finishes with its shell, and whatever it left running is stopped with it.
- **Running out of time is always a timeout.** **Changes behaviour.** `--timeout-ms` now bounds engine start as well (a 2 s timeout used to wait out the engine's own 30 s and exit 5), no prompt is sent with no time left, each check gets the time the run has left when that is less than `--check-timeout-ms`, and running out before a repair turn or the visual verifier exits 124 with the `resume … "continue"` hint. Those cases used to end `checks_failed` (8) or `partial`.
- **Ownership globs own their subtree.** `--owns 'packages/*'` now covers `packages/a/src/x.ts`, as a plain path covers what is under it and as the overlap check always assumed. Before, only direct children matched and every deeper edit was a scope violation.
- **`--mcp-list` redacts credentials.** Header, environment and URL secrets print as `***`, and the Z.ai key is removed wherever a server definition carries it.
- **ACP stop reasons.** An engine turn that ends `cancelled` returns `stopReason: "cancelled"`, and `error_max_turns` / `error_max_tool_calls` return `max_turn_requests`. Before, `cancelled` was a JSON-RPC error, and any result type containing "max" or "limit" (`error_max_budget` too) became `max_turn_requests`. A prompt stopped by the agent's own `--timeout-ms` ends `cancelled` with a line in the conversation, not as an error.
- **`plan` refuses flags it would drop** (`--hermetic`, `--no-browser`, `--mcp`, `--skills`, `--no-skills`, `--inherit-desktop`, `--stream`, `--include-reasoning`): plan sessions were started without them.
- **`doctor` reports the setup a run with the same flags would get**: it honours `--hermetic`, `--no-browser`, `--mcp`, `--skills`, `--no-skills` and `--inherit-desktop`, and separates servers skipped for OAuth from those skipped for failing recently (all were labelled OAuth).
- **`--max-repairs` and `limits.maxRepairs` must be whole numbers**, `limits.timeoutMs` / `limits.checkTimeoutMs` below 1 are refused, and a contract list entry that is an object is refused instead of becoming the text `[object Object]` (a check written as `{"command": …}` ran as that string).
- **A preflight is `completed` only when it reports `done`**; one that reports `partial` or an unknown status without questions is `unverified`.
- **A timeout under a minute says seconds** ("timed out after 20 s", not "0 min").
- **Help:** `--hermetic` replaces `--mcp-inherit` (which only affects `acp`) in the `run`/`task`/`agent` help, `--inherit-desktop` is described as AGENTS.md, plugins and agent profiles, `--hermetic` says the Playwright server stays, and the plan section lists `--cwd`.
- **README rewritten** around GLM-5.4, with every claim checked against the code: the model table, what was measured on release day, glob and check semantics, the event list, exit codes for plans, and the brief example.

### Fixed

- **A resumed session could lose its task.** A `run` or `agent` session that never reached the model (queue timeout, engine start failure) was resumed with only your message, the literal text `continue` in the documented case. Its prompt is now kept with the session and sent first. A preflight resume that was refused or failed before the engine opened used to be recorded as "no longer a preflight", so the next resume skipped the task prompt and the checks; it now stays a preflight until the engine session is open.
- **Scope violations excused by a session that never ran.** Any session record updated during a run counted as "concurrent", so a detached start that was refused for a conflict, or a read-only preflight, excused this session's edits inside its declared paths. Only a session that actually ran can own a change now.
- **ACP: a mode change while the engine was starting never reached it.** With `acp --mode yolo`, switching to `build` in the first seconds of a session left the engine in full-access mode while the client showed Ask. The change now waits for the engine.
- **ACP: loading a session another agent has open** was refused but marked that agent's running session `finished`. The refused load now writes nothing.
- **ACP: a finished edit lost its diff.** The result update's content replaced the diff sent with the tool call; it now carries both.
- **ACP: a reply in flight is delivered when the client disconnects.** Closing stdin exited at once and could drop a prompt's response; running prompts are now stopped and answered first (bounded to 3 s).
- **ACP: `session/close` on a session that is not open succeeds**, as the protocol asks, and an empty prompt no longer starts an engine and writes a session record.
- **ACP: `--effort medium` was silently replaced by the model's highest level.** It is a usage error (exit 2), as everywhere else.
- **An engine that died while connecting MCP servers** passed for an open session and failed on first use with no retry (after 20 s of polling when `--mcp` servers were given). It now fails the start, which is retried once.
- **`plan resume --detach` on a running plan** replaced the live supervisor's pid with a process that exited at once, so the plan read `interrupted` between stages and `plan wait` could exit 8. A plan with a live supervisor keeps it.
- **A plan file saved mid-edit** no longer ends the detached supervisor or `plan wait` (exit 2); both keep the last good read. `plan resume` no longer stops at the first session that refuses, which left the sessions it had already resumed without a supervisor.
- **One dead MCP server was counted once per engine start**, so a single run with a verifier round put it on the 24-hour back-off instead of the documented six hours. It is counted once per run; the stored error text is scrubbed and the file is mode 600.
- **One broken skill failed every session.** A dangling symlink or link loop inside any skill in the ZCode app's skills directory made every non-hermetic session die with a raw `ENOENT`. Dangling links are left out, a skill that still cannot be copied is skipped, and `doctor` names it.
- **Change tracking in git repos:** a deleted untracked file was reported `modified`; an untracked symlink to a directory was reported `modified` whenever anything changed inside its target (a false scope violation); and a snapshot could hold `index.lock` against a `git add` running at the same time.
- **An absolute `--owns` path through a symlinked directory** was rejected as "outside the workspace".
- **Resuming a session whose workspace was deleted** exits 2 with a message instead of a stack trace.
- **A handback or verifier block whose text contains a code fence** was cut at that fence and rejected as invalid JSON, spending the one handback-request turn.
- **A check killed by a signal** is reported as `killed by SIGSEGV` (it read `exit null`).
- **Token usage of a turn that ends with a non-success result is counted** in `usage` and `usageTotal`, and ACP sessions record their model request count (it was always 0, and nothing for a cancelled or timed-out turn).
- **A second Ctrl-C no longer leaves the engine running.** The second signal exits at once, which skipped the clean-up: an engine that had not answered the stop request kept running tools in your workspace, in yolo mode, with nothing to stop it. Engines and checks still alive when zcode-agent exits, by any path, are now killed with it.
- **Closing the terminal stops the run.** SIGHUP is handled like SIGINT and SIGTERM: the engine is told to stop and the session ends `cancelled`, instead of a yolo-mode engine running on. A cancel during engine start now takes effect at once.
- **`--timeout-ms` above 2147483647 no longer times out at once** (Node fires larger timers immediately); it is capped at that value, on resume too.
- **`wait` on a detached run that never started** exits with that run's code (3 no key, 2 not found) instead of 5, and a detached resume that loses the race for a session no longer marks the session `failed` while the other process runs it.
- **The API key cannot reach `issues` or MCP events.** Engine and MCP error text copied into a result's issues, and the error of an `--mcp` server's `mcp` event, are scrubbed like the error message already was.
- **ACP sessions read `completed` in `result`, `wait` and `plan` briefs** between prompts and after closing, and an interrupted one is no longer told to `zcode-agent resume` (which refuses ACP sessions).
- **`cost`:** usage of a model with no known price showed as `$0.00` with nothing to say so; it is flagged `+?` and named. `cost --app` reads the app directory every other command uses (`ZAI_CODE_LIVE_DIR`) and no longer counts sibling directories whose names differ only where yours has `_` or `%`. `999,999` tokens print as `1.0M`, not `1000.0k`.
- **`resume <id> -p "message"`** looked up a session named by the message; `-p` is the message there.
- **`--mcp-list` shows what a run would use:** it reads `ZAI_CODE_LIVE_DIR` and skips servers that failed recently, as a run does.
- **`watch --plan` on a plan whose file is gone** prints one line and exits 2 instead of a stack trace.
- **ACP resource links to non-file URIs keep the URI** in the prompt; only the name reached the model.
- **Copies of the ZCode app's `v2` settings files in a session's engine home are mode 600**; they can hold the app's provider keys and were created with the default mode.
- **README drawings** point at `main`; they were pinned to a commit that is not in the repository's history.
- **Tests:** the unit suite passes with the engine built and no ZCode app installed (one test assumed an app), and when the temp directory is inside a git checkout; a price assertion that could not fail does; the live suite no longer depends on which MCP servers this machine's ZCode app has, and the GLM-5.3 acceptance test reports a timeout instead of crashing on it. `npm run accept:subagent` asks for the model it checks for (it expected Flash on the default model and could not pass).

### Removed

- The `sqlite3` command-line fallback in `cost` (unreachable since Node 22.13, the minimum, ships `node:sqlite`).
- Unused code: `resolveKey` (`lib/key.js`), `APP_BUNDLE_ENGINE` (`lib/engine.js`), an engine-client hook nothing set, two turn fields nothing read, the ACP agent's stored client capabilities, and 39 exports no other module imports.
- `docs/BUILD-REPORT.md` (the 0.2.0 build report, which described files that no longer exist).
- A stray `"dependencies": {"zcode-agent": …}` at the workspace root (a self-reference from an `npm install` at the root). `scripts/release-check.mjs` now refuses a root with dependencies, a version with no changelog entry, notes left under "Unreleased", and a version that is already tagged.

## 1.3.1

### Fixed

- **`provider_config.json` without a `zai-api` rule no longer breaks every engine start** ([#2](https://github.com/0xgeorgemathew/zcode-agent/issues/2)). Signed in with a coding plan, the ZCode app keeps an empty `~/.zcode/v2/provider_config.json` (`providerRules: []`) and recreates it if deleted. 1.3.0 copied that file and threw `no zai-api rule found`, so `zcode-agent doctor` crashed and no ACP session could start its engine. Now a copy that has no `zai-api` rule, or can't be read, is replaced with the same config a machine without the app gets, holding the package's key. A copy that has the rule is still pruned to it and re-keyed, as before.

### Changed

- **README drawings redrawn.** Both drawings embed their fonts (IBM Plex subsets, about 30 KB, SIL OFL; `docs/assets/fonts`) instead of relying on the viewer's system fonts. The headlines are set at their natural width; before, they were squeezed to fit, which distorted them where Avenir Next Condensed was missing. The hero adds the task contract as your agent writes it, and labels its stages BUILD, CHECK and LOOK so the drawing no longer needs a legend. The repair is drawn as a loop, and the handback as a chip on the line home. The ACP drawing adds a prompt and an approval card, a picker row per setting, and a note that the engine starts when the session opens.

## 1.3.0

Faster starts, for ACP sessions and CLI runs alike, and a leaner ACP context: sessions no longer carry the ZCode app's MCP servers by default.

### Faster

- **ACP: the first prompt doesn't wait for the engine.** A new session's engine starts 1.5 s after `session/new` (`ZCODE_ACP_PREWARM_MS`, or `off`). Measured against the real engine: the prompt reached the model 0.3-1.4 s after it was sent, down from 4-9 s. The session record is still written only at the first prompt. A session closed before it, or a client gone, removes the engine and its dir; dirs left by a killed agent are cleaned up by the next one. Probes that exit within the delay start nothing.
- **ACP: leaner context.** Sessions get the client's MCP servers and Playwright, not the ZCode app's other servers, whose tool lists rode along on every model request. Measured: the first request went from about 33.5k to 21.8k input tokens. `--mcp-inherit` or `ZCODE_ACP_INHERIT_MCP=1` restores them.
- **Shared skills.** The app's skills are copied once into `~/.zcode-agent/shared/skills/<hash>` and linked into each session, instead of copied per session on every run: setup went from 300-550 ms to about 50 ms, and a session dir from ~15 MB to ~1 MB. Editing a skill makes a new snapshot; snapshots unused for two weeks are deleted.
- **Engine compile cache.** The engine starts through `lib/engine-boot.js` with Node's compile cache in `~/.zcode-agent/compile-cache`: about 150 ms less per engine start (median ~640 ms vs ~790 ms). Not passed on to the commands the engine runs. `ZCODE_NO_COMPILE_CACHE=1` turns it off.
- **Visual verifier.** Its engine now starts while the acceptance checks run, so a verifier round no longer waits ~2.5 s for an engine and its MCP servers. It is killed when the checks fail.
- **MCP servers that keep failing** are skipped twice as long after each failure (6 h, 12 h, 1 d, 2 d, then 4 d), so a dead server costs a 30 s connect every few days instead of four times a day.

### Changed

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

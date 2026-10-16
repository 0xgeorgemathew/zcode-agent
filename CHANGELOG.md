# Changelog

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

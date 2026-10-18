---
name: zcode-agent
description: Delegate scoped implementation work to the zcode-agent CLI (cheap GLM-5.3-Flash executor: sees images, has Playwright; an independent vision verifier judges UI) and consume its compact verified handback. Use when you are orchestrating: you make the product, design and logic decisions once, then zcode-agent implements, tests, visually verifies and repairs — in one session with subagent units, several parallel sessions, or a dependency plan — while you spend tokens only on decisions and exceptions.
---

# Operating zcode-agent as an executor

zcode-agent is a CLI execution engine. You decide; it builds. It implements a scoped task in its own session, runs your checks itself, has a fresh, independent vision verifier screenshot and judge UI when you ask, repairs failures within a budget, and returns a small structured handback.

**The point is cost.** Your tokens are the expensive ones; GLM-5.3-Flash's are cheap. Your tokens go to decisions and exceptions. Everything mechanical — writing code, running builds and tests, reading diffs, looking at screenshots, fixing small failures — is zcode-agent's. If you are doing any of that after dispatch, you are paying twice.

Check readiness once per machine: `zcode-agent doctor` (exit 3 → no key: the user runs `zcode-agent login` or sets `ZAI_API_KEY`; with the ZCode app installed its key, MCP servers and skills are used automatically). Don't run `--help` or a bare `zcode-agent status`: everything you need is here.

## The workflow

1. **Read** the codebase as much as you need to plan. This is the one phase where reading files is expected.
2. **Decide** everything a user could see or a system depends on (checklists below). Write the decisions down once, as decisions — a file such as `docs/decisions.md` that sessions receive with `--decisions @file`.
3. **Shape** the work: one session, one session with units, parallel sessions, or a plan (see Parallelizing).
4. **Preflight** (optional): `--preflight` makes zcode-agent list every question it would otherwise guess; answer them all in one edit to the decisions file. It costs you a round trip, so use it only when your decisions have known gaps or the work is large and novel; skip it when the checklists below are fully covered.
5. **Dispatch and wait** with `--detach` + `zcode-agent wait`, or `zcode-agent plan run` + `zcode-agent plan wait`.
6. **Handle exceptions only.** `completed` → move on. Anything else → read only what the brief shows, answer or adjust in one line with `zcode-agent resume`.

## Deciding: leave nothing open-ended

The executor implements binding decisions exactly and is told not to invent anything user-visible or behavioural. Gaps either block it (a round trip for you) or get the most conservative default. Close them up front.

**Front end:** palette (exact values), type families and scale, spacing scale, radii, iconography/illustration style; every section's layout and hierarchy at each breakpoint you care about; exact copy; component states (hover, focus, active, disabled, loading, empty, error); motion (what moves, property, distance, duration, easing, stagger, trigger, reduced-motion behaviour); accessibility (focus order, traps, labels, contrast floor); stack and libraries; performance budget.

**Back end / logic:** data shapes and storage keys; API routes, payloads, status codes and errors; validation rules (exact regexes, ranges); state machines (steps, transitions, what persists, what resets); auth and permissions; idempotency and retries; what is mocked vs real; side effects that are forbidden.

**Boundaries:** what the executor may choose freely (internal names, file structure, helpers) and what it must ask about.

Keep the decisions file dense: tables and one-line statements, no prose, no rationale the executor doesn't need (aim for a few thousand tokens for a one-page site). Write decisions as statements, not wishes: "Reveal: opacity 0→1 and translateY 16px→0, 400 ms, cubic-bezier(.2,.7,.2,1), 60 ms stagger, at 20% visibility; reduced motion: opacity only."

## Parallelizing

Parallel work can cut wall time a lot, but it is optional: one well-specified session is always correct. Split only when the work really splits, and never at the cost of a session finishing without you. Two levels, cheapest first:

1. **Units inside one session** (`--unit "name: objective [owns a,b]"`). The executor runs one subagent per unit and integrates the result. One engine, one verifier pass, shared context, no extra briefs for you to read. Use it when the pieces share decisions and context but write separate files: one page's sections, one module's functions, a component set.
2. **Several sessions** (`--detach` each, then one `wait` on all ids), or a **plan** when there are dependencies. Each session is a separate executor with its own context, port, verifier and brief. Use it when the pieces are independent deliverables.

| the work | shape |
|---|---|
| one deliverable, small or tightly coupled | one session, no units |
| one deliverable with 3–6 separable parts that share decisions | one session + units |
| 2+ independent deliverables that own disjoint paths | parallel sessions |
| a shared base first (scaffold, schema, design tokens), then parallel features | a plan with `after` |

**Split only when all of these hold:**
- Every concurrent session (and every unit) owns disjoint paths. Overlap is refused (exit 7; `plan check` catches it).
- Shared files have one owner: `package.json`, lockfiles, router, app shell, global styles, config. Give them to a scaffold session that runs first and mounts a stub for every feature, so feature sessions need no wiring. A later session may `--touch` a shared file only for a tiny edit no running session owns.
- Dependencies are decided and installed up front, by one session. Parallel sessions must not add packages: concurrent installs race on the lockfile.
- No piece needs a decision another piece will make. Put every shared decision in the decisions file all sessions receive.
- Each piece is big enough to pay for itself: a session costs startup plus its own verifier round (minutes) on the critical path. A 5-minute fix is one session.

**Keep it bounded.** 2–4 concurrent sessions is the useful range; past that they contend for the GLM rate limit and the machine (each runs its own engine, MCP servers, builds and browser), and sessions beyond `ZAI_CODE_MAX_ACTIVE` (8) queue. Units: 2–6 per session.

**Keep the critical path short.** Each `after` stage waits for a whole session (tens of minutes). Prefer one wide stage over a chain. Integration, if you need one at all, is a small pass (cross-feature checks, fix only what breaks between features), not a rebuild.

Visual criteria cost a verifier round (minutes of Flash time on the critical path), so put them where finished UI is built. A scaffold of stubs gets checks only; an integration session gets only cross-cutting criteria (the whole page in order, anchors, the dialog opening from every button), not a re-check of what the feature sessions' verifiers already passed.

Parallel safety is automatic: each session gets `ZCODE_PORT`, `ZCODE_OUT`, `ZCODE_TMP` and `ZCODE_SESSION_ID`. Tell the first (scaffold) session to make dev-server ports, build output dirs and test artifacts honour them. zcode-agent keeps `.zcode/` and `.playwright-mcp/` out of git via the repo's local `.git/info/exclude`; you don't need to touch `.gitignore` for them.

Parallel sessions cost you little extra while they run: one `wait` on all of them (or `plan wait`) covers every session, and you read one brief per session at the end.

## The handoff

| field | flag | give it when |
|---|---|---|
| objective | positional text | always: the outcome, not the steps |
| decisions | `--decision "…"`, `--decisions @file` | always for anything user-visible or behavioural |
| checks | `--check "cmd"` | always: build, typecheck, tests, lint, greps — zcode-agent runs them itself |
| visual | `--visual "criterion"`, `--viewport WxH`, `--serve "cmd"` | any UI work: after the build, a fresh vision verifier serves on $ZCODE_PORT, waits for animations to finish, screenshots each viewport, quotes the text it can actually see, judges each criterion (plus "all intended text is readable"), and unmet ones go back to the implementer for repair. Phrase criteria as what must be visible: "hero headline 'Your money, simplified' is fully readable at 390 and 1440" |
| units | `--unit "name: objective [owns a,b]"` | one session should fan out to subagents (see Parallelizing) |
| owns | `--owns path/glob` | always when other sessions may run in the same repo; must be disjoint from every concurrent session |
| touch | `--touch path` | a small edit to a shared file no running session owns |
| files | `--file path` | files to read first (don't also pass them as `--context @`) |
| context | `--context "…"` / `--context @file` | background that isn't a decision |
| acceptance | `--accept "…"` | criteria beyond checks and visuals |
| everything | `--task contract.json` | keys: objective, scope, constraints, decisions, design, acceptance, checks, visual, viewports, units, files, references, context, owns, touch, limits, model, effort |

Environment: by default the executor gets the ZCode app's MCP servers and user skills (OAuth-only remote servers excluded) plus zcode-agent's own executor instructions; `--hermetic` gives it only your `--mcp` servers and `--skills`. Leave the default unless a run needs to be reproducible on another machine.

Model and effort: don't pass `--model`. Everything runs on GLM-5.3-Flash by default (it sees images): sessions, units, plans, the verifier. Use `--model glm-5.3` only when the user asks for it; it can't see images. `--effort low|high|max` (default `max`). Other values are refused before anything starts.

## Running

```sh
zcode-agent task --detach --id <id> --cwd <repo> [flags] "<objective>"   # prints the id, returns at once
zcode-agent wait <id…> --timeout-ms 540000 --json --quiet                # 124 = still running (one line each): wait again
zcode-agent wait <id…> --any --timeout-ms 540000 --json --quiet          # return on the first that finishes
zcode-agent resume <id> "<answer or follow-up>" --detach                 # same session, context intact
zcode-agent result <id> [--full]                                         # brief again, or the full record
zcode-agent cancel <id>
```

Plans:

```sh
zcode-agent plan check plan.json
zcode-agent plan run plan.json --detach [--preflight]
zcode-agent plan wait <name> --timeout-ms 540000 --json   # one summary line per session; details only for non-completed
zcode-agent plan resume <name> ["<message>"]              # resume failed/partial, relaunch skipped
zcode-agent plan resume <name> --session <id> "<answer>"  # answer one blocked session
```

`plan.json`: `{"cwd"?, "decisions"?, "context"?, "files"?, "model"?, "effort"?, "limits"?, "sessions": [{"id", "after"?: [ids], "label"?, ...contract keys}]}`. Top-level decisions/context/files/limits go to every session; `@` entries resolve against the plan file's directory, then the plan's cwd. Don't also list the decisions file under `files`: it is already inlined. The plan name is the file basename (or `--id`). Sessions that can run at the same time must own disjoint paths; `plan check` enforces it. When an upstream session ends non-completed, its dependants are `skipped` until you `plan resume`.

Session ids are global and permanent: give every new run a fresh prefix (`wc3-scaffold`, …) so `plan check` passes first time. A task session may run 2 h by default; a big session (a whole page, a whole flow) can set `"limits": {"timeoutMs": 10800000}`. If one still times out, `zcode-agent plan resume <name> "continue"` picks up from the files it already wrote.

While sessions run, the user can watch them with `zcode-agent watch` (live phase, last tool, model requests, GLM cost so far, `STALLED?` after 8 idle minutes) and total a directory with `zcode-agent cost`; you never run either. `wait` timeout lines carry `idleMs`/`stalled`: a stalled session is the one case to `cancel` + `resume` early.

Real tasks outlast a single shell call; always wait in bounded slices. zcode-agent needs network access (the GLM API) and write access to `~/.zcode-agent` and the target repo: in a sandboxed Codex session, if a command fails with a sandbox or network error, re-run the same command with escalated permissions instead of changing it.

## Reading the brief

`--json` prints one compact line: `status`, `summary`, `files`, failing `checks` with tails (`checksPassed` counts the rest), `questions`, `issues`, `unresolved`, `scopeViolations`, `touched`, the first `decisions` (`decisionsMore` counts the rest), unmet `visual` with what the verifier actually `seen` (`visualMet` is "met/total"), `units`, and `result` (path to the full record). Read it straight from the command output; don't pipe it through jq, python or tail.

| status | exit | do |
|---|---|---|
| `completed` | 0 | nothing. Skim `decisions` (the executor's own in-scope choices); veto with `resume` only if one is wrong |
| `blocked` | 10 | answer `questions` (they come with options and a recommendation) via `zcode-agent resume <id> "<answer>"`, and add the answer to your decisions file |
| `partial` | 8 | read `issues` / `unresolved` / unmet `visual` / `scopeViolations`; resume with one-line guidance or re-scope |
| `failed` | 8/5/124 | read the failing check `tail` or `error`; resume with guidance |
| `unverified` | 9 | you forgot checks: resume with a check added |
| `cancelled` | 130 | resume if wanted |

## Hard rules after dispatch

- Don't open files a `completed` session changed. Don't re-run checks it ran. Don't look at its screenshots.
- Don't poll `status`; use `wait` (or `plan wait`) once, in the background if you like, and act on its exit.
- Don't fix code yourself; `resume` the session with one line.
- Need to know something about the result? `zcode-agent result <id> --full` first; read code only as a last resort.
- Don't ask zcode-agent to commit, push, publish or deploy unless the user asked; when they did, make it its own final session gated on everything else being `completed`.

## Example: a marketing one-pager with an application form

You read the empty repo, decide the design system, copy, motion, form logic and demo constraints, and write `docs/decisions.md`. Then `plan.json`:

```json
{
  "decisions": ["@docs/decisions.md"],
  "effort": "high",
  "sessions": [
    {"id": "scaffold", "owns": ["package.json", "package-lock.json", "index.html", "*.config.*", "tsconfig*.json", "src/app/**", "src/styles/**", "src/components/**", "e2e/smoke.spec.ts", ".gitignore"],
     "objective": "Vite + React + TS scaffold, tokens, shared shell, stubs for src/landing and src/apply; dev/preview/e2e honour ZCODE_PORT and ZCODE_OUT",
     "checks": ["npm run build", "npm test", "npm run e2e"]},
    {"id": "landing", "after": ["scaffold"], "owns": ["src/landing/**", "e2e/landing.spec.ts"],
     "objective": "All landing sections per the decisions",
     "units": ["hero: …", "highlights: …", "products: …", "how: …", "charges: …", "faqs: …", "about-cta: …"],
     "checks": ["npm run build", "npx playwright test e2e/landing.spec.ts"],
     "visual": ["hero headline fits on two lines at 390px", "product cards align on one row at 1440px", "no text overlaps any circle motif"]},
    {"id": "apply", "after": ["scaffold"], "owns": ["src/apply/**", "e2e/apply.spec.ts"],
     "objective": "Application dialog: demo OTP, four steps, local draft, thank-you",
     "checks": ["npm run build", "npm test -- apply", "npx playwright test e2e/apply.spec.ts"],
     "visual": ["OTP code is visible on screen after entering a number", "step indicator shows the current step at 390px"]},
    {"id": "integration", "after": ["landing", "apply"], "owns": ["src/App.tsx", "e2e/**"],
     "objective": "Full-page pass across landing and apply: fix only what breaks between them",
     "checks": ["npm run build", "npm test", "npm run e2e"],
     "visual": ["every section heading is readable in page order at 390 and 1440", "the apply dialog opens readable from the hero and closing buttons"]}
  ]
}
```

`zcode-agent plan check plan.json` → `zcode-agent plan run plan.json --preflight` (read-only `<id>.pre` sessions, all at once; downstream sessions are told their upstream hasn't run yet; prints only the questions) → answer them once in the decisions file → `zcode-agent plan run plan.json --detach` → `zcode-agent plan wait plan --timeout-ms 540000 --json`. Your total involvement: the decisions, one answer pass, one summary.

## Exit codes

0 completed · 2 usage (bad flag, contract, plan, effort, or duplicate id) · 3 no key · 4 no engine · 5 failed · 6 `agent` had no subagent · 7 workspace conflict / session busy · 8 partial or checks failing · 9 unverified · 10 blocked · 124 timeout (for `wait`: still running) · 130 cancelled.

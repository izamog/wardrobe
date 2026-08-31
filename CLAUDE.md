<!-- verity-memory:start -->
## Project Memory

This project has a knowledge graph maintained at `.verity/memory/`. Before starting
non-trivial work, scan `.verity/memory/index.md` for decisions, gotchas, and patterns
that may apply to the change you are about to make. Open specific node files via
the Read tool when the title or scope suggests relevance.

The graph is auto-maintained by Verity. Files at `.verity/memory/_archive/` are
superseded — ignore them unless investigating history.

> Durable, hand-curated guidance goes in the preserve region below (it survives
> regeneration) or anywhere OUTSIDE these markers. Everything else between the
> markers is tool-owned and overwritten on each run.

<!-- verity-memory:preserve -->
## Agent & skill routing

This repo is two services: `wardrobe-app/` (Expo/RN/TS, tested with Jest) and
`background-framer/` (Python, tested with pytest). Domain invariants live in
`wardrobe-app/AGENTS.md` (read it before touching that tree) and in
`.verity/memory/` (auto-injected — don't re-derive what it already tells you).

Route by task shape, using the already-installed `superpowers` skills as the
execution engine — don't invent a parallel process:

| Task shape | Workflow | Verification | Stop and ask when |
|---|---|---|---|
| Trivial edit (typo, one-line config, single obvious fix) | Direct edit, no skill | Run the relevant command yourself | — |
| New feature / non-trivial change | `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development` | dispatch `verifier` agent before `finishing-a-development-branch` | requirements are ambiguous, or the plan implies a new dependency or a schema migration |
| Bug report | `superpowers:systematic-debugging` → fix → `verifier` | `verifier` agent | root cause implicates a documented invariant in `wardrobe-app/AGENTS.md` — confirm before changing it |
| Refactor | `superpowers:writing-plans` (skip brainstorming if scope is clear) → `subagent-driven-development` | `verifier` agent, both services if either touched | the refactor would relax a CHECK constraint, migration order, or file-ownership boundary in AGENTS.md |
| Pre-merge / "is this ready" | dispatch `repo-reviewer` (repo-specific invariants) alongside generic `superpowers:requesting-code-review`, then `verifier` | both agents' reports | either agent finds a violation of a hand-documented rule — don't silently patch around it, surface it |
| Touches both `wardrobe-app/` and `background-framer/` | Treat as two file-ownership scopes (per-service, sequential or parallel subagents, never the same file from two dispatches at once) | `verifier` runs both toolchains | the wire contract between them (`POST /v1/remove-background`) would change shape |

`verifier` and `repo-reviewer` (`.claude/agents/`) are read-only-except-Bash
agents scoped to this repo; dispatch them via the Agent tool, not by
re-deriving their checks inline.
<!-- /verity-memory:preserve -->
<!-- verity-memory:end -->

## Post-task reflection
When a task is complete (you've created a PR, the user says "done" or "ship it",
or the work is clearly finished), **draft the reflection yourself first** — 1–3
concrete things worth remembering (a decision, a gotcha, or a pattern), each
cited with the files / PR / commands / error-signatures it came from. Skip
entirely if nothing non-obvious happened.

Then, depending on how the session is running:

- **Interactive** (a person is at the keyboard): show your draft and ask one
  question before recording —

  > "Here's my reflection draft for the project memory: \<draft\>. Anything to
  > confirm, correct, or add before I record it? (Say 'skip' to drop it.)"

  Record the final text (with their corrections) via
  `verity reflect --user-input "<final reflection>" --kind <kind>`. If they say
  "skip", do not record.

- **Autonomous** (headless / CI / cron, or `VERITY_AUTONOMOUS=1`): record your
  draft directly, never blocking —
  `verity reflect --user-input "<your draft>" --kind <kind> --autonomous`.

# Incremental Skills

Skills for Incremental: reusable AI agent skills (e.g. OpenCode skills) that operate on Incremental repositories — observing tasks, computing affected plans, running conformance, and interpreting evidence.

## Contents

| Path                                  | Description                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `skills/incremental/engine/SKILL.md`  | Operate the engine: store, observe, advance, affected, explain, plan checks.        |
| `skills/incremental/verify/SKILL.md`  | Verify the repo: install, make targets, known failures by design, logs, Linux gate. |
| `skills/incremental/adapter/SKILL.md` | Write or review an adapter: required pieces, Node client flow, review checklist.    |

## Purpose

Skills let AI agents work with incremental end to end:

1. Initialize a store: `incremental init --store .incremental`
2. Observe tasks through an adapter (Vitest, git, strace, MCP, ...).
3. Query the engine: `affected` with a ChangeSet and options.
4. Explain results: `explain` per task, `stats` for store health.
5. Verify: run conformance (`make test-policy`, `make test-fuzz`) and review `evidence/`.

Each skill should document what it automates, which incremental commands or bindings it uses, and any assumptions (store location, baseline, adapter capabilities).

## Related

- `mcp/` — the MCP server itself is an agent-facing skill surface over Protocol v1
- `bindings/` — Node/Python/Rust clients skills can delegate to
- `docs/spec/PROTOCOL.md` — the protocol skills speak
- `docs/development/DEVELOPMENT_GUIDE.md` — contribution ground rules

# Backplane Skills

Skills for backplane: reusable AI agent skills (e.g. OpenCode skills) that operate on backplane repositories — observing tasks, computing affected plans, running conformance, and interpreting evidence.

## Contents

| Path | Description |
|---|---|
| `skills/backplane/` | The backplane skill directory (placeholder). |

## Purpose

Skills let AI agents work with backplane end to end:

1. Initialize a store: `backplane init --store .backplane`
2. Observe tasks through an adapter (Vitest, git, strace, MCP, ...).
3. Query the engine: `affected` with a ChangeSet and options.
4. Explain results: `explain` per task, `stats` for store health.
5. Verify: run conformance (`make test-policy`, `make test-fuzz`) and review `evidence/`.

Each skill should document what it automates, which backplane commands or bindings it uses, and any assumptions (store location, baseline, adapter capabilities).

## Related

- `mcp/` — the MCP server itself is an agent-facing skill surface over Protocol v1
- `bindings/` — Node/Python/Rust clients skills can delegate to
- `docs/spec/PROTOCOL.md` — the protocol skills speak
- `docs/development/DEVELOPMENT_GUIDE.md` — contribution ground rules

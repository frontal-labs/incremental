# Incremental Friction

Friction log for incremental: notes on developer experience, rough edges, and open friction encountered while adopting, extending, or contributing to incremental. Append-only — each entry starts with `## F-NNN <title> (Role, Milestone)`.

## Contents

| Path | Description |
|------|-------------|
| [FRICTION.md](FRICTION.md) | Root friction log with summary table and all entries (F-001 to F-019). |
| [f-001.json](f-001.json) | Goose toolchain pin is 13 days old, one day short of rule 2.11's 14-day minimum. |
| [f-002.json](f-002.json) | `bun-version: '2.2'` in CI is not a published Bun version. |
| [f-003.json](f-003.json) | `docker/Dockerfile.linux` is a placeholder, not a real Dockerfile. |
| [f-004.json](f-004.json) | Linux container gate: Docker daemon unresponsive during session, rerun pending. |
| [f-005.json](f-005.json) | Deletion of stale TypeScript stubs in `core/src/` denied by permission check. |
| [f-006.json](f-006.json) | Vitest fixture prime run exited 7 once, cause unknown. |
| [f-007.json](f-007.json) | Scratch repositories in `os.tmpdir` not cleaned up after MCP tests. |
| [f-008.json](f-008.json) | Working tree has many unrelated changes; no commit plan for grouping. |
| [f-009.json](f-009.json) | `test-adapters` target depends on adapter directories that exist only as untracked files. |
| [f-010.json](f-010.json) | Node recorder does not validate observations against JSON Schema (no `ajv`). |
| [f-011.json](f-011.json) | `declared_tasks` cannot be checked byte-for-byte against CLI (no `--declared-tasks` flag). |
| [f-012.json](f-012.json) | `context` is required in TypeScript type, preventing P0b exercise without a cast. |
| [f-013.json](f-013.json) | Python binding timeout is in seconds; Node client uses milliseconds (`timeoutMs`). |
| [f-014.json](f-014.json) | `baseline_conflict` now carries `data: {expected, actual}`. |
| [f-015.json](f-015.json) | M2 not met: cold CLI plan 0.96–1.41 s at 100k tasks (target < 300 ms). |
| [f-016.json](f-016.json) | Linux arm64 build not run: Goose has no linux-arm64 release. |
| [f-017.json](f-017.json) | Vitest fixture failure in container: workspace link excluded by `.dockerignore`. |
| [f-018.json](f-018.json) | `bindings/node/package-lock.json` contained a link into a pnpm store path. |

The root-level `FRICTION.md` is the friction log (maintained here). Record friction here, in `friction/`, or in `FRICTION.md` as development proceeds.

## Related

- `DECISIONS.md` — recorded decisions and open items.
- `VERSIONS.md` — exact versions.
- `spec/CHANGE_REQUESTS.md` — open change requests (CR-002, CR-003 need human sign-off).
- `docs/development/DEVELOPMENT_GUIDE.md` — contribution ground rules.
- `schemas/friction_entry.json` — JSON Schema for friction entries.

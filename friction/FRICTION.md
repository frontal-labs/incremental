# Incremental Friction

Friction log for incremental: notes on developer experience, rough edges, and open friction encountered while adopting, extending, or contributing to incremental. Append-only — each entry starts with `## F-NNN <title> (Role, Milestone)`.

Per  §7 rule 6: log surprises in `FRICTION.md`, choices in `DECISIONS.md`, versions in `VERSIONS.md`. These three are append-only. Per : `FRICTION.md`, `DECISIONS.md`, `VERSIONS.md` and `friction/` are append-only. Any role may append. No role may edit another role's entry.

## Friction Entries

| ID | Title | Role | Milestone | Status |
|----|-------|------|-----------|--------|
| [F-001](f-001.md) | Goose toolchain pin is 13 days old, one day short of rule 2.11's 14-day minimum | Core | E2 | open |
| [F-002](f-002.md) | `bun-version: '2.2'` in CI is not a published Bun version | Bench | E0 | open |
| [F-003](f-003.md) | `docker/Dockerfile.linux` is a placeholder, not a real Dockerfile | Bench | E10 | open |
| [F-004](f-004.md) | Linux container gate: Docker daemon unresponsive during session, rerun pending | Bench | E2 | open |
| [F-005](f-005.md) | Deletion of stale TypeScript stubs in `core/src/` denied by permission check | Core | E2 | open |
| [F-006](f-006.md) | Vitest fixture prime run exited 7 once, cause unknown, not reproduced in 4 later runs | Adapters | E4 | open |
| [F-007](f-007.md) | Scratch repositories in `os.tmpdir` not cleaned up after MCP tests | Adapters | E8 | open |
| [F-008](f-008.md) | Working tree has many unrelated changes (Rust binding, other session additions); no commit plan for grouping | All | all | open |
| [F-009](f-009.md) | `test-adapters` target depends on adapter directories that exist only as untracked files | Core | E2 | open |
| [F-010](f-010.md) | Node recorder does not validate observations against JSON Schema (no `ajv` in dependencies) | Adapters | E4 | open |
| [F-011](f-011.md) | `declared_tasks` cannot be checked byte-for-byte against CLI (no `--declared-tasks` flag) | Bindings | E3 | open |
| [F-012](f-012.md) | `context` is required in TypeScript type, preventing P0b exercise without a cast | Bindings | E3 | open |
| [F-013](f-013.md) | Python binding timeout is in seconds (float); Node client uses milliseconds (`timeoutMs`) | Bindings | E9 | open |
| [F-014](f-014.md) | `baseline_conflict` now carries `data: {expected, actual}`; Python test asserted no data | Bindings | E9 | open |
| [F-015](f-015.md) | M2 not met: cold CLI plan 0.96–1.41 s at 100k tasks (target < 300 ms) | Core | E2 | open |
| [F-016](f-016.md) | Linux arm64 build not run: Goose has no linux-arm64 release, building from source not documented | Core | E2 | open |
| [F-017](f-017.md) | Vitest fixture failure in container: workspace link excluded by `**/node_modules` rule of `.dockerignore` | Adapters | E4 | open |
| [F-018](f-018.md) | `bindings/node/package-lock.json` contained a link into a pnpm store path that no longer exists | Bindings | E3 | open |
| [F-019](f-019.md) | `adapters/vitest/fixtures/repo` has workspace symlink `app/node_modules/@fixture/core -> core`; container `.dockerignore` excludes it | Adapters | E4 | resolved |

## Related

- `DECISIONS.md` — recorded decisions and open items (append-only).
- `VERSIONS.md` — exact versions (append-only, currently empty).
- `spec/CHANGE_REQUESTS.md` — open change requests (CR-002, CR-003 need human sign-off).
- `docs/development/DEVELOPMENT_GUIDE.md` — contribution ground rules.
- `schemas/friction_entry.json` — JSON Schema for friction entries.

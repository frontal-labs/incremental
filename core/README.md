# Backplane Core

The backplane engine core, written in **Goose** (a Go-like systems language, see DECISIONS.md D-14-GOOSE). The core is generic: it knows nothing about Vitest, git, or tests — those are adapters. It records observations as content-hashed records in an append-only log and answers one question: given the changes since the last known-good baseline, which tasks are invalid, and why.

## Contents

| Path | Description |
|---|---|
| `core/src/main.goose` | CLI entry point: a thin binding over protocol v1 (`init`, `stats`, `serve`, ...). Shares `dispatch()` with the serve loop, so CLI and protocol answers are identical. |
| `core/src/policy.goose` | Policy engine: `plan(state, query)` per `spec/POLICY.md` (rules P0–P11, fallbacks, confidence). |
| `core/src/protocol.goose` | Protocol v1 server: JSON Lines over stdio, handshake, methods, errors, 10 s request budget. |
| `core/src/store.goose` | Store: append-only log (`tg.log`), index, lock (`tg.lock`), stat cache (`stat.cache`), verification. |
| `core/src/native.c` / `core/src/native.goose` | Native bindings for the engine. |
| `core/src/main.build` | Goose build descriptor. |
| `core/tests/` | Smoke and CLI tests (`node --test core/tests/*.test.mjs`). |
| `core/dist/` | Build output: `backplane` engine binary and build logs. |

## Building

Requires the Goose toolchain at `.toolchain/goose/goose-v2026.3-macos-arm64/` (Node 22 and Python 3.10+ also needed for the surrounding tooling):

```sh
make build   # builds core/dist/backplane and adapters/git/dist/backplane-git
```

Store operations, through the CLI:

```sh
core/dist/backplane init --store .backplane
core/dist/backplane stats --store .backplane
core/dist/backplane serve --store .backplane   # protocol v1 over stdio
```

## Testing

```sh
make test-core   # smoke and CLI tests
make loc         # lines of code in core/src (Goose + C)
```

## Protocol

Clients speak backplane Protocol v1 (`hello`, `observe`, `observe_many`, `baseline`, `advance`, `affected`, `explain`, `forget`, `stats`, `compact`, `ping`, `shutdown`) over JSON Lines on stdio. See `spec/PROTOCOL.md` and `docs/PROTOCOL_SPEC.md`.

## Store

Default store: `<repo>/.backplane/` (configurable via `BACKPLANE_STORE` or `--store`). Files: `tg.log` (source of truth), `tg.lock` (exclusive lock), `stat.cache` (verify-mode cache), `tg.idx` (index image, not implemented in this milestone). See `spec/FORMAT.md` and `docs/STORE_FORMAT.md`.

## Status

Core verification status is tracked in `status/CORE.json` (E2 verify: all 40 conformance cases pass; reverse indexes (PLAN 6.5) and binary index image format 2 built; M2 met on a same-day baseline).

Evidence: `evidence/E2.txt`.

## Related

- `adapters/` — protocol clients that drive the engine
- `bindings/` — Node/Python/Rust clients
- `spec/` — protocol, policy and format specification
- `docs/DATA_MODEL.md`, `docs/STORE_FORMAT.md`, `docs/POLICY_RULES.md`

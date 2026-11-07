# Incremental Core

The incremental engine core, written in **Goose** (a Go-like systems language, see DECISIONS.md D-14-GOOSE). The core is generic: it knows nothing about Vitest, git, or tests — those are adapters. It records observations as content-hashed records in an append-only log and answers one question: given the changes since the last known-good baseline, which tasks are invalid, and why.

## Contents

| Path                                          | Description                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/main.goose`                         | CLI entry point: a thin binding over protocol v1 (`init`, `stats`, `serve`, ...). Shares `dispatch` with the serve loop, so CLI and protocol answers are identical. |
| `core/src/policy.goose`                       | Policy engine: `plan(state, query)` per `docs/spec/POLICY.md` (rules P0–P11, fallbacks, confidence).                                                                |
| `core/src/protocol.goose`                     | Protocol v1 server: JSON Lines over stdio, handshake, methods, errors, 10 s request budget.                                                                         |
| `core/src/store.goose`                        | Store: append-only log (`tg.log`), index, lock (`tg.lock`), stat cache (`stat.cache`), verification.                                                                |
| `core/src/native.c` / `core/src/native.goose` | Native bindings for the engine.                                                                                                                                     |
| `core/src/main.build`                         | Goose build descriptor.                                                                                                                                             |
| `core/tests/`                                 | Goose tests (run with `goose --multi-test --stdlib core/src`).                                                                                                      |
| `core/dist/`                                  | Build output: `incremental` engine binary and build logs.                                                                                                           |

## Building

Requires the Goose toolchain at `.toolchain/goose/goose-v2026.3-macos-arm64/` (Node 22 and Python 3.10+ also needed for the surrounding tooling):

```sh
make build   # builds core/dist/incremental and adapters/git/dist/incremental-git
```

Store operations, through the CLI:

```sh
core/dist/incremental init --store .incremental
core/dist/incremental stats --store .incremental
core/dist/incremental serve --store .incremental   # protocol v1 over stdio
```

## Testing

```sh
make test-core   # Goose tests: goose --multi-test on core/tests/*.goose
make loc         # lines of code in core/src (Goose + C)
```

## Protocol

Clients speak incremental Protocol v1 (`hello`, `observe`, `observe_many`, `baseline`, `advance`, `affected`, `explain`, `forget`, `stats`, `compact`, `ping`, `shutdown`) over JSON Lines on stdio. See `docs/spec/PROTOCOL.md` and `docs/spec/PROTOCOL.md`.

## Store

Default store: `<repo>/.incremental/` (configurable via `INCREMENTAL_STORE` or `--store`). Files: `tg.log` (source of truth), `tg.lock` (exclusive lock), `stat.cache` (verify-mode cache), `tg.idx` (index image, not implemented in this milestone). See `docs/spec/FORMAT.md` and `docs/spec/FORMAT.md`.

## Status

Core verification status is tracked in `status/CORE.json` (E2 verify: all 40 conformance cases pass; reverse indexes and binary index image format 2 built; M2 met on a same-day baseline).

Evidence: `evidence/E2.txt`.

## Related

- `adapters/` — protocol clients that drive the engine
- `bindings/` — Node/Python/Rust clients
- `spec/` — protocol, policy and format specification
- `docs/spec/DATA_MODEL.md`, `docs/spec/FORMAT.md`, `docs/spec/POLICY.md`

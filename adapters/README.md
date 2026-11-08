# Incremental Adapters

Adapters are the dataplane of incremental: they observe what tasks read, list, probe and write, and feed changes into the engine. The engine itself (`core/`) knows nothing about Vitest, git, or tests — those concerns live in adapters, which speak incremental Protocol v1 (JSON Lines over stdio).

## Adapters in this directory

| Adapter    | Package                   | Purpose                                            |
| ---------- | ------------------------- | -------------------------------------------------- |
| bazel      | `@frontal-labs/incremental-bazel`      | Bazel build observation                            |
| biome      | `@frontal-labs/incremental-biome`      | Biome lint/format observation                      |
| clippy     | `@frontal-labs/incremental-clippy`     | Rust clippy observation                            |
| config     | `@frontal-labs/incremental-config`     | Configuration observation                          |
| env        | `@frontal-labs/incremental-env`        | Environment variable observation                   |
| fs         | `@frontal-labs/incremental-fs`         | Filesystem observation                             |
| git        | `@frontal-labs/incremental-git`        | Git change sets (built with the Goose toolchain)   |
| playwright | `@frontal-labs/incremental-playwright` | Playwright test observation                        |
| pnpm       | `@frontal-labs/incremental-pnpm`       | pnpm workspace observation                         |
| process    | `@frontal-labs/incremental-process`    | Process invocation observation                     |
| protobuf   | `@frontal-labs/incremental-protobuf`   | Protobuf observation                               |
| ruff       | `@frontal-labs/incremental-ruff`       | Ruff lint observation                              |
| turbopack  | `@frontal-labs/incremental-turbopack`  | Turbopack observation                              |
| typescript | `@frontal-labs/incremental-typescript` | TypeScript compile observation                     |
| nx         | `@frontal-labs/incremental-nx`         | Nx project observation (recorder, nx graph)        |
| turbo      | `@frontal-labs/incremental-turbo`      | Turborepo package observation (recorder, turbo ls) |
| vitest     | `@frontal-labs/incremental-vitest`     | Vitest recorder and planner (V01-V16)              |
| watcher    | `@frontal-labs/incremental-watcher`    | File watcher observation                           |
| rust       | —                         | Rust-side observation (see `bindings/rust`)        |

Each adapter is a standalone package with its own `package.json` (or `Cargo.toml` for Rust). Most are `@frontal-labs/incremental-*` TypeScript packages built with `tsc -b` and tested with `node --test`.

## Contract

Adapters emit observations (`observe`/`observe_many`) and provide changesets (`affected`) over incremental Protocol v1. See `docs/spec/PROTOCOL.md` and `docs/spec/POLICY.md`. Adapter types, the recorder contract and the Vitest/git adapters are described in `docs/adapters/ADAPTERS.md`.

## Testing

From the repo root (requires the built engine `core/dist/incremental`):

```sh
make test-adapters   # all TypeScript adapters + Rust binding
make test-vitest     # vitest adapter (V01-V16 end to end)
make test-git        # git adapter
make test-typescript # typescript adapter
make test-<adapter>  # any single adapter, e.g. make test-fs
```

Adapter verification status is tracked in `status/ADAPTERS.json` (E4 verify).

## Related

- `docs/adapters/ADAPTERS.md` — adapter types, recorder contract, Vitest adapter, git source, strace oracle, MCP
- `spec/adapters/` — per-adapter spec fragments
- `bindings/` — client bindings used by adapters

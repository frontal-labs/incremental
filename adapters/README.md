# Backplane Adapters

Adapters are the dataplane of backplane: they observe what tasks read, list, probe and write, and feed changes into the engine. The engine itself (`core/`) knows nothing about Vitest, git, or tests — those concerns live in adapters, which speak backplane Protocol v1 (JSON Lines over stdio).

## Adapters in this directory

| Adapter | Package | Purpose |
|---|---|---|
| bazel | `@backplane/bazel` | Bazel build observation |
| biome | `@backplane/biome` | Biome lint/format observation |
| clippy | `@backplane/clippy` | Rust clippy observation |
| config | `@backplane/config` | Configuration observation |
| env | `@backplane/env` | Environment variable observation |
| fs | `@backplane/fs` | Filesystem observation |
| git | `@backplane/git` | Git change sets (built with the Goose toolchain) |
| playwright | `@backplane/playwright` | Playwright test observation |
| pnpm | `@backplane/pnpm` | pnpm workspace observation |
| process | `@backplane/process` | Process invocation observation |
| protobuf | `@backplane/protobuf` | Protobuf observation |
| ruff | `@backplane/ruff` | Ruff lint observation |
| turbopack | `@backplane/turbopack` | Turbopack observation |
| typescript | `@backplane/typescript` | TypeScript compile observation |
| vitest | `@backplane/vitest` | Vitest recorder and planner (V01-V16) |
| watcher | `@backplane/watcher` | File watcher observation |
| rust | — | Rust-side observation (see `bindings/rust`) |

Each adapter is a standalone package with its own `package.json` (or `Cargo.toml` for Rust). Most are `@backplane/*` TypeScript packages built with `tsc -b` and tested with `node --test`.

## Contract

Adapters emit observations (`observe`/`observe_many`) and provide changesets (`affected`) over backplane Protocol v1. See `docs/spec/PROTOCOL.md` and `docs/spec/POLICY.md`. Adapter types, the recorder contract and the Vitest/git adapters are described in `docs/adapters/ADAPTERS.md`.

## Testing

From the repo root (requires the built engine `core/dist/backplane`):

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

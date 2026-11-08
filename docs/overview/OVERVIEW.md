# INCREMENTAL OVERVIEW

## Purpose

Incremental is an incremental dependency engine that records what each task reads, lists, probes and writes, stores observations as content-hashed records, and determines which tasks are invalid given changes since the last known-good baseline. It exposes a stable protocol so any language, runner, or agent can use it.

## Core Principles

- **Soundness first**: A task may only be skipped if it has a certificate (an observation at the current baseline whose inputs are all unchanged). No silent skips.
- **Protocol-first**: All access goes through incremental Protocol v1 over JSON Lines on stdio; bindings are thin clients.
- **Append-only log as source of truth**: Store state in `<store>/tg.log` (JSON Lines). Indexes are disposable caches.
- **Deterministic**: Plans are deterministic regardless of input order; all lists are sorted.
- **Generic engine**: Core knows nothing about Vitest, git, or tests - those are adapters.

## High-Level Architecture

```
Consumers (CI, MCP agents, humans) → Adapters (Vitest, strace, git, MCP) → Protocol v1 (JSON Lines) → Engine Core (store, index, policy, plans)
```

Key components:

- **Core**: log, store, index, policy, plan generation, protocol server, verification
- **CLI**: thin binding over protocol (`incremental` binary, built from `core/src/main.goose`)
- **Bindings** (`bindings/`): Node client (`@frontal-labs/incremental-client`, typed protocol client with process supervision), Python, and Rust
- **Adapters** (`adapters/`): recorders and drivers for Vitest (recorder/planner), git (change sets), strace (oracle), MCP server, and the build and test tools listed in `adapters/README.md`
- **Conformance**: Language-neutral test suite ensuring byte-identical behavior

## Current State

- Protocol v1 and its schemas are in `spec/`. Conformance cases C01-C40 are in `conformance/cases/`; Vitest adapter cases V01-V16 are in `adapters/vitest/fixtures/cases/`.
- Core is built in Goose under `core/src/`: `store.goose` (append-only log, index, lock, stat cache, verification), `policy.goose` (`plan`), `protocol.goose` (`serve`, protocol v1), and `main.goose` (the `incremental` CLI). All 40 conformance cases pass (E2 done).
- Bindings: the Node client (E3 done) and the Python binding (E9 done, optional). The Rust binding in `bindings/rust` has no status record yet.
- Adapters are built under `adapters/`. Milestone status, including the open decisions, is in [STATUS.md](../../STATUS.md) and `status/*.json`.
- The repository is not a single npm workspace. `apps/mcp/`, `adapters/*` and `bindings/node` are separate packages with their own `package.json`.

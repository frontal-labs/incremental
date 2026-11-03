# BACKPLANE OVERVIEW

## Purpose
Backplane is an incremental dependency engine that records what each task reads, lists, probes and writes, stores observations as content-hashed records, and determines which tasks are invalid given changes since the last known-good baseline. It exposes a stable protocol so any language, runner, or agent can use it.

## Core Principles
- **Soundness first**: A task may only be skipped if it has a certificate (an observation at the current baseline whose inputs are all unchanged). No silent skips.
- **Protocol-first**: All access goes through backplane Protocol v1 over JSON Lines on stdio; bindings are thin clients.
- **Append-only log as source of truth**: Store state in `<store>/tg.log` (JSON Lines). Indexes are disposable caches.
- **Deterministic**: Plans are deterministic regardless of input order; all lists are sorted.
- **Generic engine**: Core knows nothing about Vitest, git, or tests - those are adapters.

## High-Level Architecture
```
Consumers (CI, MCP agents, humans) → Adapters (Vitest, strace, git, MCP) → Protocol v1 (JSON Lines) → Engine Core (store, index, policy, plans)
```

Key components:
- **Core**: log, store, index, policy, plan generation, protocol server, verification
- **CLI**: thin binding over protocol (`backplane` binary)
- **Node Client** (`@backplane/client`): typed protocol client with process supervision
- **Adapters**: Vitest (recorder/planner), git (change sets), strace (oracle), MCP server
- **Conformance**: Language-neutral test suite ensuring byte-identical behavior

## Current State
- Protocol v1, schemas, conformance cases C01-C40 defined in `spec/`
- Core has skeletal modules (log, store, index, policy, plan, lock, protocol, verify) - implementation in progress per PLAN
- CLI scaffold in place
- Reference policy implementation exists for conformance testing
- Monorepo structure with workspaces for mcp and cli

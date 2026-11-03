# BACKPLANE DOCUMENTATION

This directory contains comprehensive documentation for the Backplane project, generated according to the codebase implementation and plan.

## Documentation Files

| File | Description |
|---|---|
| [OVERVIEW.md](OVERVIEW.md) | High-level overview, purpose, principles, architecture, and current state |
| [PROTOCOL_SPEC.md](PROTOCOL_SPEC.md) | backplane Protocol v1 specification (transport, handshake, methods, errors) |
| [DATA_MODEL.md](DATA_MODEL.md) | Core concepts, terms, input kinds, observation and ChangeSet schemas |
| [STORE_FORMAT.md](STORE_FORMAT.md) | Store layout, log format, records, graph_version, stat cache, lock, compaction |
| [POLICY_RULES.md](POLICY_RULES.md) | Certificate principle, baseline invariant, policy rules (P0-P11), fallbacks, confidence |
| [CONFIGURATION.md](CONFIGURATION.md) | Config file, environment variables, CLI options, defaults |
| [ADAPTERS.md](ADAPTERS.md) | Adapter types, recorder contract, Vitest adapter, git source, strace oracle, MCP |
| [CONFORMANCE_AND_TESTING.md](CONFORMANCE_AND_TESTING.md) | Conformance suite, test cases (C01-C40, V01-V16), guarantees, testing commands |
| [BENCHMARKS_AND_GATES.md](BENCHMARKS_AND_GATES.md) | Benchmark targets, replay methodology, Gate 0 and Gate 1 criteria |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | Quick start, structure, ground rules, roles, workflow, milestones |

## Quick References

- **Canonical Plan**: [plans/PLAN.md](../plans/PLAN.md) - Full specification v4
- **Protocol Spec**: [spec/PROTOCOL.md](../spec/PROTOCOL.md)
- **Policy Spec**: [spec/POLICY.md](../spec/POLICY.md)
- **Format Spec**: [spec/FORMAT.md](../spec/FORMAT.md)
- **Schemas**: [spec/schemas/](../spec/schemas/)
- **Conformance Cases**: [conformance/cases/](../conformance/cases/) (40 cases)
- **Makefile**: [Makefile](../Makefile)

## Key Concepts

- **Task**: Named unit of work tracked by engine (adapter-defined ID)
- **Certificate**: Observation at baseline with all inputs unchanged - allows skipping
- **Baseline**: Opaque state identifier (usually git commit SHA)
- **Plan**: Result showing invalid tasks with reasons, or fallback if unsafe to skip
- **Never skip silently**: Unknown/unverifiable input → task invalid or full fallback

## Current Implementation Status
Based on PLAN.md milestones and current codebase state - see [STATUS.md](../STATUS.md) for current progress.

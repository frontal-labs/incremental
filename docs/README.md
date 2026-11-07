# INCREMENTAL DOCUMENTATION

This directory contains comprehensive documentation for the Incremental project, restructured into subdirectories.

## Documentation Files

| File                                                                             | Description                                                                      |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [overview/OVERVIEW.md](overview/OVERVIEW.md)                                     | High-level overview, purpose, principles, architecture, and current state        |
| [spec/PROTOCOL.md](spec/PROTOCOL.md)                                             | incremental Protocol v1 specification (transport, handshake, methods, errors)    |
| [spec/POLICY.md](spec/POLICY.md)                                                 | Policy engine: `plan(state, query)`, rules P0–P11, fallback priority, confidence |
| [spec/FORMAT.md](spec/FORMAT.md)                                                 | Store layout, log format, records, graph_version, stat cache, lock, compaction   |
| [spec/DATA_MODEL.md](spec/DATA_MODEL.md)                                         | Core concepts, terms, input kinds, observation and ChangeSet schemas             |
| [spec/CONFIGURATION.md](spec/CONFIGURATION.md)                                   | Config file, environment variables, CLI options, defaults                        |
| [adapters/ADAPTERS.md](adapters/ADAPTERS.md)                                     | Adapter types, recorder contract, Vitest adapter, git source, strace oracle, MCP |
| [../adapters/README.md](../adapters/README.md)                                   | The built adapters under `adapters/`, one row each                               |
| [conformance/CONFORMANCE_AND_TESTING.md](conformance/CONFORMANCE_AND_TESTING.md) | Conformance suite, test cases (C01-C40, V01-V16), guarantees, testing commands   |
| [benchmarks/BENCHMARKS_AND_GATES.md](benchmarks/BENCHMARKS_AND_GATES.md)         | Benchmark targets, replay methodology                                            |
| [development/DEVELOPMENT_GUIDE.md](development/DEVELOPMENT_GUIDE.md)             | Quick start, structure, ground rules, roles, workflow, milestones                |

## Quick References

- **Protocol Spec**: [spec/PROTOCOL.md](spec/PROTOCOL.md)
- **Policy Spec**: [spec/POLICY.md](spec/POLICY.md)
- **Format Spec**: [spec/FORMAT.md](spec/FORMAT.md)
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

Based on milestones and current codebase state - see [STATUS.md](../STATUS.md) for current progress.

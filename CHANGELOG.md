# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Engine in Goose: log, index image, stat cache, compaction, multi-writer refresh, CLI, protocol v1, reverse indexes.
- Conformance suite: 40 cases; differential fuzz against an independent reference (30,000 queries).
- TypeScript client (`@incremental/client`), Python client (`incremental`), Vitest recorder and planner, MCP server.
- Git change source (`incremental-git changes`).
- Open: CR-002 and CR-003 open (see spec/CHANGE_REQUESTS.md).
- LICENSE: added as an identical copy of LICENSE.md (Apache-2.0). `make release-check` verifies LICENSE.md exists; LICENSE.md is the canonical source.
- Release (E10): not yet cut; no release is cut until the project is unblocked. `make release-check` cannot pass until the blocking items are resolved.

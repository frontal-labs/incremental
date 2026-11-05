# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Engine in Goose: log, index image, stat cache, compaction, multi-writer refresh, CLI, protocol v1, reverse indexes.
- Conformance suite: 40 cases; differential fuzz against an independent reference (30,000 queries).
- TypeScript client (`@incremental/client`), Python client (`incremental`), Vitest recorder and planner, MCP server.
- Git change source (`incremental-git changes`).
- Open: Gate 0 not run on a real repository (STOP: repo's own suite red; demo STOP on K4); CR-002 and CR-003 open (see spec/CHANGE_REQUESTS.md).
- LICENSE: added as an identical copy of LICENSE.md (Apache-2.0). `make release-check` verifies LICENSE.md exists; LICENSE.md is the canonical source.
- Release (E10): BLOCKED. Per  the project is stopped at Gate 0 (STOP), so E5, E7 and E10 do not run; no release is cut. `make release-check` cannot pass until Gate 0 is resolved.

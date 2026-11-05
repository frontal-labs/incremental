# Incremental Schemas

JSON schemas for incremental: observations, changesets, plans, explanations, errors, requests, responses, stats, store records, config, change requests, conformance cases, status JSON, store layout, and friction entries. Schemas are the machine-readable counterpart to `docs/spec/PROTOCOL.md`, `docs/spec/POLICY.md`, `docs/spec/FORMAT.md`, and ``.

The authoritative schema artifacts checked by `spec/validate.mjs` live in `spec/schemas/`. This directory (`schemas/`) mirrors those schemas with full `$id` URIs, discriminators, and additional schema domains (store layout, config, change requests, conformance cases, role status, friction entries).

## Schema Files

| File | Description |
|------|-------------|
| [observation.json](observation.json) | Observation: one recorded run of a task (inputs, outputs, outcome, baseline, dirty, context). |
| [input_file.json](input_file.json) | File input kind (kind: "file", path + content hash). |
| [input_dir.json](input_dir.json) | Directory input kind (kind: "dir", path). |
| [input_probe.json](input_probe.json) | Probe input kind (kind: "probe", path that did not exist). |
| [input_declared.json](input_declared.json) | Declared input kind (kind: "declared", path + hash, no observed read). |
| [input_env.json](input_env.json) | Environment variable input kind (kind: "env", name + value_hash). |
| [input_env_all.json](input_env_all.json) | Environment-all input kind (kind: "env_all", optional snapshot). |
| [context.json](context.json) | Context: tool versions, lockfile hash, env snapshot, capabilities (probes/dirs/env). |
| [changeset.json](changeset.json) | ChangeSet: changes between a baseline and the current worktree state. |
| [plan.json](plan.json) | Plan: engine's answer to an affected query (invalid tasks, reasons, fallback, confidence). |
| [explanation.json](explanation.json) | Explanation: latest observation summary and certificate status for a task. |
| [error.json](error.json) | Protocol error object (code, message, data). |
| [request.json](request.json) | JSON Lines request sent to the engine over stdio. |
| [response.json](response.json) | JSON Lines response from the engine (exactly one of result or error). |
| [stats.json](stats.json) | Stats: store statistics (tasks, observations, baseline, graph_version). |
| [store_record.json](store_record.json) | Store log record (hdr, obs, forget, baseline) — one line of tg.log. |
| [config.json](config.json) | incremental.config.json: repository configuration file. |
| [change_request.json](change_request.json) | Change request format for spec/CHANGE_REQUESTS.md. |
| [conformance_case.json](conformance_case.json) | Data-driven conformance case format (conformance/cases/*.json). |
| [status.json](status.json) | Role status JSON format (status/<ROLE>.json). |
| [store_layout.json](store_layout.json) | Store directory layout (tg.log, tg.lock, stat.cache, tg.idx). |
| [friction_entry.json](friction_entry.json) | Friction entry format for friction/FRICTION.md and friction/fNNN/. |
| [index.json](index.json) | Index of all incremental JSON schemas. |

## Related

- `spec/schemas/` — schema artifacts checked by `spec/validate.mjs` via `make check-spec`.
- `docs/spec/PROTOCOL.md` — Protocol v1 transport, handshake, methods, errors (sections 9.1–9.9).
- `docs/spec/POLICY.md` — Policy engine: plan(state, query), rules P0–P11, fallback priority, confidence.
- `docs/spec/FORMAT.md` — Store format v1: tg.log records, graph_version, stat.cache, tg.lock, compaction.
- `docs/spec/DATA_MODEL.md` — Core concepts, terms, input kinds, observation and ChangeSet schemas.
- `docs/spec/CONFIGURATION.md` — Config file, environment variables, CLI options, defaults.
- `` — Full specification v4.1 (canonical plan).

## Validating

From the repo root:

```sh
make check-spec   # schemas, reference policy, coverage matrix (PASS validate.mjs, PASS check-spec)
```

Schemas in this directory use JSON Schema draft-07 and carry `$id` URIs under `https://incremental.dev/schemas/`.

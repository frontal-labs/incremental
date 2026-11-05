# incremental Protocol v1 (from plans/PLAN.md section 9)

## Transport (9.1)

- One JSON object per line, in each direction, flushed per line.
- Requests carry an integer `id`. The response echoes `id`.
- A response has exactly one of `result` or `error`.
- A malformed line gets `{"id": null, "error": {"code": "invalid_params", ...}}`. The loop continues.

## Handshake (9.2)

`hello` must be the first request. Request: `{"id":1,"method":"hello","params":{"protocol":1,"client":{"name":"...","version":"..."}}}`.

Result: `{"protocol":1,"engine":{"name":"incremental-core-ts","version":"0.1.0"},"capabilities":["probes","dirs","env","verify"],"store":".incremental"}`.

If `params.protocol` is not 1, reply with `protocol_mismatch` and `data: {"supported": [1]}`, then close the stream.

## Methods (9.3)

| Method | Params | Result |
|---|---|---|
| `hello` | `{protocol, client}` | `{protocol, engine, capabilities, store}` |
| `observe` | `{observation}` | `{accepted: true}` |
| `observe_many` | `{observations: []}` | `{accepted: n}`. Atomic |
| `baseline` | none | `{baseline: string or null}` |
| `advance` | `{to, expected}` | `{baseline}`. `expected` must equal the current baseline, else `baseline_conflict` |
| `affected` | `{changes, options}` | Plan (section 4 below) |
| `explain` | `{task}` | `{task, observed, outcome, dirty, baseline, inputs, certificate}`; `inputs` is a count. Matches spec/schemas/explanation.json |
| `forget` | `{task}` | `{forgotten: true}` |
| `stats` | none | `{tasks, observations, baseline, graph_version}` |
| `compact` | none | `{before_bytes, after_bytes}` (not implemented in this milestone) |
| `ping` | none | `{pong: true}` |
| `shutdown` | none | `{bye: true}`, then exit |

## Observation (9.5)

```json
{
  "task": "packages/core/src/math.test.ts",
  "baseline": "b1",
  "dirty": false,
  "context": {"lockfile": "sha256:...", "tsconfig": "sha256:...", "pkgjson": "sha256:...",
              "runner": "vitest@4.1.12", "node": "22.11.0", "fmt": 1,
              "caps": {"probes": true, "dirs": true, "env": true}},
  "inputs": [
    {"kind": "file", "path": "packages/core/src/math.ts", "hash": "sha256:..."},
    {"kind": "dir", "path": "packages/app/plugins"},
    {"kind": "probe", "path": "packages/core/src/helpers.ts"},
    {"kind": "env", "name": "TG_FIXTURE_MODE", "value_hash": "sha256:..."},
    {"kind": "env_all", "snapshot": {"TG_FIXTURE_MODE": "sha256:..."}}
  ],
  "outputs": [],
  "outcome": "pass",
  "duration_ms": 412
}
```

Required: `task`, `baseline`, `context` (with the reserved keys). `outcome` is `pass`, `fail`, `error`, or `none`.

`env_all.snapshot` is an addition (DECISIONS.md D-E1-02). It holds the full environment hash map at observation time. Without it, `env_all` is treated as changed.

## ChangeSet (9.5)

```json
{"baseline": "b1", "head": "...", "changes": [
  {"path": "packages/core/src/math.ts", "status": "modified"},
  {"path": "packages/core/src/new.ts", "status": "renamed", "old_path": "packages/core/src/old.ts"}]}
```

`status` is `modified`, `added`, `deleted`, or `renamed`. `old_path` is required for `renamed`. `head` is informational.

## affected (9.3, 9.6)

`params`: `{changes: ChangeSet, options: {baseline, context?, verify?, policy?, env?, config?, declared_tasks?}}`.

`env`, `config`, and `declared_tasks` are additions (DECISIONS.md D-E1-01). Their semantics are in POLICY.md section 1.

Result (Plan):

```json
{"protocol": 1, "baseline": "b1", "graph_version": "g_8f3a21c9", "verify": false,
 "tasks": [{"id": "packages/core/src/math.test.ts", "reasons": ["reads:packages/core/src/math.ts"]}],
 "unobserved": [], "ignored": [], "deleted_tasks": [],
 "total_tasks": 7, "skipped": 6, "fallback": null, "confidence": "medium"}
```

A fallback is never an error. Exit 0 with `fallback` set is the normal outcome of an unsafe-to-skip query.

## Errors (9.7)

| Code | Meaning | CLI exit |
|---|---|---|
| `invalid_params` | Malformed request or schema violation | 2 |
| `unknown_method` | Method not in v1 | 2 |
| `protocol_mismatch` | Client protocol not supported | 2 |
| `store_missing` | No store at the path | 3 |
| `store_corrupt` | Log record invalid (not a truncated tail) | 3 |
| `lock_busy` | Another writer holds the lock | 5 |
| `baseline_conflict` | `advance` expected value mismatch | 6 |
| `timeout` | Request exceeded the server budget (10 s) | 4 |
| `internal` | Unexpected failure | 4 |

Error object: `{"code": "...", "message": "...", "data": {...}}`.

## Budget (9.8)

Each request has a 10-second server-side budget. The server never returns a partial plan.

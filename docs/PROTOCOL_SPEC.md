# BACKPLANE PROTOCOL V1

## Transport
- JSON Lines over stdio (one JSON object per line, flushed per line)
- Requests have integer `id` echoed in responses
- Response contains exactly one of `result` or `error`
- Malformed lines return `{"id": null, "error": {"code": "invalid_params", ...}}` and loop continues
- Server budget: 10 seconds per request; never returns partial plan on timeout

## Handshake
First request must be `hello`:
```json
{"id":1,"method":"hello","params":{"protocol":1,"client":{"name":"...","version":"..."}}}
```
Response:
```json
{"protocol":1,"engine":{"name":"backplane-core-ts","version":"0.1.0"},"capabilities":["probes","dirs","env","verify"],"store":".backplane"}
```
If protocol not supported, returns `protocol_mismatch` with `data.supported=[1]` and closes stream.

## Methods
| Method | Params | Result | Notes |
|---|---|---|---|
| `hello` | `{protocol, client}` | `{protocol, engine, capabilities, store}` | First call |
| `observe` | `{observation}` | `{accepted: true}` | Record observation |
| `observe_many` | `{observations: [...]}` | `{accepted: n}` | Atomic (all or none) |
| `baseline` | none | `{baseline: string or null}` | Get current baseline |
| `advance` | `{to, expected}` | `{baseline}` | Compare-and-swap; fails with `baseline_conflict` if expected mismatch |
| `affected` | `{changes, options}` | Plan | Compute affected tasks |
| `explain` | `{task}` | `{task, observation, certificate}` | Explain task status |
| `forget` | `{task}` | `{forgotten: true}` | Remove task from graph until next observation |
| `stats` | none | `{tasks, observations, baseline, graph_version}` | Store statistics |
| `compact` | none | `{before_bytes, after_bytes}` | Not implemented yet |
| `ping` | none | `{pong: true}` | Health check |
| `shutdown` | none | `{bye: true}` | Exit after reply |

## Error Codes
| Code | Meaning | CLI Exit |
|---|---|---|
| `invalid_params` | Malformed request/schema violation | 2 |
| `unknown_method` | Method not in v1 | 2 |
| `protocol_mismatch` | Client protocol unsupported | 2 |
| `store_missing` | No store at path | 3 |
| `store_corrupt` | Log record invalid (not truncated tail) | 3 |
| `lock_busy` | Another writer holds lock | 5 |
| `baseline_conflict` | `advance` expected value mismatch | 6 |
| `timeout` | Request exceeded 10s budget | 4 |
| `internal` | Unexpected failure | 4 |

Error format: `{"code": "...", "message": "...", "data": {...}}`

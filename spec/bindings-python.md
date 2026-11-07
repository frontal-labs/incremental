# incremental Python binding (spec, E9)

Status: v1, written before the implementation . Package `incremental`, located in `bindings/python/incremental/`. It implements protocol v1 (`spec/PROTOCOL.md`) and nothing else.

## 1. Scope and runtime rules

- Python 3.10 or newer. Standard library only at runtime. No third-party packages.
- The package does not implement the policy. It spawns the engine (`incremental serve`) and sends protocol requests. Every answer comes from the engine.
- Build: `bindings/python/pyproject.toml` with the `setuptools` build backend. Tests do not install the package. They put `bindings/python` on `sys.path`.

## 2. Engine, store and root

| Setting        | Source, in order                                                                  |
| -------------- | --------------------------------------------------------------------------------- |
| engine command | argument `engine`; else `INCREMENTAL_ENGINE`; else `<repo>/core/dist/incremental` |
| store          | argument `store`; else `INCREMENTAL_STORE`; else `<repo>/.incremental`            |
| root           | argument `root`; else `<repo>`                                                    |

`<repo>` is the nearest ancestor of the current directory that contains `.git`, or the current directory if there is none.

`engine` may be a string or a list of strings. The list is the command prefix. The client runs `prefix + ["serve", "--store", store, "--root", root]`. Tests use this to run a fake engine.

The store must exist. The client does not create it. The engine's `init` command creates it (`core/dist/incremental init --store DIR`). If the store is missing, `connect` raises `store_missing`.

## 3. Public API

Module `incremental` exports:

```python
def connect(store=None, *, engine=None, root=None, timeout=10.0, restart=True) -> Incremental

class Incremental:
    protocol: int                      # always 1
    engine_pid: int | None             # pid of the running engine (None if not running)
    def hello(self) -> dict            # {protocol, engine, capabilities, store}
    def observe(self, observation: dict) -> dict            # {"accepted": True}
    def observe_many(self, observations: list[dict]) -> dict  # {"accepted": n}; atomic
    def baseline(self) -> dict         # {"baseline": str | None}
    def advance(self, to: str, expected: str | None) -> dict  # {"baseline": str}
    def affected(self, changes: dict, *, baseline: str, context: dict | None = None,
                 verify: bool = False, policy: str = "balanced",
                 env: dict | None = None, config: dict | None = None,
                 declared_tasks: list | None = None) -> dict  # Plan
    def explain(self, task: str) -> dict
    def forget(self, task: str) -> dict                       # {"forgotten": True}
    def stats(self) -> dict
    def compact(self) -> dict          # {"before_bytes", "after_bytes"}; the engine may refuse
    def ping(self) -> dict             # {"pong": True}
    def close(self) -> None            # sends shutdown, waits for exit; idempotent
    def __enter__(self) / __exit__(...)   # close on exit

class IncrementalError(Exception):
    code: str          # protocol error code (section 6)
    message: str
    data: Any          # error.data, or None
```

Method names are the protocol method names in snake_case. The request params are the protocol params, with the same keys. Results are returned as parsed JSON, with object key order kept.

`affected` builds the protocol request as follows. `changes` is the ChangeSet object (`{"baseline", "changes", ...}`). `options` is `{baseline, verify, policy}` plus `context`, `env`, `config`, `declared_tasks` when they are not None. `verify` and `policy` are always sent. Their defaults are `false` and `"balanced"`.

## 4. Transport behaviour (MUST)

1. **Handshake.** `connect` starts the engine and sends `hello` with `{"protocol": 1, "client": {"name": "incremental-python", "version": "0.1.0"}}` before any other request. A non-1 protocol in the result raises `protocol_mismatch`.
2. **Framing.** One JSON object per line, UTF-8, flushed per request. Responses are matched by `id`. Lines with another `id` are discarded. Each request id is a new positive integer.
3. **Responses.** A response with `error` raises `IncrementalError(code, message, data)`. A response with `result` returns the result. The client never returns a partial plan.
4. **Timeout.** Each request has `timeout` seconds (default 10). On expiry the client kills the engine and raises `IncrementalError` with code `timeout` and `data = {"partial": false}`. The next call restarts the engine, if `restart` is true.
5. **Death and restart.** Before each request, if the engine has exited and `restart` is true, the client starts a new engine and re-runs `hello`. If the engine exits while a request is in flight, the client raises `engine_exited`. A read-only method (`baseline`, `stats`, `explain`, `affected`, `ping`) is retried once after a restart. A mutating method is not retried, because it may have been applied. If `restart` is false, a dead engine raises `engine_exited` on the next call.
6. **Startup errors.** The engine's CLI-style error line (`{"ok": false, "error": {...}}`) is raised with its code. For example `store_missing` exits with status 3.
7. **Serialization.** Calls from several threads are serialized by one FIFO lock. A call waits for the lock. The request timeout applies only to the wait for the response. Calls run in the order they reached the lock.
8. **Closing.** `close` sends `shutdown`, waits up to `timeout` for the exit, and kills the engine if it does not exit. Any later call raises `closed`.

## 5. Observation and ChangeSet shapes

The Python dicts use the protocol schema exactly (`spec/PROTOCOL.md`, section "Observation" and "ChangeSet"). The client does not validate them. The engine validates them and returns `invalid_params`.

## 6. Errors

`IncrementalError.code` is one of the protocol codes: `invalid_params`, `unknown_method`, `protocol_mismatch`, `store_missing`, `store_corrupt`, `lock_busy`, `baseline_conflict`, `timeout`, `internal`. The client adds these codes of its own:

| Code            | Meaning                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `timeout`       | The engine did not answer within `timeout`. The same code as the protocol timeout error. `data = {"partial": false}` |
| `engine_exited` | The engine exited during a request, or it is down and `restart` is false                                             |
| `closed`        | The client was closed                                                                                                |
| `bad_response`  | The engine wrote a line that is not JSON or has no `id` and `error`/`result`                                         |

## 7. Conformance mapping

Every case in `conformance/cases/*.json` is run through the client. The expectations are the fields `conformance/run.mjs` compares: `tasks`, `unobserved`, `ignored`, `deleted_tasks`, `fallback`, `confidence`, and for action cases `error` and `baseline_after`. Comparison is made on the `json.dumps` form, so array and key order count.

Run modes:

- `query` cases: call `affected` with the case inputs.
- `determinism` `repeat`: the same call twice gives equal `json.dumps` bytes.
- `determinism` `shuffle`: the same call with the changes reversed gives equal bytes.
- `determinism` `cache`: a verify call with `stat.cache` present, then with it deleted, gives the same plan.
- `determinism` `index`: a plan from a valid `tg.idx`, a plan with no index, and a plan from a stale index plus the log tail give equal bytes.
- `action` cases: `advance` with a stale `expected`, and `hello` with an unknown protocol version.
- `raw_lines` and `post_raw_log`: writes to the store directory are done by the test, and the client then reads the store.
- `kind: concurrency`: two client processes write to one store at once.

A case where the public client cannot send the request is run through the client's transport layer (`incremental._transport`). The case states this in the test output.

## 8. Byte parity (G6)

For each query, the plan is serialized as `json.dumps(plan, separators=(",", ":"), sort_keys=False)` (with default `ensure_ascii`). The result must equal the body of the engine's `serve` response for the same request, byte for byte. The body is the text after `{"id":N,"result":` and before the final `}` of the response line. For the CLI check, the client is called with the same inputs the CLI takes (`changes`, `baseline`, `context`, `verify`, `policy`), with no `env`, `config` or `declared_tasks`. Its plan bytes must equal the CLI `affected` stdout minus its trailing newline. A query without `context` is outside this check, because the CLI requires `--context`.

## 9. Open points

- `compact` is not in the protocol this milestone's engine implements. The client forwards it and the engine's error is raised.
- The client does not call `init`. Store creation stays with the engine CLI.

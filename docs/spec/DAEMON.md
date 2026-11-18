# T-08 — Persistent daemon for `incremental serve`

Status: **design (issue #40).** Design-only change; no implementation in this step.

## 1. Problem

Every adapter `run` spawns a fresh engine over stdio: the Node client `spawn`s
`<defaultEngine> serve --store … --root …`, waits for `hello`, sends its
requests (`baseline`, `affected`, `observe`), then closes with a 2 s grace (D-09; the Rust and Python
clients do the same). Measured on this machine (10 cores, loaded): the
spawn+hello round trip costs **~100–300 ms of pure wall time per run**, before
any git or model work, and it scales with process-startup cost, which is the
worst on the CI runners the benchmark targets. The T-05 fast path already
eliminates the spawn for no-op runs on the Node adapter (~5 s → ~1 s measured),
but every **full** run — cold store, `--all`, `--shadow`, any model or adapter
without a fast path — still pays it.

## 2. Non-goals

- No remote/network daemon. Local, per-user, store-scoped only.
- No replacement of `serve` over stdio. Stdio remains the default and the
  fallback; the daemon is additive.
- No changes to the protocol v1 wire format (method set, JSON shape, error
  codes). The daemon reuses the same JSONL-over-socket framing.
- No cluster, multi-store, or multi-user sharing.

## 3. Design overview

```
incremental daemon start            incremental run / client.connect()
        │                                      │
        ▼                                      ▼
┌───────────────────┐    tg.daemon.lock   ┌──────────────────┐
│  daemon (engine)  │◄────────────────────┤   client         │
│  serve over a     │   connect, hello,   │  (Node/Rust/Py)  │
│  unix socket,     │   requests, ping    │                  │
│  pid + start-time │   ─────────────────►│                  │
└───────────────────┘                     └──────────────────┘
        socket: <tmp>/incremental-<store-hash>-<uid>.sock
        lock:    <store>/tg.daemon.lock
```

- **One daemon per store.** A daemon is bound to exactly one store path and one
  root. Two projects with different stores get different daemons; the same
  project reuses one.
- **The daemon is the engine.** It is `incremental serve` pointed at a unix
  socket instead of stdio. The engine is already a multi-connection server in
  principle (the protocol is request/response JSONL), so the daemon accepts
  sequential or interleaved client connections and serves them.
- **Clients prefer the daemon when it is healthy and reachable, and fall back
  to spawning a child `serve` otherwise.** Falling back is transparent: the
  client-side code path is the same `connect()`; only the transport (socket vs
  stdio pipe) differs.

## 4. CLI surface

```
incremental daemon start [--foreground] [--store <store>] [--root <root>]
incremental daemon status [--store <store>]
incremental daemon stop    [--store <store>] [--force]
```

- `start` resolves the store (the same `--store`/`INCREMENTAL_STORE` resolution
  `run` uses; required if ambiguous), spawns the engine in the background,
  waits for `hello`, and exits 0 when the daemon is reachable. `--foreground`
  runs it in the foreground for systemd/pm2-style supervision.
- `status` prints `daemon <pid> alive since <start-time> socket <path>` or
  `no daemon` / `stale (pid <pid> not running)`. Exit codes: 0 = reachable,
  3 = not running (matching `store_missing`), 5 = a fresh daemon already holds
   the lock (matching `lock_busy`/`tg.lock`).
- `stop` sends `shutdown` (graceful) or SIGTERM. `--force` sends SIGKILL.

The adapter's `run` command gains one flag:

```
incremental run --daemon          # prefer a daemon; fall back to child serve
```

It is off by default until the benchmark in §10 lands and the default is
flipped deliberately.

## 5. Store-scoped identity

- **Socket path:** `<os.tmpdir()>/incremental-<hash>-<uid>.sock` where
  `<hash>` is the first 16 hex chars of the SHA-256 of the **absolute,
  canonical** store path (same canonicalization the store itself uses) and
  `<uid>` is the numeric user id. This makes two checkouts of the same repo at
  different paths get different sockets, and prevents cross-user collisions.
  Unix socket paths have a length limit (~104 bytes on macOS/BSD); the hash
  keeps the name short. If the computed path exceeds the limit, the daemon
  refuses to start with `invalid_params` and the message `socket_path_too_long`.
- **Daemon lock:** `<store>/tg.daemon.lock` (next to `tg.lock`, so it moves with
  the store and is not in the repo). It is a JSON file with the same staleness
  rule as `tg.lock`:

  ```json
  {"pid": 12345, "start_time": 1713400000123, "socket": "/tmp/incremental-…sock",
   "store": "/abs/canonical/store", "protocol": 1, "started_at": 1713400000123}
  ```

  A lock is **stale** when its pid is not alive, or is alive but its start-time
  does not match (pid reuse). `daemon start` refuses to write the lock while a
  **fresh** lock exists (`lock_busy`, exit 5), and silently clears a stale one.
- **Store mismatch guard:** the lock records the absolute store path. A client
  whose resolved store does not byte-match the lock's `store` does **not**
  connect, even though the socket hash matches — this protects against hash
  truncation collisions and against the user passing a different `--store` to
  two processes. Mismatch is a hard no-connect, not an error: the client falls
  back to a child `serve`.

## 6. Discovery and activation (client side)

When a client is told to prefer the daemon (`--daemon`, or the default once
flipped), it does, in order, each step cheap:

1. **Read `<store>/tg.daemon.lock`.** No I/O beyond one small file read.
   - Missing → no daemon → spawn child `serve` (today's behavior).
   - Stale (pid gone or start-time mismatch) → atomically remove the lock
     (best-effort) → spawn child `serve`.
   - Store mismatch (§5) → spawn child `serve`.
2. **Probe the socket** with a single `ping` (the method already exists in
     protocol v1), budgeted at **250 ms** total connect+ping. The 250 ms budget
     is deliberately small: a local unix socket round trip is sub-millisecond,
     so anything slower means the daemon is wedged.
   - `hello` + `pong` in budget → use the daemon connection.
   - Timeout / ECONNREFUSED / non-JSON → remove the lock (best-effort) →
     spawn child `serve`.
3. **On use**, if any request on the daemon connection fails with a transport
   error (not a protocol error code), the client retries **that one request**
   once over a fresh child `serve`, removes the daemon lock, and continues.
   This is the "stale daemon" case the issue calls out: a process that stopped
   serving (kernel OOM-killed it, a crashed handler) is replaced by the same
   recovery as a missing one.

All of steps 1–3 happen before the first request payload is built, so the
fallback adds at most ~250 ms to a run that would otherwise fall through —
and the common healthy case adds ~1 ms (the `ping`) instead of ~100–300 ms
(spawn+hello).

## 7. Protocol

No wire changes. The daemon speaks protocol v1 unchanged:

- Same JSONL framing over the socket (one JSON object per line).
- Same `hello` handshake (client sends `hello` with its `protocol` version;
  the daemon responds with its `server` identity, which gains one field:
  `daemon: true` and the store hash, so a client can assert it is on a daemon
  and not a stdio child — useful for `daemon status --verbose`).
- Same method set (`hello`, `observe`, `observe_many`, `baseline`, `advance`,
  `affected`, `explain`, `forget`, `stats`, `compact`, `ping`, `shutdown` — see
  PROTOCOL.md).
- Same error codes (`invalid_params`, `unknown_method`, `protocol_mismatch`,
  `store_missing`, `store_corrupt`, `lock_busy`, `baseline_conflict`,
  `timeout`, `internal`); the daemon adds **no new codes**.
  Client-side daemon failures (probe timeout, store mismatch) are handled in
  client code and never surface as engine error codes.

The one behavioral difference: **a daemon connection is long-lived.** A client
that opens a connection may send several requests and close it; `shutdown` on a
daemon connection is not honored as "stop the process" — the daemon ignores it
with `pong`-equivalent `{"ok":true}` and keeps serving, because other clients
may be attached. To actually stop the daemon you use `incremental daemon stop`
or SIGTERM. (On a stdio child, `shutdown` still stops the process, as today.)

## 8. Failure handling

| Case | Detection | Client behavior |
|---|---|---|
| Daemon never started | lock missing | spawn child `serve` (silent fallback) |
| Lock stale (pid gone / reused) | pid + start-time check | remove lock, spawn child `serve` |
| Store mismatch | lock `store` ≠ client store | spawn child `serve` (hard no-connect) |
| Socket connect refused | ECONNREFUSED within 250 ms | remove lock, spawn child `serve` |
| Probe `ping` timeout | >250 ms no `pong` | remove lock, spawn child `serve` |
| Daemon dies mid-run | transport error on a request | retry once on child `serve`, remove lock |
| Daemon wedged (accepts but never answers a request) | per-request default 10 s timeout | retry once on child `serve`, remove lock |
| `daemon start` while a fresh daemon runs | fresh `tg.daemon.lock` | exit 5 `lock_busy`, print the live daemon's pid |
| Two `daemon start` racing on a stale lock | `O_EXCL` create + pid verify | loser detects the winner's fresh lock, exits 0 (`daemon already running`) |

**Recovery is always "spawn a child"**, which is exactly today's path, so a
broken daemon can never make a run fail that would have succeeded without
one. This is the property the issue requires: a stale or absent daemon must
never be the reason `run` fails.

**Lockfile hygiene.** The daemon removes its own lock and socket on clean
exit (SIGTERM, `daemon stop`). It does **not** remove them on SIGKILL (it
can't); the next `start` or client probe cleans up via the pid+start-time rule.
The lock is inside the store directory, so deleting a store deletes the lock,
which is the intended "forget this daemon" gesture.

**`tg.lock` interplay.** The daemon holds no store lock of its own. Each
request that writes (`observe`, `observe_many`, `advance`, `forget`) acquires
`tg.lock` per request, exactly as a child `serve` does, so a daemon and a
child-spawned run can never write the store concurrently. A daemon and a
second process can both be *connected* at once, but the store lock serializes
their writes; reads are safe without it. This is why "one daemon per store"
is safe without any new engine-side multiplexing.

## 9. Bindings

The daemon is a **transport** concern, so each binding gets the same small
change: a `connect()` that, when `prefer_daemon` is set, tries the socket path
first and otherwise spawns a child. The method surface is unchanged.

- **Node** (`bindings/node`): the client constructor (which today takes
  `{ command, store, root }`) gains `{ daemon?: boolean }`. When true it runs
  the discovery in §6 (read lock → probe → fallback) using Node's `net` module
  before any request; the returned `Client` is identical to today's (same
  `hello`/`observe`/`affected`/…). `spawnRun` keeps the child path as the
  fallback. No public method changes.
- **Rust** (`bindings/rust`): `Client::connect(opts)` gains
  `opts.daemon: bool`; same discovery, using `tokio::net::UnixStream` (already
  a dependency for stdio pipes). No public method changes.
- **Python** (`bindings/python`): `Client(daemon=True)`; same discovery over
  `socket`/`asyncio` unix streams. No public method changes.

The adapter CLI flag `--daemon` (Node adapter) and the equivalent env var
`INCREMENTAL_DAEMON=1` map to `prefer_daemon` in the binding, so an adapter or
a CI script can turn the daemon on without code changes.

## 10. Benchmark (acceptance, from issue #40)

Target: a **no-op warm run** (store primed, nothing changed, `--daemon` on a
healthy daemon) completes in **< 500 ms** end-to-end from the adapter's
`run` entrypoint, measured wall time.

Method: reuse the existing `benchmarks/` harness. Add a `daemon` scenario that:
1. starts a daemon for the stress-monorepo store,
2. runs a no-op `run --daemon` N=20 times,
3. reports median/p95.

This is measured on implementation; the target is recorded here so the
implementation step has a fixed acceptance number. Baseline to beat: the
no-op warm run today (child `serve`), which the T-05 fast path already took
from ~5 s to ~1 s on the Node adapter; the daemon must take the remaining
spawn cost (~100–300 ms) off the full-run path and leave the fast path
unchanged.

## 11. Open questions (to resolve at implementation)

1. **Default on/off.** Ship `--daemon` off-by-default (flag + env var) and
   flip the default only after the §10 benchmark passes on CI, not locally.
2. **Daemon lifetime policy.** No auto-shutdown in v1: a daemon lives until
   `daemon stop`, SIGTERM, or the store's lock is deleted. (Auto-idle-timeout
   is a possible v2; it adds a timer the engine does not have today and risks
   a daemon dying mid-run under load.)
3. **One daemon per machine or per store.** Per store, as designed. A machine
   running several checkouts runs several daemons; each is bounded by one
   store's working set.
4. **`explain`/`forget` via daemon.** Yes — they are read/lock-free and go over
   the same connection, at no extra cost.

## 12. Rollout

1. Engine: socket transport + `daemon` identity in `hello` + `daemon`
   subcommand (start/status/stop) + ignore `shutdown` on daemon connections.
2. Node binding: `connect({daemon})` + `run --daemon` flag +
   `INCREMENTAL_DAEMON` env var. (Node first: it owns the benchmark harness and
   the T-05 fast path.)
3. Rust and Python bindings: same `daemon` option.
4. Benchmark scenario + record in `evidence/`.
5. Flip the default on for the Node adapter once §10 passes on CI.

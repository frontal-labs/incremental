# Store format v1 (from  sections 6, 7.4, 7.6)

## Files in `<store>/`

| File         | Kind                                     | Notes                                                                         |
| ------------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `tg.log`     | canonical, append-only JSON Lines, UTF-8 | Source of truth (D-4)                                                         |
| `tg.lock`    | local                                    | Exclusive-create lock: `{"pid": N, "start": "<start time>"}`                  |
| `stat.cache` | local                                    | Verify-mode cache, safe to delete (6.3, 7.6)                                  |
| `tg.idx`     | cache                                    | Index image, format 3. Stale or damaged: ignored, log replayed (see DECISIONS.md, index load fix) |

The on-disk prefix `tg.*` is kept until E0 decides it .

## Log records (as implemented, D-E2-03)

Each line is one JSON object with a record type in `r`. The core reads the whole log at start and applies each record in order.

```
{"r":"hdr","v":1,"hash":"sha256","created":"<RFC 3339 UTC>"}     first line, written by init
{"r":"obs", <the observation's own members: task, baseline, dirty,
             context, inputs, outcome, duration_ms, ...>}          one observation
{"r":"forget","task":"..."}
{"r":"baseline","value":"..."}                                    written by advance
```

Rules:

- The `obs` record holds the observation exactly as `observe` received it, with `"r":"obs"` added. Members are re-serialized in received order. Inputs are inline (`{"kind":"file","path":...,"hash":...}`). There is no interning (`path`, `fv`, `cid`), so the interning records of 6.1 are not written. See D-E2-03.
- The latest `obs` per task wins. A later `forget` removes the task until its next `obs`.
- The latest `baseline` record is `B`. A log with no `baseline` record has `B = null`.
- A line that does not parse is ignored only if it is the final line (a truncated tail). A non-final line that does not parse is `store_corrupt` (exit 3). Records with an unknown `r` are skipped (C36, C37).

## Context

`context` records hold the fields of an observation's `context` object. The engine compares `lockfile`, `tsconfig`, `pkgjson`, `runner`, `node`, `fmt`, `caps` (reserved, 8.4) and any key listed in `fallbackContextKeys`. Other adapter keys are stored and not compared at plan time.

## graph_version

`g_` followed by the first 8 lowercase hex characters of `SHA-256( ASCII-decimal(log length in bytes) || last 1024 bytes of the log )`. For a log shorter than 1024 bytes, use all of it. Deterministic for a given log file.

## Stat cache

`stat.cache` is a JSON object: `{"<path>": {"size": N, "mtime_ns": N, "hash": "sha256:..."}}`. Written only by verify mode. Reuse rule: if `size` and `mtime_ns` match the file, use `hash` without reading the file. Otherwise hash the file and rewrite the entry.

## Lock

`tg.lock` is created with exclusive create (`wx`). Content: `{"pid": N, "start": "<process start time>"}`. A holder is stale if its PID is not alive, or if the PID is alive but its start time differs (PID reuse). A stale lock is taken over. A live lock is retried for up to 5 s, then `lock_busy` (exit 5). Each write takes the lock, appends, and releases it.

## Compaction (7.4)

`compact` writes a new log to a temp file with the header, live contexts and paths, the latest observation per task, and the latest baseline. It then renames it over `tg.log`. Not implemented in this milestone.

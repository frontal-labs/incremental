# INCREMENTAL STORE FORMAT

## Store Directory

Default: `<repo>/.incremental/` (configurable via `INCREMENTAL_STORE` or `--store`)

| File         | Kind                                     | Notes                                                 |
| ------------ | ---------------------------------------- | ----------------------------------------------------- |
| `tg.log`     | Canonical, append-only JSON Lines, UTF-8 | Source of truth                                       |
| `tg.lock`    | Local                                    | Exclusive lock: `{"pid": N, "start": "<start time>"}` |
| `stat.cache` | Local                                    | Verify-mode cache for file hashes; safe to delete     |
| `tg.idx`     | Cache                                    | Index image, format 3. Stale or damaged: ignored, log replayed                     |

## Log Records

Each line is JSON object with `r` (record type). First line must be `hdr`.

```json
{"r":"hdr","v":1,"hash":"sha256","created":"<RFC3339 UTC>"}        // required first
{"r":"context","cid":3,"fields":{...}}                              // context record
{"r":"path","id":5,"path":"packages/core/src/math.ts"}              // interned path
{"r":"fv","id":17,"path":5,"hash":"sha256:..."}                     // file version
{"r":"task","id":"packages/core/src/math.test.ts"}                  // optional declaration
{"r":"obs","task":"...","cid":3,"baseline":"...","dirty":false,
   "inputs":[{"k":"file","fv":17},{"k":"dir","p":9},{"k":"probe","p":40},
             {"k":"env","name":"X","vh":"sha256:..."},
             {"k":"env_all","snapshot":{"X":"sha256:..."}},
             {"k":"declared","fv":18}],
   "outputs":[],"outcome":"pass","ms":412,"at":"<RFC3339 UTC>"}
{"r":"forget","task":"..."}
{"r":"baseline","value":"...","at":"<RFC3339 UTC>"}
```

**Rules:**

- `path` or `fv` must precede first use in `obs`
- `env` input `vh` is value hash or literal `"unset"`
- Latest `obs` per task wins; later `forget` removes task until next `obs`
- Latest `baseline` record is store baseline `B`; no baseline record means `B = null`
- Readers ignore truncated final line and skip unknown `r` values (non-tail corrupt records cause `store_corrupt`)

## Compact Log Encoding

Inputs use compact keys in log: `k`, `fv`, `p`, `name`, `vh`. This keeps log small.

## graph_version

`g_` + first 8 hex chars of `SHA-256(ASCII-decimal(log_length_bytes) || last_1024_bytes_of_log)`. For logs < 1024 bytes, use all bytes.

## Stat Cache

`<store>/stat.cache`: `{"<path>": {"size": N, "mtime_ns": N, "hash": "sha256:..."}}`
Reuse: if `size` and `mtime_ns` match file, use cached hash without reading. Otherwise hash and update. Written only by verify mode. Safe to delete.

## Lock

`tg.lock`: exclusive create (`wx`), content `{"pid": N, "start": "<process start time>"}`
Stale if PID dead or PID alive but start time differs (PID reuse). Retry up to 5s, then `lock_busy`. Each write takes lock, appends, releases.

## Compaction

`incremental compact` rewrites log keeping live contexts/paths, latest obs per task, latest baseline. Writes to temp then renames. Not implemented yet.

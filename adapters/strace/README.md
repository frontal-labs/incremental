# @incremental/strace: native strace oracle (Linux)

Native recorder for Linux: runs a command under `strace` and reports the paths
it touches, as `file`, `dir`, `probe` and `exec` inputs. It is the oracle that
tests the Vitest Node recorder's completeness (PLAN §11.5, milestone E5) and a
fallback for native tools (`fs`, `process`) on Linux.

## Command

```
strace -f -e trace=openat,open,openat2,stat,newfstatat,statx,access,faccessat,faccessat2,getdents64,readlink,readlinkat,execve -o <file> -- <cmd>
```

## What it reports

- **files** — successful read-mode opens and successful stats of regular files
- **dirs** — successful `getdents64` on directory file descriptors
- **probes** — lookups that failed (ENOENT or otherwise)
- **execs** — programs executed with `execve`

Paths are `realpath`'d, confined to the configured `roots`, excluded of
`node_modules`, `.git` and `.incremental`, and returned repo-relative with `/`
separators — the same canonicalization as the Vitest recorder (PLAN 11.4).
strace cannot see environment reads (PLAN 11.5).

## Rule

The Node (Vitest) recorder MUST contain every path the strace oracle sees,
after exclude and realpath. Gaps are recorder bugs and can never be waived:
fix the recorder, or set the capability false and log it in `FRICTION.md`.

## Package layout

- `src/oracle.ts` — `runOracle(command, opts)` spawns strace and parses its
  log; `parseStraceLog(text, opts)` parses strace output text without starting
  any process (testable on any platform).
- `tests/` — parser unit tests (all platforms) and the M10 fixture comparison
  (Linux only): every oracle path must be in the Vitest recorder's input set.

## Verify

```
make test-oracle   # Linux only: parser tests + M10 fixture comparison
```

It runs inside `make linux-gate` (Docker, `docker/Dockerfile.linux` installs
`strace`). On macOS the parser tests run and the M10 test skips.

## Consumers

- `@incremental/fs` — `recordOracle` runs a command under the strace oracle on
  Linux and records the observed files, dirs and probes (caps: probes/dirs
  true, env false). On macOS only declared inputs are available.
- `@incremental/process` — `runTask` with `oracle: true` runs the command under
  the strace oracle on Linux (child-process executions visible via `execve`).

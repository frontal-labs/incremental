# INCREMENTAL ADAPTERS

## Adapter Types

| Adapter          | Status  | Role                                                                      |
| ---------------- | ------- | ------------------------------------------------------------------------- |
| `vitest`         | v1      | Recorder and planner for test files                                       |
| `strace` (Linux) | v1      | Native recorder: oracle for Node recorder, fallback for native tools      |
| `git`            | v1      | ChangeSets from baseline to worktree (committed/staged/untracked/renames) |
| `mcp`            | v1 (E8) | Agent interface over Node client                                          |
| `tsc/bundler`    | later   | Observed build inputs for Turborepo/Nx (no outputs stored)                |
| `ci`             | later   | Job planning from plans                                                   |
| `pytest` others  | later   | Separate decision                                                         |

## Recorder Contract

Any recorder must:

1. Every reported input was actually used by task during run
2. Every path canonical (realpath) and repo-relative with `/` separators
3. Every hash computed from file content at time read
4. Runs that can't be observed completely recorded with `dirty: true` or capability false - never missing inputs as complete

## Vitest Adapter

**Location**: `adapters/vitest/`

### Recorder (preload)

- Loaded via `NODE_OPTIONS` (`--import` for ESM, `--require` for CJS)
- Wraps `fs` API (sync/callback/promise/streams): read, open, stat, lstat, access, exists, readdir, realpath, readFile, createReadStream
- Wraps module loading
- Replaces `process.env` with Proxy recording `get`, `has`, `ownKeys`
- Each test file runs in own forked process (Vitest `forks` pool, D-12) - observations belong to exactly one task
- Writes observations to `INCREMENTAL_TRACE_OUT` at exit, then sent via `observe`
- Canonicalize paths with `realpath` before exclude matching and interning
- Worker threads: if test starts `worker_threads`, observation gets `caps.probes` and `caps.dirs` false for that task
- Dynamic imports/require with computed paths observed by wrappers (not guessed)
- Capabilities `probes`, `dirs`, `env` only true if proven on fixture

### Planner

- Task IDs are repo-relative test file paths
- Fallback plan runs every known test file
- Command: `incremental vitest run [--base REF] [--json] [--all] [--jobs N]`
  - Computes plan, runs invalid test files with recorder in parallel (N = CPU count default)
  - Writes JSON results if requested
  - Follows adapter loop (10.4)
- `--shadow`: runs everything, reports what plan would skip, never advances baseline (for measuring before trusting)

### Git Change Source

- Committed/staged: `git diff --name-status -M B`
- Untracked: `git ls-files --others --exclude-standard` as `added`
- Renames via `-M` reported as `renamed` with `old_path`
- Requires git repo (non-git unsupported in v1)
- Shallow clones missing history to reach B → `invalid_params`, adapter runs everything and says so

### Canonical Paths & Symlinks

Workspace packages reached via `node_modules` symlinks resolve to real location. Recorder records real path; `exclude` applied to real paths. Fixture includes workspace-symlink shape (conformance V07).

## Strace Oracle (Linux) — `adapters/strace`, package `@frontal-labs/incremental-strace`

```bash
strace -f -e trace=openat,open,openat2,stat,newfstatat,statx,access,faccessat,faccessat2,getdents64,readlink,readlinkat,execve -o <file> -- <cmd>
```

`src/oracle.ts` runs that command and parses the log: `runOracle(command, opts)` spawns strace (Linux only), `parseStraceLog(text, opts)` parses strace output text on any platform. Reports `files` (successful read opens and stats of regular files), `dirs` (`getdents64` on directory fds), `probes` (failed lookups) and `execs` (`execve` targets), all realpath'd, confined to `roots`, excluded of `node_modules`/`.git`/`.incremental`, repo-relative with `/` separators — the same canonicalization as the Vitest recorder . strace cannot see env reads .

**Rule**: the Node recorder must contain every path the strace oracle sees (after exclude/realpath). The recorder-completeness comparison reports zero gaps. Gaps are recorder bugs and can never be waived.

Consumers:

- `@frontal-labs/incremental-fs` — `recordOracle(client, spec, baseline, runOracle)` runs a command under the oracle on Linux and records observed files/dirs/probes (`caps: {probes: true, dirs: true, env: false}`).
- `@frontal-labs/incremental-process` — `runTask` with `oracle: true` runs the command under the oracle on Linux (child processes visible via `execve`).

## Adapter Loop Contract

```bash
B   = incremental baseline
ch  = changes from B to worktree (git change source)
plan = incremental affected --baseline B --changes ch --context ctx
for each task in plan.deleted_tasks:  incremental forget
run each task in plan.tasks while recording observation
if every task in plan.tasks ran and worktree clean and HEAD unchanged:
    incremental advance --to HEAD --expected B
else:
    do not advance; report why; exit with code 7
```
Exit code 7 = "ran but baseline not advanced" (distinct from failure).

## MCP Server (E8)

Tools over MCP stdio using official MCP SDK:

| Tool                 | Input                                                   | Output       |
| -------------------- | ------------------------------------------------------- | ------------ |
| `affected_tasks`     | `{verify?}` (builds ChangeSet from git, passes context) | Plan         |
| `record_observation` | Observation                                             | `{accepted}` |
| `engine_status`      | none                                                    | Stats        |

Tool descriptions one sentence each. Server must send context and baseline on every query so `context_missing` never fires through MCP in normal use.

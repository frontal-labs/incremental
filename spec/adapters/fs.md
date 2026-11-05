# fs adapter

Status: built (adapters/fs, make test-fs). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/fs/README.md on 2026-11-04.
PLAN tier: later. Overlaps with the strace recorder (PLAN §11.5).

## Purpose
A generic file-read recorder for tasks that are not Vitest tests and not a known tool. It is the general form of what the Vitest recorder does through its preload.

## Task
Any command the caller runs (`recordOracle` runs `spec.command`). Task id: a stable name the caller gives in `task`, never a path or a pid (D-2).

## What it can observe
- Declared paths, hashed before and after the check. They are recorded as `declared` inputs (PLAN §9.5). A missing path is recorded as `absent`, so creating it later invalidates the task (P6).
- A declared input that changes while the check runs makes the observation `dirty`.
- On Linux: `recordOracle` runs the command under strace (an injected runner, typically `@incremental/strace`) and records the files, dirs and probes it observes (PLAN §11.5). On macOS nothing beyond the declared paths is observed.

## What it cannot observe
- Undeclared reads. On macOS there is no supported syscall tracer, so a read that is not declared is never reported, and the task is protected only for its declared paths. Without the Linux oracle, every observation is `dirty` unless `complete: true` is set.
- Dirty by default. Without `complete: true` every observation is `dirty`, so the task is never skipped. `complete: true` is the caller's assertion that `declared` lists every file the task reads. It is not checked.
- Probes, directory listings and environment reads, without the oracle. `caps.probes`, `caps.dirs` and `caps.env` are false, so the engine falls back on added or modified files that no task declares (P6, P7). The oracle sets `caps.env` false too: strace cannot see environment reads.
- Reads through memory-mapped files after open, depending on the tracer.
- Reads from paths outside the configured roots (excluded by design).
- Globs. Not supported. Declared entries are literal repo-relative paths.

## Declared inputs
- Literal repo-relative paths the task is known to need, recorded as `declared` (PLAN §9.5). A missing path is recorded as `absent`.

## Cases (not in the conformance suite, PLAN §12)
The adapter is not in the conformance suite. Behaviors to check:
- Linux: a read the task makes is recorded, and its change invalidates the task.
- macOS: an undeclared read is not protected; without `complete: true` the run is `dirty`.
- An ENOENT probe is recorded, and creating the file invalidates the task (P6).

## Open questions
- None. Whether to ship this on macOS is answered by the build: it ships, protects declared paths only, and is `dirty` by default (README).

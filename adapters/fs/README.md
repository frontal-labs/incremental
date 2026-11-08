# @frontal-labs/incremental-fs

Generic file-read recorder (spec/adapters/fs.md, , 11.5). It records a task's declared inputs and observes a check the caller runs. It is the base of `@frontal-labs/incremental-process`.

## What is observed

- Declared paths, hashed before and after the check. They are recorded as `declared` inputs . A missing path is recorded as `absent`, so creating it later invalidates the task.
- A declared input that changes while the check runs makes the observation `dirty`.

## What is not observed (gaps)

- **Undeclared reads.** On macOS there is no supported syscall tracer, so a read that is not in `declared` is not an input and is never reported. Such a task is protected only for its declared paths.
- **Dirty by default.** Without `complete: true` every observation is `dirty`, so the task is never skipped. Setting `complete: true` is the caller's assertion that the list is complete. It is not checked.
- **Probes, directory listings and environment reads.** Not recorded. The context sets `caps.probes`, `caps.dirs` and `caps.env` to false, so the engine falls back on added or modified files that no task declares (P6, P7).
- **Linux strace oracle .** `recordOracle(client, spec, baseline, runOracle)` runs `spec.command` under `strace` (the injected `runOracle`, typically `@frontal-labs/incremental-strace`'s) and records the observed files, dirs and probes. `caps.env` is false: strace cannot see environment reads. Available on Linux only; on macOS nothing changes.
- **Memory-mapped reads, paths outside the root.** Not observed.
- **Globs.** Not supported. Declared entries are literal repo-relative paths.

## Tests

`npm test` in this directory. Each test runs against the real engine in a scratch repository.

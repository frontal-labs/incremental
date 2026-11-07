# process adapter

Status: built (adapters/process, make test-process). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/process/README.md on 2026-11-04. .

## Purpose

Runs a command as a task and records its outcome and, on Linux with `oracle: true`, its child processes. It is the generic runner that the other recorders can sit on top of. Tasks run here are what the adapter loop executes.

## Task

A named command from the adapter config (`incremental-process.json`). Task id: the config name (D-2), never a pid or a timestamp. `command` is argv, not a shell line.

## What it can observe

- Outcome: `pass` (exit 0), `fail` (non-zero exit; the engine invalidates the task on its next plan, `failed_outcome`, P9), or `error` (the program could not start, was killed by a signal, or timed out). Duration is recorded.
- Child process executions, on Linux only, for tasks with `oracle: true`, via `execve` in the strace oracle . macOS has no tracer.

## What it cannot observe

- Output-based side effects: files written are outputs, and the engine does not store outputs .
- Network calls the command makes.
- Environment reads, unless the env adapter lists the variables.
- Undeclared reads. Every observation is `dirty` unless the task sets `complete: true`, which the engine takes on trust.

## Declared inputs

- The command's declared input paths (repo-relative), hashed before and after the command. Globs and pipes are not expanded, because no shell is used.
- A declared input that changes while the command runs makes the observation `dirty`.

## Adapter tests

`adapters/process/tests/process.test.ts` runs the real engine in scratch git repositories. These are adapter tests, not conformance cases (see below). They cover: a passing command recorded as `pass`, with a complete declaration clean; a non-zero exit as `fail` and invalidated; a command that cannot start as `error`, not observed; a timed-out command as `error`; a declared input changed during the run as `dirty`; a declared input changed later invalidating the task; an unknown task name rejected before anything runs; and the CLI exit codes. One test exercises the strace oracle and skips on non-Linux.

## Gaps

- The adapter is not in the conformance suite . The cases above are adapter tests only.
- Baseline advance is not done here. The TypeScript adapter loop advances and owns exit code 7.
- A declared path outside the repository, or one that cannot be read, is reported as `error` and not observed.

## Open questions

- None open in the README or DECISIONS.md. The "generic runner needed?" question was settled by the 2026-11-03 build instruction (DECISIONS.md, "Adapters and bindings built from spec/adapters"). That entry does not discuss overlap with `incremental vitest run` and the MCP server.

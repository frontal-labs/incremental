# process adapter (draft, not approved)

Status: draft. PLAN tier: later.

## Purpose
Runs a command as a task and records its outcome and its child processes. It is the generic runner that the other recorders can sit on top of. Tasks run here are what the adapter loop (PLAN §10.4) executes.

## Task
A named command from the adapter config. Task id: the config name (D-2), never a pid or a timestamp.

## What it can observe
- Exit code and whether it ran to completion (`failed_outcome` rule, P-series in POLICY.md).
- Child process executions, on Linux via `execve` in the strace oracle (PLAN §11.5).

## What it cannot observe
- Output-based side effects: files written are outputs, and the engine does not store outputs (PLAN §4.3, `tsc` note).
- Network calls the command makes.
- Environment reads, unless the env adapter lists the variables.

## Declared inputs
- The command's declared input paths and globs.

## Conformance cases (to write)
- A non-zero exit is recorded as a failed outcome and is not treated as a clean run.
- A command that changes a declared input after it starts is `dirty`.
- A child process change is visible through the oracle on Linux.

## Open questions
- Whether a generic runner is needed at all, given `backplane vitest run` and the MCP server already run tasks. Adding one adds a second run path that also has to follow §10.4.

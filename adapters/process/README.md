# @backplane/process

Generic task runner (spec/adapters/process.md, PLAN 10.4). It runs a named command from `backplane-process.json`, records its outcome, and records its declared inputs through `@backplane/fs`.

## Config

```json
{ "tasks": { "lint": { "command": ["node", "lint.js"], "cwd": "tools", "declared": ["tools/lint.js"], "complete": true } } }
```

`command` is argv, not a shell line. Task ids are the config names (PLAN D-2).

## Outcomes

- `pass`: exit 0.
- `fail`: non-zero exit. The engine invalidates the task on its next plan (`failed_outcome`, P9).
- `error`: the program could not start, was killed by a signal, or timed out. Recorded as an error outcome.
- A task whose declared path is outside the repository, or cannot be read, is reported as `error` and not observed.

## What is observed

- The outcome above and the duration.
- Declared inputs, hashed before and after the command (see `@backplane/fs`). A declared input that changes while the command runs makes the observation `dirty`.

## What is not observed (gaps)

- **Child processes.** Not recorded. The Linux `execve` oracle (PLAN 11.5) is not implemented, and `strace` is not available on this machine.
- **Undeclared reads, network calls, environment reads.** Not recorded. Every observation is `dirty` unless the task sets `complete: true`, which the engine takes on trust.
- **Output files.** Not stored (PLAN 4.3). The command's writes are not outputs.
- **Shell features.** No shell is used, so globs and pipes in `command` are not expanded.
- **Advancing the baseline.** Not done here. The TypeScript adapter loop (PLAN 10.4) owns advance and exit code 7.

## CLI

`backplane-process run [NAME...] [--root DIR] [--store DIR] [--timeout MS]`. Exit codes: 0 every task passed, 1 a task failed, 2 usage error, 4 engine or setup error, or a task that could not run.

## Tests

`npm test` in this directory. The tests run the real engine in scratch repositories. There are no Linux-only tests, because the child-process path is not built.

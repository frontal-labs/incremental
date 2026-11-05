# env adapter

Status: built (adapters/env, make test-env). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/env/README.md on 2026-11-04.
.

## Purpose
Environment variables are observation inputs . This adapter records which variables matter and captures their values as hashes in each recording task's observation inputs, so that a changed variable is a reason to re-run the task that recorded it.

## Task
None. It is not a task runner. Each task that lists variables gets an `env` input per variable in its observation. Names are not put in `fallbackContextKeys`: a changed context key would fall back every task (P2).

## What it can observe
- Only the variables the caller lists for a task (`names`), or every variable for a task with `envAll` (compared against a snapshot when one is given). The adapter never reads `process.env`; the caller passes `env` in. An unset variable is recorded as `unset`.

## What it cannot observe (the core gap)
- Reads that a task makes of variables the adapter did not list. The strace oracle cannot see environment reads . So a task that reads an unlisted variable is not protected. Either list the variable, use `envAll`, or set `caps.env` false and run the task dirty.
- Variables read by a child process started by the task.
- `envAll` is noisy: volatile variables (for example `PWD`, `OLDPWD`, `SHLVL`, `_`) change between runs and cause re-runs. `caps.env` says whether `envAll` is in use; it is not a claim about individual reads.

## Declared inputs
- Per task, in the `recordTasks` input: a list of variable names (`names`), or `envAll`. Unlisted names are not hashed.

## Cases (not in the conformance suite, )
The adapter is not in the conformance suite. The README's behaviors, tested in `test/env.test.ts` through the real engine:
- A listed variable changes, and the dependent task is invalid (`env_changed:<NAME>`).
- An unlisted variable changes, and the task is not invalid (documented gap, not a bug).
- `env_all` with a snapshot: an unchanged environment is valid; a changed variable gives `env_all_changed`. With no snapshot, `env_all` counts as changed.

## Open questions
- None. The spec's question, an allowlist or every variable, is answered by the build: per-task `names` by default, and `envAll` for every variable (README, Behavior and Gaps).

# config adapter

Status: built (adapters/config, make test-config). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/config/README.md on 2026-11-04.

## Purpose
Not a task runner. The config adapter records config files as declared inputs, so that other adapters can name them in `globalInputs` (docs/spec/CONFIGURATION.md) and so that a change to shared config invalidates the right tasks.

## Task
None of its own. Built: `recordTasks` produces one observation per task the caller supplies. Each task declares every global input plus its own `declares` list. Observations are of kind `declared` (PLAN §9.5), with content hashes.

## What it can observe
- The file path and its content hash. It cannot observe whether a task read the file, so it is only correct when the config is listed as global or the task's own recorder records the read.
- Built: a declared config that is absent and later created invalidates its task (P3, since the path is indexed).
- Built: glob matches in `globalInputs` are computed by walking the repo at observation time (excluding `node_modules`, `.git`, `.incremental`).

## What it cannot observe
- Whether a given tool actually read the file. If a config is not global, it must not be used as a skip input without the tool's own recorder.
- Built: caps are the caller's claim, and the adapter records no probes and no dirs. With caps false (the default), a modified file that no task declares falls back (`unobserved_input`), so it is not a silent skip. With caps `probes` and `dirs` true, that file is listed as `unobserved` and no task is invalidated. That is correct only if the task's recorder records probes and dirs and the task does not read the file (checked by the adapter's "documented gap" test).
- Built: a file that matches a glob only after observation is seen as a changed path matching `globalInputs`, which falls back.
- Built: `incremental.config.json` itself is not an input of any task unless a task declares it.

## Declared inputs
- Whatever `incremental.config.json` lists under `globalInputs` (PLAN §6.7), and each task's own `declares` list. Built: the `adapters` key named here is not read by `adapters/config/src`; this line is not confirmed from the README or code (see report).

## Conformance cases
The adapter is not in the conformance suite (PLAN §12.1, §12.3 cover the Vitest adapter only). The cases below are intended checks, not suite cases. The adapter's own wiring tests (`test/config.test.ts`, through the real engine) are not listed here.
- A changed global input invalidates every task. Built: the change falls back (`global_input`, P1) and invalidates every known task.
- A changed non-global input does not invalidate tasks that never declared it. Built: it invalidates the declaring task (`declared:<path>`, P3). Undeclared changes fall back under the default caps (see "What it cannot observe").

## Open questions
- None open. Whether `config` should be a separate adapter was answered by building it as one (`@incremental/config`, DECISIONS 2026-11-03).

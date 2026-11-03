# config adapter (draft, not approved)

Status: draft. PLAN tier: later.

## Purpose
Not a task runner. The config adapter records config files as declared inputs, so that other adapters can name them in `globalInputs` (docs/CONFIGURATION.md) and so that a change to shared config invalidates the right tasks.

## Task
None. The adapter produces observations of kind `declared` (PLAN §9.5), keyed by repo-relative path.

## What it can observe
- The file path and its content hash. It cannot observe whether a task read the file, so it is only correct when the config is listed as global.

## What it cannot observe
- Whether a given tool actually read the file. If a config is not global, it must not be used as a skip input without the tool's own recorder.

## Declared inputs
- Whatever `backplane.config.json` lists under `globalInputs` and `adapters` (PLAN §6.7).

## Conformance cases (to write)
- A changed global input invalidates every task.
- A changed non-global input does not invalidate tasks that never declared it.

## Open questions
- Whether `config` should be a separate adapter, or just a section of `backplane.config.json`. The second is simpler and may be the right answer.

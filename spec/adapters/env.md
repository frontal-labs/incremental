# env adapter (draft, not approved)

Status: draft. PLAN tier: later.

## Purpose
Environment variables are a context input (PLAN §8.4 and D-E1-02). This adapter records which variables matter and captures their values as hashes in the observation context, so that a changed variable is a reason to re-run.

## Task
None. It supplies context: a map from variable name to hash, and the names are listed as `fallbackContextKeys` where they are adapter-added (PLAN §6.7).

## What it can observe
- Only the variables it is told about. The adapter reads them from the process environment at observation and query time.

## What it cannot observe (the core gap)
- Reads that a task makes of variables the adapter did not list. The strace oracle cannot see environment reads (PLAN §11.5). So a task that reads an unlisted variable is not protected. Set `env` capability false, or mark the run `dirty`.
- Variables read by a child process started by the task.

## Declared inputs
- A list of variable names in the adapter config. Unlisted names are not hashed.

## Conformance cases (to write)
- A listed variable changes, and the dependent task is invalid.
- An unlisted variable changes, and the task is not invalid (documented gap, not a bug).
- `env_all` with a snapshot (D-E1-02) is compared.

## Open questions
- Whether an allowlist of names is enough, or whether the adapter should capture every variable and accept more re-runs. The second is safer and much noisier.

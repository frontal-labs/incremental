---

name: incremental-engine
description: Operate the Incremental engine from the CLI or the Node client - create a store, record task observations, set the baseline, ask which tasks are invalid (affected), explain a task, forget tasks, and check store health. Use when a user wants to know which tasks to rerun after a change, or to inspect or repair an Incremental store.
---

# Incremental engine

Incremental records what each task reads, lists, probes and writes, and answers one question: given the changes since the last known-good baseline, which tasks are invalid, and why. A task may be skipped only with a certificate: an observation at the current baseline whose inputs are all unchanged. Unknown or unverifiable input makes the task invalid, or makes the whole answer a fallback. It never skips silently.

## Store

- Default store: `<repo>/.incremental/`. Override with `--store DIR` or `INCREMENTAL_STORE`.
- `tg.log` is the source of truth (JSON Lines, append-only). Indexes are caches and can be rebuilt.
- Store state: observations, the baseline, and the last `advance`. Files: `tg.lock`, `stat.cache`, `tg.idx`.

## CLI

The binary is `core/dist/incremental`. Build it with `make build` first.

```sh
STORE=.incremental
core/dist/incremental init --store $STORE                         # create the store (no baseline yet)
core/dist/incremental stats --store $STORE --json                 # tasks, observations, baseline
core/dist/incremental observe --store $STORE --file obs.json      # record one Observation
core/dist/incremental advance --store $STORE --to <SHA> --expected null
core/dist/incremental affected --store $STORE --changes changes.json --baseline <SHA> --context context.json
core/dist/incremental explain --store $STORE --task <TASK>        # why a task is or is not invalid
core/dist/incremental forget --store $STORE --task <TASK>         # drop a task's observations
core/dist/incremental compact --store $STORE                      # no-op in this build; see below
core/dist/incremental serve --store $STORE --root .               # protocol v1 over stdio (JSON Lines)
```

- `affected` reads `changes.json` (`{"baseline", "head", "changes": [{"path", "status"}]}`) and a context file (see below). Options: `--policy balanced|conservative` (default `balanced`), `--verify` (hash every recorded file; use for audits, not the warm path), `--env FILE`.
- `advance --expected` must match the current baseline (`null` before the first advance). A mismatch fails with `baseline_conflict` and exit code 6. It never overwrites.
- `compact` runs but changes nothing in this build (the store size is the same before and after). `docs/spec/FORMAT.md` says compaction is not implemented yet. Do not rely on it to shrink a store.
- A query on a store with no baseline returns a fallback, not a plan. Run an `advance` first.

## Context

Every observation and every `affected` query carries a context. It is the set of global facts that change what a task's result means:

```json
{
  "lockfile": "sha256:...",
  "tsconfig": "sha256:...",
  "pkgjson": "sha256:...",
  "runner": "vitest@4.1.12",
  "node": "22.11.0",
  "fmt": 1,
  "caps": { "probes": false, "dirs": false, "env": false }
}
```

A query fails over to a fallback (`context_changed`, P2) when a reserved context key, or a key listed in `fallbackContextKeys`, differs from the store's context. Set `caps` to `true` only when the adapter really records probes, directory listings or environment reads. Otherwise a change to an unobserved path falls back (P6/P7). See `docs/spec/POLICY.md` for the full rule order.

## Node client

```ts
import { connect, isIncrementalError } from "@frontal-labs/incremental-client";

const client = await connect({ root: process.cwd }); // store: $INCREMENTAL_STORE or <repo>/.incremental
try {
  const { baseline } = await client.baseline;
  const plan = await client.affected(changeSet, { baseline: baseline!, context });
  for (const t of plan.tasks) console.log(t.id, t.reasons);
} catch (e) {
  if (isIncrementalError(e)) console.error(e.code, e.message);
  else throw e;
} finally {
  await client.close;
}
```

The client exposes `hello`, `observe`, `observeMany`, `baseline`, `advance`, `affected`, `explain`, `forget`, `stats`, `compact`, `close`. It restarts the server if it dies, unless `restart: false`.

## Reading a plan

- `tasks[].reasons` says why a task is selected, for example `reads:src/math.ts`, `dirty_observation`, `fallback`.
- `skipped` counts tasks with a valid certificate. `total_tasks` is everything the engine knows about.
- `fallback` is non-null when the engine ran everything instead of answering per task. Read `fallback.reason` before trusting a small plan.
- `confidence` is a label set by the policy (`medium` in ordinary plans). It is not a probability.

## Checks before you trust a plan

1. `stats` shows a baseline, and it matches the commit you are testing.
2. The context in the query equals the context in the observations (same lockfile hash, runner, node version).
3. Dirty observations (`dirty: true`) are always rerun. A worktree that changed during a run does not advance the baseline.
4. Non-file inputs (time, network, randomness, unlisted environment variables) are not observed. A task that depends on them is not protected. See the Limits section of `README.md`.

## Reference

- `docs/spec/PROTOCOL.md`: methods, errors, handshake.
- `docs/spec/POLICY.md`: rules P0 to P11 and fallback priority.
- `docs/spec/FORMAT.md`: store layout and log records.
- `docs/spec/CONFIGURATION.md`: `incremental.config.json` and CLI options.

---
name: incremental-adapter
description: Write or review an Incremental adapter - an observer that records one task's reads, lists, probes, writes and outcome, and feeds changes into the engine. Use when adding support for a new tool or runner, or when checking that an adapter does not skip a task it cannot prove unchanged.
---

# Write an Incremental adapter

An adapter answers two questions for the engine: what does each task depend on, and what happened when it ran. The engine answers which tasks to rerun. An adapter never decides skips itself. The rule is: a task may be skipped only when its observation is clean, at the current baseline, and every input it recorded is unchanged. Anything the adapter cannot observe must make the observation `dirty`, or set the matching capability to `false`. Gaps are declared, never hidden.

## Required pieces

1. **Task id.** One repo-relative string per unit of work (for example `packages/app#build`, `tests/a.spec.ts`). Stable across runs.
2. **Discovery.** Ask the tool, not your own glob, what the tasks are when it can list them (for example `playwright test --list`).
3. **Inputs.** Every file the task reads that you can name: `{kind: "file", path, hash}`, plus `dir`, `probe`, `declared`, `env`, `env_all` where the adapter observes them. Hash before the run, not after.
4. **Context.** Lockfile hash, runner version, node version, `fmt`, and `caps`. Set `caps.probes`, `caps.dirs` and `caps.env` to `true` only when the adapter really records them.
5. **Observation.** `{task, baseline, dirty, context, inputs, outputs, outcome, duration_ms}`. `outcome` is `pass`, `fail`, `error` or `none`. Set `dirty: true` when anything the run read is unobserved.
6. **Advance.** Only advance the baseline after every selected task ran, the worktree is clean and HEAD did not move. Otherwise exit with the "ran, not advanced" code and leave the baseline in place.

## Node client flow

```ts
import { connect, repoRoot } from "@incremental/client";

const root = repoRoot();
const client = await connect({ root });
const { baseline } = await client.baseline();
const plan = await client.affected(changeSet, { baseline: baseline ?? headSha, context });
for (const task of plan.tasks) {
  // run the task, collect its inputs, then:
  await client.observe({ task: task.id, baseline: headSha, dirty, context, inputs, outputs: [], outcome, duration_ms });
}
await client.advance(headSha, baseline);
await client.close();
```

Use `observeMany` for batches. Use `explain` to debug a plan, and `forget` for tasks a tool removed. Read `plan.fallback` before you trust a short task list.

## Checklist for a review

- [ ] Every input the tool reads is recorded, or the observation is `dirty`. Read the tool's own docs or source to decide; do not guess.
- [ ] Declared inputs say what they are: a user-written list of files (for example the `confined` list in `incremental-pnpm.json`) is a claim, and the adapter cannot verify it. Mark it as a claim in the README.
- [ ] Hashes are taken before the task runs.
- [ ] Capabilities match what is observed. A `probes: true` with no probe inputs is a bug.
- [ ] Failures of the tool itself (spawn error, timeout, bad config) are `error`, and they block advance.
- [ ] The adapter has tests against a scratch git repository and the real engine. Add a `make test-<name>` target, and add it to `test-adapters` in the Makefile.
- [ ] Its README lists what is real, what is declared, and the gaps. Its spec in `spec/adapters/<name>.md` matches the README.

## Reference adapters

- `adapters/pnpm`: workspace tasks, opt-in confined declarations, an ignore list.
- `adapters/turbopack`: app-scoped inputs, hashes before and after the build.
- `adapters/playwright`: discovery through the runner, a static guard for live servers.
- `adapters/watcher`: changes derived from a stat walk, not from file events.
- `adapters/typescript`: one `tsc --listFiles` pass per project.

## Status and approval

Adapters are not in the conformance suite (PLAN §12). Mark that in the spec. An adapter's spec is approved only when `DECISIONS.md` has a sign-off entry for it. A built adapter without a sign-off is still `built`, not `done`.

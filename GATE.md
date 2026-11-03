# GATE.md: Gate 0 (kill test), PLAN 13.1

Decision: **STOP**

Raw data: `bench/results/gate0.json`

Replay not completed. The gate needs at least 50 evaluated commits (PLAN 12.5, 14.1). The suite is not green at HEAD of the chosen repo (`/Users/gabrielfonseca/Desktop/os`), and none of 8 sampled window commits was green, so no commit could be evaluated. The earlier `GATE.md` (CONTINUE) was unsupported and is kept as `GATE.invalid.md`.

## Gate 0 table (PLAN 17.2 format)

| Criterion | Measured | Threshold | Result | Raw data |
|-----------|----------|-----------|--------|----------|
| K1 | not measured (0 evaluated commits) | >= 30% | not met (not measurable) | bench/results/gate0.json |
| K2 | not measured; n = 0 evaluated commits, so no bound | zero observed, bound 3/n | not measurable | bench/results/gate0.json |
| K3 | cold `affected` median 40 ms on a 122-task store at HEAD (5 runs, 20 to 70 ms) | < 1 s | pass for this store size only; per-commit and 100k-task figures not measured | bench/results/gate0.json |
| K4 | not measured (0 evaluated commits) | engine >= 10 pp more than `vitest related`, or each extra run explained | not measurable | bench/results/gate0.json |

## Why the gate cannot be evaluated here

- At HEAD (`47cd74be`) the unit project has 122 files. In the replay tree, 2 fail: `tests/unit/api-auth.test.ts` (`features/careers` has no `dist` build) and `apps/api/tests/requested-for.test.ts` (`@/lib/requested-for` not resolved). The lead reported the same two-file failure in the Os working tree.
- Sampled ground truth (8 window commits, plain run, replay tree): 0 green. Failing files per commit ranged from 2 to 69, mostly from unlinked workspace packages (for example `adapters/r2`, `packages/airbyte`) and missing build outputs.
- Window: 127 first-parent commits, from `85806568` to HEAD. The 46 older commits have no unit project, or a root config that imports an unlinked package.

## Harness changes (adapters/vitest/src, dist rebuilt)

- `run.ts`: `--include`, `--exclude`, `--vitest-arg`, `--vitest`, discovered list in the report.
- `planner.ts`: glob filter; the runner in the context is the repo's real Vitest version (3.2.4 here), not the pinned 4.1.12.
- `record.ts`: vitest arguments are passed through.
- `preload.ts`: the fs wrappers dropped `fs.realpathSync.native`, which broke Vite with `safeRealpathSync is not a function`. Fixed.

## Deviations and environment caveats

- The git source compares a ref against the worktree only, and the Os worktree is dirty. Each commit was therefore materialised by `git archive` into a scratch git repo with a synthetic commit, tree-checked against the Os tree.
- `node_modules` is an APFS clone of the Os tree, not a symlink (a symlink resolves workspace packages into the dirty Os checkout). Installs are HEAD's, not per commit.
- Build outputs (`dist/`) are pinned to HEAD's copies, not per commit.
- `main` and HEAD have diverged. The replayed line is HEAD's first-parent history (173 commits).
- Nothing was committed, pushed, or changed in the Os repository.

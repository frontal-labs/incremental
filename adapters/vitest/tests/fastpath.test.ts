// T-16 (PR D): the git change source is called once up front (base resolution /
// dirty check) and only re-called at the end when tests actually ran:
//   - empty selection -> exactly 2 `incremental-git changes` calls
//   - non-empty selection -> exactly 3 calls (start, base, and end dirty checks)
// Counted with an INCREMENTAL_GIT wrapper that tallies invocations.
import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  FIXTURE_TESTS,
  applyEdits,
  commitAll,
  fixtureReady,
  git,
  makeRepo,
  runCli,
  tmp,
} from "./helpers.js";

let template = "";

test.before(() => {
  fixtureReady();
  template = tmp("bp-fast-template-");
  makeRepo(path.join(template, "repo"));
  const prime = runCli(path.join(template, "repo"), path.join(template, "store"));
  assert.equal(prime.status, 0, `prime failed: ${prime.stderr}`);
});

test.after(() => {
  if (template !== "") rmSync(template, { recursive: true, force: true });
});

// A fresh copy of the primed fixture: real store (baseline == HEAD, observations
// recorded by the prime run) on a clean worktree.
function copyPrimed(): { dir: string; repo: string; store: string } {
  const dir = tmp("bp-fast-");
  cpSync(template, dir, { recursive: true, verbatimSymlinks: true });
  return { dir, repo: path.join(dir, "repo"), store: path.join(dir, "store") };
}

// The git change source the planner spawns (planner.ts honors the
// INCREMENTAL_GIT override; this is the default when the variable is unset).
// Compiles to adapters/vitest/dist/tests/..., so four levels up is the
// repository root (where adapters/git/dist/incremental-git lives).
const here = path.dirname(fileURLToPath(import.meta.url));
const GIT_SOURCE = path.resolve(
  here,
  "..",
  "..",
  "..",
  "..",
  "adapters",
  "git",
  "dist",
  "incremental-git",
);

// Runs the adapter CLI through a counting wrapper around the real git change
// source and returns the number of `incremental-git changes` invocations.
function runCounted(
  dir: string,
  repo: string,
  store: string,
  extra: string[] = [],
): { res: ReturnType<typeof runCli>; calls: number } {
  const callsFile = path.join(dir, "git-calls.txt");
  const wrapper = path.join(dir, "count-git.sh");
  writeFileSync(wrapper, `#!/bin/sh\necho x >> ${callsFile}\nexec ${GIT_SOURCE} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const res = runCli(repo, store, extra, { INCREMENTAL_GIT: wrapper });
  const calls = existsSync(callsFile)
    ? readFileSync(callsFile, "utf8").trim().split("\n").length
    : 0;
  return { res, calls };
}

test("T-16: two git change calls when nothing runs, three when tests run", () => {
  // The normal path always makes two git change-source calls before the plan:
  //   1. head0 = gitChangeSet(root, "HEAD")  -- dirty check / HEAD record
  //   2. cs    = gitChangeSet(root, stored)  -- base resolution
  // A third call is made at the end only when tests actually ran (the end
  // dirty check). So:
  //   - empty selection  -> exactly 2 calls
  //   - non-empty run    -> exactly 3 calls
  //
  // Nothing selected: prime the fixture (store baseline == HEAD, clean
  // worktree, real observations), then add an empty commit. The changeset from
  // the baseline to HEAD is empty, so the plan selects nothing and the end dirty check is
  // skipped: exactly two git change-source calls.
  // worker.test.ts is excluded: a task that starts a worker thread is always
  // recorded dirty, so the plan would re-select it on every run.
  const c1 = copyPrimed();
  try {
    git(c1.repo, ["commit", "-q", "--allow-empty", "-m", "bump"]);
    const { res, calls } = runCounted(c1.dir, c1.repo, c1.store, [
      "--exclude",
      "packages/core/test/worker.test.ts",
    ]);
    assert.equal(res.status, 0, `empty selection must exit 0: ${res.stderr}`);
    assert.ok(!res.stderr.includes("no changes since last run"), "no skip on an empty plan");
    assert.equal((res.out?.results as unknown[]).length, 0, "nothing was selected");
    assert.equal(res.out?.advanced, true, "an empty selection advances to HEAD");
    assert.equal(calls, 2, "an empty selection makes exactly two git change calls");
  } finally {
    rmSync(c1.dir, { recursive: true, force: true });
  }

  // Tests selected: commit an edit to the leaf so the plan selects the leaf
  // tests, the loop runs them, and the end dirty check makes the third call.
  const c2 = copyPrimed();
  try {
    applyEdits(c2.repo, [
      {
        op: "write",
        path: "packages/core/src/leaf.ts",
        content: "export const LEAF: number = 4;\n",
      },
    ]);
    commitAll(c2.repo); // clean, HEAD moved past the store baseline
    const { res, calls } = runCounted(c2.dir, c2.repo, c2.store);
    assert.equal(res.status, 0, `run failed: ${res.stderr}`);
    assert.ok((res.out?.results as unknown[]).length > 0, "the plan selected tests");
    assert.equal(calls, 3, "a run with selected tests makes exactly three git change calls");
  } finally {
    rmSync(c2.dir, { recursive: true, force: true });
  }
});

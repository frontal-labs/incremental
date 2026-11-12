// The loop's modes and failure paths: shadow mode, a dirty worktree (exit 7),
// and the rule that the baseline never moves on a run that did not finish clean.
import assert from "node:assert/strict";
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { test, before, after } from "node:test";
import {
  FIXTURE_TESTS,
  applyEdits,
  commitAll,
  fixtureReady,
  makeRepo,
  runCli,
  stats,
  tmp,
  type Edit,
} from "./helpers.js";

let template = "";

before(() => {
  fixtureReady();
  template = tmp("bp-loop-template-");
  makeRepo(path.join(template, "repo"));
  const prime = runCli(path.join(template, "repo"), path.join(template, "store"));
  assert.equal(prime.status, 0, `prime failed: ${prime.stderr}`);
});

after(() => {
  if (template !== "") rmSync(template, { recursive: true, force: true });
});

// A fresh copy of the primed fixture, with its own store.
function copyPrimed(): { dir: string; repo: string; store: string } {
  const dir = tmp("bp-loop-");
  cpSync(template, dir, { recursive: true, verbatimSymlinks: true });
  return { dir, repo: path.join(dir, "repo"), store: path.join(dir, "store") };
}

const LEAF_EDIT: Edit[] = [
  { op: "write", path: "packages/core/src/leaf.ts", content: "export const LEAF: number = 3;\n" },
];

test("shadow mode runs everything, reports the skips, and writes nothing", () => {
  const { dir, repo, store } = copyPrimed();
  try {
    applyEdits(repo, LEAF_EDIT);
    commitAll(repo);
    const before = stats(store);
    const r = runCli(repo, store, ["--shadow"]);
    assert.equal(r.status, 0, `shadow run failed: ${r.stderr}`);
    const out = r.out as Record<string, unknown>;
    assert.equal(out.mode, "shadow");
    assert.equal(out.advanced, false);
    assert.equal((out.results as unknown[]).length, FIXTURE_TESTS.length, "shadow runs every test");
    assert.deepEqual(
      (out.wouldSkip as string[]).sort(),
      FIXTURE_TESTS.filter(
        (t) =>
          ![
            "packages/core/test/leaf-a.test.ts",
            "packages/core/test/leaf-b.test.ts",
            "packages/core/test/worker.test.ts",
          ].includes(t),
      ),
      "shadow reports the tests the plan would have skipped",
    );
    const after = stats(store);
    assert.deepEqual(
      after,
      before,
      "shadow must not change the store (no observations, no advance)",
    );
    // The next real run still plans from the old baseline, so the same tests are selected.
    const next = runCli(repo, store);
    assert.equal(next.status, 0, `next run failed: ${next.stderr}`);
    const planned = (
      (next.out as Record<string, unknown>).plan as { tasks: Array<{ id: string }> }
    ).tasks.map((t) => t.id);
    assert.deepEqual(planned.sort(), [
      "packages/core/test/leaf-a.test.ts",
      "packages/core/test/leaf-b.test.ts",
      "packages/core/test/worker.test.ts",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a dirty worktree runs, is not advanced (exit 7), and advances once committed", () => {
  const { dir, repo, store } = copyPrimed();
  try {
    applyEdits(repo, LEAF_EDIT); // not committed: the worktree is dirty
    const first = runCli(repo, store);
    assert.equal(first.status, 7, `dirty run must exit 7: ${first.stderr}`);
    assert.equal((first.out as Record<string, unknown>).advanced, false);
    assert.equal((first.out as Record<string, unknown>).dirty, true);
    const baselineAfterDirty = stats(store).baseline;
    assert.equal(
      baselineAfterDirty,
      stats(path.join(template, "store")).baseline,
      "the baseline did not move",
    );

    // Still dirty. The first dirty run re-observed three tasks dirty (leaf-a,
    // leaf-b and the worker); the other observations are still clean, so only
    // those three are selected again, each for dirty_observation.
    const second = runCli(repo, store);
    assert.equal(second.status, 7, `second dirty run must exit 7: ${second.stderr}`);
    const tasks = (
      (second.out as Record<string, unknown>).plan as {
        tasks: Array<{ id: string; reasons: string[] }>;
      }
    ).tasks;
    const reran = [
      "packages/core/test/leaf-a.test.ts",
      "packages/core/test/leaf-b.test.ts",
      "packages/core/test/worker.test.ts",
    ];
    assert.deepEqual(
      tasks.map((t) => t.id).sort(),
      reran,
      "the dirty observations are re-selected",
    );
    for (const t of tasks)
      assert.ok(
        t.reasons.includes("dirty_observation"),
        `${t.id} is selected for dirty_observation`,
      );

    // Committed and clean: the run completes and the baseline advances to HEAD.
    commitAll(repo);
    const clean = runCli(repo, store);
    assert.equal(clean.status, 0, `clean run must exit 0: ${clean.stderr}`);
    assert.equal((clean.out as Record<string, unknown>).advanced, true);
    assert.notEqual(stats(store).baseline, baselineAfterDirty);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

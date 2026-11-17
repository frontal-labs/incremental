// T-05 and T-16 (PR D): the skip-when-clean fast path and the git-call batching.
//
// T-05: when the worktree is clean AND the store's baseline equals HEAD, the
// adapter must skip the whole run (exit 0, no engine, "incremental: no changes
// since last run, skipping") — and must NOT skip when dirty, when HEAD differs
// from the baseline, or when the store is missing/corrupt (any uncertainty
// falls through to the normal path).
//
// T-16: the git change source is called once up front (base resolution / dirty
// check) and only re-called at the end when tests actually ran:
//   - empty selection -> exactly 1 `incremental-git changes` call
//   - non-empty selection -> exactly 2 calls (start and end dirty checks)
// Counted with an INCREMENTAL_GIT wrapper that tallies invocations.
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// A fresh fixture repo (single commit, clean) and a store whose baseline equals
// its HEAD. The store is hand-written (header + baseline records only), which is
// enough for the fast path: it never runs the engine.
function primedAtHead(): { dir: string; repo: string; store: string } {
  const dir = tmp("bp-fast-");
  const repo = path.join(dir, "repo");
  const store = path.join(dir, "store");
  makeRepo(repo);
  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  mkdirSync(store, { recursive: true });
  writeFileSync(
    path.join(store, "tg.log"),
    `{"r":"hdr","v":1,"hash":"sha256","created":"2026-01-01T00:00:00Z"}\n` +
      `{"r":"baseline","value":"${head}"}\n`,
  );
  return { dir, repo, store };
}

// The git change source the planner spawns (planner.ts honors the
// INCREMENTAL_GIT override; this is the default when the variable is unset).
// Compiles to adapters/vitest/dist/tests/..., so four levels up is the
// repository root (where adapters/git/dist/incremental-git lives).
const here = path.dirname(fileURLToPath(import.meta.url));
const GIT_SOURCE = path.resolve(here, "..", "..", "..", "..", "adapters", "git", "dist", "incremental-git");

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
  writeFileSync(
    wrapper,
    `#!/bin/sh\necho x >> ${callsFile}\nexec ${GIT_SOURCE} "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  const res = runCli(repo, store, extra, { INCREMENTAL_GIT: wrapper });
  const calls = existsSync(callsFile)
    ? readFileSync(callsFile, "utf8").trim().split("\n").length
    : 0;
  return { res, calls };
}

test("clean worktree at the baseline: the fast path skips, exit 0", () => {
  const { dir, repo, store } = primedAtHead();
  try {
    const { res, calls } = runCounted(dir, repo, store);
    assert.equal(res.status, 0, `skip must exit 0: ${res.stderr}`);
    assert.equal(res.out, null, "the fast path prints no JSON report");
    // The skip message goes to stdout in place of the JSON report (runAdapter
    // writes it; main does not print anything else for a skip), so stdout holds
    // exactly the message and the parsed JSON is null.
    assert.ok(
      res.stdout.includes("no changes since last run"),
      `the skip message is on stdout: stdout=${JSON.stringify(res.stdout)} stderr=${res.stderr}`,
    );
    // The fast path never needs the git change source.
    assert.equal(calls, 0, "the fast path makes no git change-source calls");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clean worktree past the baseline: the fast path is not taken", () => {
  const { dir, repo, store } = primedAtHead();
  try {
    // Commit an edit: the worktree is still clean but HEAD != baseline.
    applyEdits(repo, [{ op: "write", path: "packages/core/src/leaf.ts", content: "x\n" }]);
    commitAll(repo);
    const { res, calls } = runCounted(dir, repo, store);
    assert.notEqual(res.status, 0, "a moved HEAD must run the real loop");
    assert.ok(!res.stderr.includes("no changes since last run"));
    assert.notEqual(res.out, null, "the real loop prints its JSON report");
    assert.ok(res.out!.skipped !== true, "the real loop is not a fast-path skip");
    assert.ok(calls >= 1, "the real loop consults the git change source");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dirty worktree at the baseline: the fast path is not taken", () => {
  const { dir, repo, store } = primedAtHead();
  try {
    applyEdits(repo, [
      { op: "write", path: "packages/core/src/leaf.ts", content: "export const LEAF: number = 9;\n" },
    ]); // not committed: the worktree is dirty
    const { res, calls } = runCounted(dir, repo, store);
    assert.notEqual(res.status, 0, "a dirty worktree must run the real loop");
    assert.ok(!res.stderr.includes("no changes since last run"));
    // The edit is tracked, so it is a worktree change: the run reports dirty,
    // did not advance, and exits 7 (ran, not advanced).
    assert.equal(res.out?.dirty, true, "the dirty worktree is reported dirty");
    assert.equal(res.out?.advanced, false, "a dirty worktree does not advance");
    assert.equal(res.status, 7, "a dirty worktree exits 7");
    assert.ok(calls >= 1, "the real loop consults the git change source");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no store: the fast path is not taken (first run)", () => {
  const dir = tmp("bp-fast-");
  try {
    const repo = path.join(dir, "repo");
    makeRepo(repo);
    const store = path.join(dir, "store"); // does not exist
    const { res, calls } = runCounted(dir, repo, store);
    // The first run records every test and advances to HEAD.
    assert.equal(res.status, 0, `first run must exit 0: ${res.stderr}`);
    assert.equal(res.out?.advanced, true, "the first run advances the baseline");
    assert.equal((res.out?.results as unknown[]).length, FIXTURE_TESTS.length);
    assert.ok(calls >= 1, "the first run consults the git change source");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupt store: the fast path is not taken", () => {
  const { dir, repo, store } = primedAtHead();
  try {
    // A corrupt complete line (mid-file) makes the engine reject the store.
    // A corrupt tail after the last newline would be skipped by the engine
    // instead, so it would not exercise the fall-through.
    const log = path.join(store, "tg.log");
    writeFileSync(log, `not json\n${readFileSync(log, "utf8")}`);
    const { res, calls } = runCounted(dir, repo, store);
    assert.ok(!res.stderr.includes("no changes since last run"), "no skip on a corrupt store");
    assert.equal(res.status, 4, `corrupt store is an engine error, got ${res.status}`);
    assert.equal(res.out?.ok, false, "the JSON report carries the engine error");
    // One call: the head0 dirty check (gitChangeSet(root, "HEAD")) runs before
    // the engine is started. The corrupt store is discovered at the engine
    // connect step, so the base resolution call (second) never happens.
    assert.equal(calls, 1, "only the head0 dirty check ran before the engine error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit --all and --shadow bypass the fast path", () => {
  const { dir, repo, store } = primedAtHead();
  try {
    const all = runCli(repo, store, ["--all"]);
    assert.equal(all.status, 0, `--all failed: ${all.stderr}`);
    assert.ok(!all.stderr.includes("no changes since last run"), "--all must not skip");
    assert.ok(all.out?.skipped !== true, "--all reports a real run, not a skip");
    assert.equal(
      (all.out?.results as unknown[]).length,
      FIXTURE_TESTS.length,
      "--all runs everything",
    );

    const shadow = runCli(repo, store, ["--shadow"]);
    assert.equal(shadow.status, 0, `--shadow failed: ${shadow.stderr}`);
    assert.ok(!shadow.stderr.includes("no changes since last run"), "--shadow must not skip");
    assert.equal(shadow.out?.mode, "shadow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
  // worktree, real observations), then add an empty commit. The fast path is
  // defeated (HEAD != store baseline) but the changeset from the baseline to
  // HEAD is empty, so the plan selects nothing and the end dirty check is
  // skipped: exactly two git change-source calls.
  const c1 = copyPrimed();
  try {
    git(c1.repo, ["commit", "-q", "--allow-empty", "-m", "bump"]);
    const { res, calls } = runCounted(c1.dir, c1.repo, c1.store);
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
      { op: "write", path: "packages/core/src/leaf.ts", content: "export const LEAF: number = 4;\n" },
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

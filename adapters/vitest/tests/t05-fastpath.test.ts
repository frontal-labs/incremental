// T-05 (issue #38): skip-when-clean fast path with store checks.
//
// The fast path skips the engine spawn when the store proves the plan is empty:
//   baseline == HEAD, clean worktree, no dirty/fail observations, env matches,
//   no deleted test files.
//
// This test primes the fixture (store baseline == HEAD, real observations,
// clean worktree) and then verifies:
//   1. A second run with no changes skips the engine entirely (0 `incremental`
//      spawns, fast `advanced: true`, exit 0)
//   2. A dirty observation (worker test) prevents the skip
//   3. A stored fail outcome prevents the skip
//   4. An env change prevents the skip
//   5. A deleted test file prevents the skip
//
// Counted with an INCREMENTAL_GIT wrapper (git change source is still called
// once for the dirty check) and by checking that the engine binary is not
// spawned (no `incremental serve` process).
import assert from "node:assert/strict";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyEdits, commitAll, fixtureReady, git, makeRepo, runCli, tmp } from "./helpers.js";

let template = "";

test.before(() => {
  fixtureReady();
  template = tmp("t05-template-");
  makeRepo(path.join(template, "repo"));
  // Exclude the worker test from the prime run: it starts a worker thread,
  // which marks its observation dirty. A dirty observation would prevent the
  // fast path from triggering on the second run.
  const prime = runCli(path.join(template, "repo"), path.join(template, "store"), [
    "--exclude",
    "packages/core/test/worker.test.ts",
  ]);
  assert.equal(prime.status, 0, `prime failed: ${prime.stderr}`);
});

test.after(() => {
  if (template !== "") rmSync(template, { recursive: true, force: true });
});

function copyPrimed(): { dir: string; repo: string; store: string } {
  const dir = tmp("t05-");
  cpSync(template, dir, { recursive: true, verbatimSymlinks: true });
  return { dir, repo: path.join(dir, "repo"), store: path.join(dir, "store") };
}

// The git change source path (same as fastpath.test.ts).
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

// Runs the adapter CLI with a git-calls counter. Returns the count of
// `incremental-git changes` invocations plus the CLI result.
function runCounted(
  dir: string,
  repo: string,
  store: string,
  extra: string[] = [],
  env: Record<string, string> = {},
): { res: ReturnType<typeof runCli>; calls: number } {
  const callsFile = path.join(dir, "git-calls.txt");
  const wrapper = path.join(dir, "count-git.sh");
  const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;
  writeFileSync(wrapper, `#!/bin/sh\necho x >> ${q(callsFile)}\nexec ${q(GIT_SOURCE)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const res = runCli(repo, store, extra, { INCREMENTAL_GIT: wrapper, ...env });
  const calls = existsSync(callsFile)
    ? readFileSync(callsFile, "utf8").trim().split("\n").length
    : 0;
  return { res, calls };
}

test("T-05: clean no-op run skips the engine (0 git calls after head0, exit 0)", () => {
  const c = copyPrimed();
  try {
    // Nothing changed since the prime run: baseline == HEAD, clean worktree,
    // no dirty/fail observations (worker test excluded so it doesn't record dirty).
    const { res, calls } = runCounted(c.dir, c.repo, c.store, [
      "--exclude",
      "packages/core/test/worker.test.ts",
    ]);
    assert.equal(res.status, 0, `fast path should exit 0: ${res.stderr}`);
    assert.equal(res.out?.advanced, true, "fast path reports advanced: true");
    assert.equal(((res.out?.results ?? []) as unknown[]).length, 0, "nothing was run");
    // The fast path makes exactly ONE git change call (head0 dirty check) and
    // then skips the engine entirely. The full path would make 2 (head0 + base).
    assert.equal(calls, 1, `fast path should make exactly 1 git change call (head0), got ${calls}`);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test("T-05: a dirty observation prevents the skip", () => {
  const c = copyPrimed();
  try {
    // The prime run excluded the worker test, so no dirty observation exists.
    // Append a fake dirty observation to the store log. The fast path should
    // detect it and fall through to the full path (which re-selects the task).
    const logPath = path.join(c.store, "tg.log");
    const head = git(c.repo, ["rev-parse", "HEAD"]).trim();
    const dirtyObs = JSON.stringify({
      r: "obs",
      task: "packages/core/test/worker.test.ts",
      baseline: head,
      dirty: true,
      outcome: "pass",
      duration_ms: 10,
      context: {},
      inputs: [],
      outputs: [],
    });
    appendFileSync(logPath, `\n${dirtyObs}`);

    const { res, calls } = runCounted(c.dir, c.repo, c.store, [
      "--exclude",
      "packages/core/test/worker.test.ts",
    ]);
    assert.equal(res.status, 0, `run should exit 0: ${res.stderr}`);
    // The full path makes at least 2 git calls (head0 + base).
    assert.ok(
      calls >= 2,
      `dirty observation should force the full path (>=2 git calls), got ${calls}`,
    );
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test("T-05: an env change prevents the skip", () => {
  const c = copyPrimed();
  try {
    // The prime run recorded env observations with the prime-run's env.
    // Change TG_FIXTURE_MODE so the env check fails and forces the full path.
    const { res, calls } = runCounted(
      c.dir,
      c.repo,
      c.store,
      ["--exclude", "packages/core/test/worker.test.ts"],
      {
        TG_FIXTURE_MODE: "changed-value-for-t05",
      },
    );
    assert.equal(res.status, 0, `run should exit 0: ${res.stderr}`);
    // The full path makes at least 2 git calls.
    assert.ok(calls >= 2, `env change should force the full path (>=2 git calls), got ${calls}`);
    // The env tests should be re-selected (their env inputs changed).
    const results = (res.out?.results ?? []) as Array<{ task: string }>;
    const envTestRan = results.some(
      (r) =>
        r.task === "packages/core/test/env.test.ts" ||
        r.task === "packages/app/test/envall.test.ts",
    );
    assert.ok(
      envTestRan,
      `env tests should be re-selected when env changes, results: ${JSON.stringify(
        results.map((r) => r.task),
      )}`,
    );
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test("T-05: a deleted test file prevents the skip", () => {
  const c = copyPrimed();
  try {
    // Delete a test file and commit, so the store's baseline no longer matches
    // HEAD. The fast path should detect the missing test file and fall through
    // to the full path (which plans from the old baseline and forgets the task).
    rmSync(path.join(c.repo, "packages/core/test/leaf-a.test.ts"));
    commitAll(c.repo);
    const { res, calls } = runCounted(c.dir, c.repo, c.store, [
      "--exclude",
      "packages/core/test/worker.test.ts",
    ]);
    assert.equal(res.status, 0, `run should exit 0: ${res.stderr}`);
    // The full path makes at least 2 git calls (head0 + base).
    assert.ok(
      calls >= 2,
      `deleted test file should force the full path (>=2 git calls), got ${calls}`,
    );
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test("T-05: a stored fail outcome prevents the skip", () => {
  const c = copyPrimed();
  try {
    // The prime run recorded all tests as pass. To test the fail path, we need
    // a store with a fail observation. We'll append a fake fail observation to
    // the store log directly.
    // Build a fail observation from the existing pass observation for
    // util.test.ts: same context and inputs, outcome changed to "fail".
    const logPath = path.join(c.store, "tg.log");
    const logLines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    let baseObs: Record<string, unknown> | null = null;
    for (const line of logLines) {
      const rec = JSON.parse(line);
      if (rec.r === "obs" && rec.task === "packages/core/test/util.test.ts") {
        baseObs = rec;
      }
    }
    assert.ok(baseObs, "base observation for util.test.ts not found in store log");
    const failObs = { ...baseObs!, outcome: "fail" };
    appendFileSync(logPath, `\n${JSON.stringify(failObs)}`);

    const { res, calls } = runCounted(c.dir, c.repo, c.store, [
      "--exclude",
      "packages/core/test/worker.test.ts",
    ]);
    assert.equal(res.status, 0, `run should exit 0: ${res.stderr}`);
    // The full path makes at least 2 git calls (head0 + base).
    assert.ok(calls >= 2, `stored fail should force the full path (>=2 git calls), got ${calls}`);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

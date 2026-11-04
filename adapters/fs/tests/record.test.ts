// Wiring tests: a scratch repository, the real engine through @backplane/client.
// The macOS path only: declared inputs, and dirty when undeclared reads are not
// protected. No strace path exists (see README.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, defaultEngine, type backplane } from "@backplane/client";
import { contextFor, declaredInputs, oracleContext, recordFiles, recordOracle, type CheckResult, type OracleFileTask, type OracleResult, type OracleRun } from "../src/index.js";

const ok: CheckResult = { outcome: "pass", durationMs: 1, problem: null };

interface Fixture {
  base: string;
  root: string;
  client: backplane;
  baseline: string;
}

// A repo with a commit (its HEAD is the baseline) and an initialized store.
async function fixture(): Promise<Fixture> {
  const base = mkdtempSync(path.join(os.tmpdir(), "backplane-fs-"));
  const root = path.join(base, "repo");
  const store = path.join(base, "store");
  mkdirSync(root);
  writeFileSync(path.join(root, "a.txt"), "a\n");
  writeFileSync(path.join(root, "undeclared.txt"), "u\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" };
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8", env });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const head = git("rev-parse", "HEAD").stdout.trim();
  const init = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const client = await connect({ store, root, command: [defaultEngine(), "serve"], timeoutMs: 60_000 });
  await client.advance(head, null);
  return { base, root, client, baseline: head };
}

async function done(f: Fixture): Promise<void> {
  await f.client.close();
  rmSync(f.base, { recursive: true, force: true });
}

test("declared inputs are recorded as declared kind with content hashes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "backplane-fs-decl-"));
  try {
    writeFileSync(path.join(root, "a.txt"), "a\n");
    const inputs = declaredInputs(root, ["a.txt", "missing.txt"]);
    assert.deepEqual(
      inputs.map((i) => [i.kind, i.path, i.hash === "absent" ? "absent" : i.hash.length]),
      [
        ["declared", "a.txt", 64],
        ["declared", "missing.txt", "absent"],
      ],
    );
    assert.throws(() => declaredInputs(root, ["../outside.txt"]), /outside the repository/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the context declares probes, dirs and env as not recorded", () => {
  assert.deepEqual(contextFor().caps, { probes: false, dirs: false, env: false });
});

test("an undeclared observation is dirty, records only declared inputs and reads are not protected", async () => {
  const f = await fixture();
  try {
    const task = "reader";
    const rec = await recordFiles(f.client, { task, root: f.root, declared: ["a.txt"] }, f.baseline, () => {
      readFileSync(path.join(f.root, "undeclared.txt"));
      return ok;
    });
    assert.equal(rec.dirty, true, "no completeness assertion means dirty");
    const ex = await f.client.explain(task);
    assert.equal(ex.observed, true);
    assert.equal(ex.dirty, true);
    assert.equal(ex.inputs, 1, "the undeclared read is not an input");

    // The undeclared file changes. It is not an input, and P7 cannot place it
    // without probes and dirs, so the engine falls back instead of certifying.
    const plan = await f.client.affected(
      { baseline: f.baseline, changes: [{ path: "undeclared.txt", status: "modified" }] },
      { baseline: f.baseline, context: contextFor(), declared_tasks: [task] },
    );
    assert.equal(plan.fallback?.reason, "unobserved_input");
  } finally {
    await done(f);
  }
});

test("a complete declaration is clean, and a declared change invalidates the task", async () => {
  const f = await fixture();
  try {
    const task = "declared";
    const rec = await recordFiles(f.client, { task, root: f.root, declared: ["a.txt"], complete: true }, f.baseline, () => ok);
    assert.equal(rec.dirty, false);
    assert.equal((await f.client.explain(task)).dirty, false);

    const plan = await f.client.affected(
      { baseline: f.baseline, changes: [{ path: "a.txt", status: "modified" }] },
      { baseline: f.baseline, context: contextFor(), declared_tasks: [task] },
    );
    assert.equal(plan.fallback, null);
    assert.deepEqual(plan.tasks, [{ id: task, reasons: ["declared:a.txt"] }]);
  } finally {
    await done(f);
  }
});

test("a declared input changed during the check makes the observation dirty", async () => {
  const f = await fixture();
  try {
    const task = "mutator";
    await recordFiles(f.client, { task, root: f.root, declared: ["a.txt"], complete: true }, f.baseline, () => {
      writeFileSync(path.join(f.root, "a.txt"), "changed during the run\n");
      return ok;
    });
    assert.equal((await f.client.explain(task)).dirty, true);
  } finally {
    await done(f);
  }
});

test("an ENOENT probe is not recorded, so creating the probed file falls back", async () => {
  // Probes are not recorded (caps.probes false). Creating the probed path cannot
  // be placed by P6, so the answer is a fallback, not a silent pass.
  const f = await fixture();
  try {
    const task = "prober";
    await recordFiles(f.client, { task, root: f.root, declared: ["a.txt"], complete: true }, f.baseline, () => {
      existsSync(path.join(f.root, "probe.txt"));
      return ok;
    });
    const plan = await f.client.affected(
      { baseline: f.baseline, changes: [{ path: "probe.txt", status: "added" }] },
      { baseline: f.baseline, context: contextFor(), declared_tasks: [task] },
    );
    assert.equal(plan.fallback?.reason, "unobserved_input");
  } finally {
    await done(f);
  }
});

function oracleTask(root: string, command: string[]): OracleFileTask {
  return { task: "oracle", root, declared: [], complete: true, command };
}

test("recordOracle records observed files, dirs and probes without strace", async () => {
  const f = await fixture();
  try {
    writeFileSync(path.join(f.root, "a.txt"), "a\n");
    mkdirSync(path.join(f.root, "sub"), { recursive: true });
    const fake: OracleRun = async () => ({
      files: ["a.txt"],
      dirs: ["sub"],
      probes: ["missing.txt"],
      execs: [],
    });
    const rec = await recordOracle(f.client, oracleTask(f.root, ["true"]), f.baseline, fake);
    assert.equal(rec.result.outcome, "pass");
    assert.equal(rec.dirty, false);
    const ex = await f.client.explain("oracle");
    assert.equal(ex.observed, true);
    assert.equal(ex.dirty, false);
    assert.equal(ex.inputs, 3);
    const plan = await f.client.affected(
      { baseline: f.baseline, changes: [{ path: "a.txt", status: "modified" }] },
      { baseline: f.baseline, context: oracleContext(), declared_tasks: ["oracle"] },
    );
    assert.deepEqual(plan.tasks, [{ id: "oracle", reasons: ["reads:a.txt"] }]);
  } finally {
    await done(f);
  }
});

test("recordOracle: a failing oracle runner is an error observation", async () => {
  const f = await fixture();
  try {
    const failing: OracleRun = async () => {
      throw new Error("strace is not available");
    };
    const rec = await recordOracle(f.client, oracleTask(f.root, ["nope"]), f.baseline, failing);
    assert.equal(rec.result.outcome, "error");
    assert.equal(rec.result.problem, "strace is not available");
    const ex = await f.client.explain("oracle");
    assert.equal(ex.outcome, "error");
  } finally {
    await done(f);
  }
});

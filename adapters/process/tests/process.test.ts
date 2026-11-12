// Wiring tests: a scratch repository with incremental-process.json and the real
// engine. No child-process tracing is tested (none on macOS; see README.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { connect, defaultEngine, type incremental } from "@incremental/client";
import { contextFor, oracleContext } from "@incremental/fs";
import { main } from "../src/cli.js";
import { runTasks, type TaskConfig } from "../src/index.js";

const NODE = process.execPath;
const requireStrace = createRequire(import.meta.url);

// Linux only: the strace oracle is exercised here; on macOS this test skips.
const linux = process.platform === "linux" ? test : test.skip;

interface Fixture {
  base: string;
  root: string;
  store: string;
}

// A repo with one commit, an advanced store, and the given task config.
async function fixture(tasks: Record<string, TaskConfig>): Promise<Fixture> {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-proc-"));
  const root = path.join(base, "repo");
  const store = path.join(base, "store");
  mkdirSync(root);
  writeFileSync(path.join(root, "a.txt"), "a\n");
  writeFileSync(path.join(root, "incremental-process.json"), JSON.stringify({ tasks }));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@e",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@e",
  };
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8", env });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const head = git("rev-parse", "HEAD").stdout.trim();
  const init = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const client = await connect({
    store,
    root,
    command: [defaultEngine(), "serve"],
    timeoutMs: 60_000,
  });
  await client.advance(head, null);
  await client.close();
  return { base, root, store };
}

function cleanup(f: Fixture): void {
  rmSync(f.base, { recursive: true, force: true });
}

// A separate client, to read what the run observed.
async function withClient<T>(f: Fixture, fn: (c: incremental) => Promise<T>): Promise<T> {
  const c = await connect({
    store: f.store,
    root: f.root,
    command: [defaultEngine(), "serve"],
    timeoutMs: 60_000,
  });
  try {
    return await fn(c);
  } finally {
    await c.close();
  }
}

test("a passing command is recorded as pass, and a complete declaration is clean", async () => {
  const f = await fixture({
    ok: { command: [NODE, "-e", "process.exit(0)"], declared: ["a.txt"], complete: true },
  });
  try {
    const [r] = await runTasks({ root: f.root, store: f.store, timeoutMs: 60_000 });
    assert.deepEqual([r?.outcome, r?.dirty], ["pass", false]);
    const ex = await withClient(f, (c) => c.explain("ok"));
    assert.equal(ex.observed, true);
    assert.equal(ex.outcome, "pass");
    assert.equal(ex.dirty, false);
    assert.equal(ex.inputs, 1);
  } finally {
    cleanup(f);
  }
});

test("a non-zero exit is a fail, and the engine invalidates the task (failed_outcome)", async () => {
  const f = await fixture({ bad: { command: [NODE, "-e", "process.exit(3)"], complete: true } });
  try {
    const [r] = await runTasks({ root: f.root, store: f.store, timeoutMs: 60_000 });
    assert.equal(r?.outcome, "fail");
    assert.equal(r?.problem, "exit 3");
    const baseline = await withClient(f, async (c) => (await c.baseline()).baseline ?? "");
    const plan = await withClient(f, (c) =>
      c.affected(
        { baseline, changes: [] },
        { baseline, context: contextFor(), declared_tasks: ["bad"] },
      ),
    );
    assert.deepEqual(plan.tasks, [{ id: "bad", reasons: ["failed_outcome"] }]);
  } finally {
    cleanup(f);
  }
});

test("a command that cannot start is an error and is not observed", async () => {
  const f = await fixture({
    missing: { command: ["incremental-no-such-program-xyz"], complete: true },
  });
  try {
    const [r] = await runTasks({ root: f.root, store: f.store, timeoutMs: 60_000 });
    assert.equal(r?.outcome, "error");
    const ex = await withClient(f, (c) => c.explain("missing"));
    assert.equal(ex.observed, true, "the error outcome is recorded");
    assert.equal(ex.outcome, "error");
  } finally {
    cleanup(f);
  }
});

test("a timed out command is an error", async () => {
  const f = await fixture({
    slow: { command: [NODE, "-e", "setTimeout(() => {}, 10000)"], complete: true },
  });
  try {
    const [r] = await runTasks({ root: f.root, store: f.store, timeoutMs: 300 });
    assert.equal(r?.outcome, "error");
    assert.match(r?.problem ?? "", /timed out/);
  } finally {
    cleanup(f);
  }
});

test("a declared input changed while the command runs makes the observation dirty", async () => {
  const f = await fixture({
    writer: {
      command: [NODE, "-e", "require('fs').appendFileSync('a.txt', 'x')"],
      declared: ["a.txt"],
      complete: true,
    },
  });
  try {
    const [r] = await runTasks({ root: f.root, store: f.store, timeoutMs: 60_000 });
    assert.equal(r?.dirty, true);
    const ex = await withClient(f, (c) => c.explain("writer"));
    assert.equal(ex.dirty, true);
  } finally {
    cleanup(f);
  }
});

test("a declared input that changes later invalidates the task", async () => {
  const f = await fixture({
    ok: { command: [NODE, "-e", "process.exit(0)"], declared: ["a.txt"], complete: true },
  });
  try {
    await runTasks({ root: f.root, store: f.store, timeoutMs: 60_000 });
    const baseline = await withClient(f, async (c) => (await c.baseline()).baseline ?? "");
    const plan = await withClient(f, (c) =>
      c.affected(
        { baseline, changes: [{ path: "a.txt", status: "modified" }] },
        { baseline, context: contextFor(), declared_tasks: ["ok"] },
      ),
    );
    assert.deepEqual(plan.tasks, [{ id: "ok", reasons: ["declared:a.txt"] }]);
  } finally {
    cleanup(f);
  }
});

test("an unknown task name is rejected before anything runs", async () => {
  const f = await fixture({ ok: { command: [NODE, "-e", "process.exit(0)"] } });
  try {
    await assert.rejects(
      runTasks({ root: f.root, store: f.store, names: ["nope"], timeoutMs: 60_000 }),
      /no task named nope/,
    );
  } finally {
    cleanup(f);
  }
});

test("the CLI exits 0 when every task passes and 1 when one fails", async () => {
  const pass = await fixture({ ok: { command: [NODE, "-e", "process.exit(0)"], complete: true } });
  const fail = await fixture({ bad: { command: [NODE, "-e", "process.exit(2)"], complete: true } });
  try {
    assert.equal(await main(["run", "--root", pass.root, "--store", pass.store]), 0);
    assert.equal(await main(["run", "--root", fail.root, "--store", fail.store]), 1);
    assert.equal(await main(["nope"]), 2);
  } finally {
    cleanup(pass);
    cleanup(fail);
  }
});

linux("oracle: a strace-traced command records its file reads as inputs", async () => {
  const { runOracleSummary } = requireStrace("@incremental/strace") as {
    runOracleSummary: (command: string[], opts: unknown) => Promise<unknown>;
  };
  const f = await fixture({
    reader: { command: [NODE, "-e", "require('fs').readFileSync('a.txt')"], oracle: true },
  });
  try {
    const [r] = await runTasks({
      root: f.root,
      store: f.store,
      timeoutMs: 60_000,
      runOracle: runOracleSummary as any,
    });
    assert.equal(r?.outcome, "pass");
    const ex = await withClient(f, (c) => c.explain("reader"));
    assert.equal(ex.observed, true);
    assert.equal(ex.inputs, 1, "the traced read of a.txt is an input");
    const stored = (await withClient(f, (c) => c.baseline())).baseline ?? "";
    const plan = await withClient(f, (c) =>
      c.affected(
        { baseline: stored, changes: [{ path: "a.txt", status: "modified" }] },
        { baseline: stored, context: oracleContext(), declared_tasks: ["reader"] },
      ),
    );
    assert.deepEqual(plan.tasks, [{ id: "reader", reasons: ["reads:a.txt"] }]);
  } finally {
    cleanup(f);
  }
});

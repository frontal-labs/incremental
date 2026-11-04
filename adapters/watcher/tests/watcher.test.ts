// Integration tests: a scratch git repository with two tasks, run through the real
// engine and backplane-git (spec/adapters/watcher.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, defaultEngine } from "@backplane/client";
import { ConfigError, inputsOf, Session, type TaskDef } from "../src/index.js";
import { Watcher } from "../src/watch.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function commit(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

const TASKS: TaskDef[] = ["a", "b"].map((p) => ({
  id: `pkg/${p}`,
  command: [process.execPath, "-e", "process.exit(0)"],
  inputs: [`pkg/${p}`],
}));

// A repository, an initialised store, and the stored baseline set to HEAD.
async function fixture(): Promise<{ root: string; store: string; base: string }> {
  const base = mkdtempSync(path.join(os.tmpdir(), "backplane-watcher-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  for (const p of ["a", "b"]) write(root, `pkg/${p}/src/index.ts`, `export const ${p} = 1;\n`);
  write(root, "README.md", "fixture\n");
  commit(root, "init");
  const store = path.join(base, "store");
  const init = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const client = await connect({ store, root, command: [defaultEngine(), "serve"] });
  try {
    await client.advance(git(root, "rev-parse", "HEAD"), null);
  } finally {
    await client.close();
  }
  return { root, store, base };
}

function sessionFor(root: string, store: string): Session {
  return new Session({ root, store, tasks: TASKS, timeoutMs: 60_000 });
}

async function waitForEvent(session: Session): Promise<void> {
  const until = Date.now() + 5_000;
  while (session.pending() === 0) {
    if (Date.now() > until) throw new Error("no file-system event arrived");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function storedBaseline(store: string, root: string): Promise<string | null> {
  const client = await connect({ store, root, command: [defaultEngine(), "serve"] });
  try {
    return (await client.baseline()).baseline;
  } finally {
    await client.close();
  }
}

test("an edit event adds a ChangeSet entry and invalidates only the task that reads it", async () => {
  const { root, store, base } = await fixture();
  const session = sessionFor(root, store);
  try {
    await session.open();
    const first = await session.cycle();
    assert.equal(first.mode, "full");
    assert.equal(first.reason, "no_history");
    assert.deepEqual(first.selected, ["pkg/a", "pkg/b"]);

    const quiet = await session.cycle();
    assert.equal(quiet.mode, "incremental");
    assert.deepEqual(quiet.selected, []);

    write(root, "pkg/a/src/index.ts", "export const a = 2;\n");
    await waitForEvent(session);
    const edit = await session.cycle();
    assert.equal(edit.mode, "incremental", `reason: ${edit.reason}`);
    assert.deepEqual(edit.changes, [{ path: "pkg/a/src/index.ts", status: "modified" }]);
    assert.equal(edit.plan?.fallback, null);
    assert.deepEqual(edit.selected, ["pkg/a"]);
    assert.deepEqual(edit.results.map((r) => r.outcome), ["pass"]);
    assert.equal(edit.advanced, false, "an uncommitted edit never advances");
  } finally {
    await session.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a committed edit advances the baseline once the run is complete and the tree is clean", async () => {
  const { root, store, base } = await fixture();
  const session = sessionFor(root, store);
  try {
    await session.open();
    await session.cycle();
    write(root, "pkg/b/src/index.ts", "export const b = 2;\n");
    await waitForEvent(session);
    const edit = await session.cycle();
    assert.deepEqual(edit.selected, ["pkg/b"]);
    assert.equal(edit.advanced, false);

    commit(root, "edit b");
    const committed = await session.cycle();
    assert.equal(committed.mode, "incremental", `reason: ${committed.reason}`);
    assert.deepEqual(committed.selected, ["pkg/b"]);
    assert.equal(committed.advanced, true);
    assert.equal(await storedBaseline(store, root), git(root, "rev-parse", "HEAD"));

    const quiet = await session.cycle();
    assert.equal(quiet.mode, "incremental");
    assert.deepEqual(quiet.selected, []);
  } finally {
    await session.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("an event loss produces a full run and no partial plan, then the watch re-arms", async () => {
  const { root, store, base } = await fixture();
  const session = sessionFor(root, store);
  try {
    await session.open();
    await session.cycle();
    session.reportLoss("overflow");
    const lost = await session.cycle();
    assert.equal(lost.mode, "full");
    assert.match(lost.reason ?? "", /^watcher_lost: overflow/);
    assert.equal(lost.plan, null, "no plan is computed from a lost window");
    assert.deepEqual(lost.selected, ["pkg/a", "pkg/b"]);
    assert.equal(lost.advanced, false);

    const after = await session.cycle();
    assert.equal(after.mode, "incremental", `reason: ${after.reason}`);
    assert.equal(after.reason, null);
  } finally {
    await session.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a restart with no in-memory history runs everything", async () => {
  const { root, store, base } = await fixture();
  try {
    const before = await storedBaseline(store, root);
    const first = sessionFor(root, store);
    await first.open();
    await first.cycle();
    await first.close();

    const restarted = sessionFor(root, store);
    try {
      await restarted.open();
      const r = await restarted.cycle();
      assert.equal(r.mode, "full");
      assert.equal(r.reason, "no_history");
      assert.deepEqual(r.selected, ["pkg/a", "pkg/b"]);
    } finally {
      await restarted.close();
    }
    assert.equal(await storedBaseline(store, root), before, "a watcher run without a complete window does not move the baseline");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("no advance when the watcher was not running since the baseline", async () => {
  const { root, store, base } = await fixture();
  const before = await storedBaseline(store, root);
  try {
    // A commit made while no watcher ran: the tree no longer equals the baseline.
    write(root, "pkg/a/src/index.ts", "export const a = 3;\n");
    commit(root, "edit while no watcher ran");

    const session = sessionFor(root, store);
    try {
      await session.open();
      const r1 = await session.cycle();
      assert.equal(r1.advanced, false);
      assert.deepEqual(r1.selected, ["pkg/a", "pkg/b"]);
      const r2 = await session.cycle();
      assert.equal(r2.mode, "full");
      assert.equal(r2.reason, "not_watching_since_baseline");
      assert.equal(r2.advanced, false);
    } finally {
      await session.close();
    }
    assert.equal(await storedBaseline(store, root), before, "the store baseline did not move");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a task input under an ignored directory is refused, not silently skipped", () => {
  const { root } = { root: mkdtempSync(path.join(os.tmpdir(), "backplane-watcher-cfg-")) };
  try {
    write(root, "node_modules/dep/index.js", "x\n");
    assert.throws(() => inputsOf(root, { id: "t", command: ["true"], inputs: ["node_modules/dep"] }), ConfigError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Silent drops (spec/adapters/watcher.md): the OS may deliver no event for an
// edit. The state must still report it, because it is read from a stat walk
// against the snapshot, never from the event stream.
test("an edit with no event delivered is still reported, and a rebase clears it", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "backplane-watch-silent-"));
  try {
    writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    writeFileSync(path.join(dir, "b.ts"), "export const b = 1;\n");
    const w = new Watcher(dir);
    w.rebase();
    // Let the snapshot age past the racy window before a file can be compared by stat.
    await new Promise((r) => setTimeout(r, 2_100));
    const before = w.state();
    assert.deepEqual(before.changes, [], "nothing changed, nothing reported");

    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    rmSync(path.join(dir, "b.ts"));
    // No start(): no watch is open, so no event exists for either change.
    const after = w.state();
    assert.deepEqual(after.changes.map((c) => `${c.status} ${c.path}`), ["modified a.ts", "deleted b.ts"]);
    assert.equal(after.lost, null);

    w.rebase();
    await new Promise((r) => setTimeout(r, 2_100));
    assert.deepEqual(w.state().changes, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

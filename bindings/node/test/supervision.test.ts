// Process supervision: restart after kill, request timeouts, the request
// queue, and the error type (plans/PLAN.md 10.1, 15.4 E3).
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { backplaneError, connect, isBackplaneError, type AffectedOptions, type Observation, type backplane } from "../src/index.js";
import {
  SILENT_ENGINE,
  comparePlan,
  initStore,
  loadCases,
  once,
  replay,
  sameJSON,
  seedsOf,
  tempDir,
  worktreeOf,
} from "./helpers.js";

const base = loadCases().find((c) => c.id === "C01")!;
const q = base.query!;
const changes = { baseline: q.baseline, changes: q.changes };
const options = { baseline: q.baseline, context: q.context!, verify: false, policy: "balanced" } as AffectedOptions;

// A store holding the base conformance history, plus its worktree.
async function seededStore(label: string): Promise<{ store: string; root: string }> {
  const store = initStore(label);
  const root = worktreeOf(base);
  await once(store, root, (k) => replay(k, seedsOf(base)));
  return { store, root };
}

function observation(task: string): Observation {
  return {
    task,
    baseline: "b1",
    dirty: false,
    context: {
      lockfile: "sha256:l1",
      tsconfig: "sha256:t1",
      pkgjson: "sha256:p1",
      runner: "vitest@4.1.12",
      node: "22.11.0",
      fmt: 1,
      caps: { probes: true, dirs: true, env: true },
    },
    inputs: [],
    outputs: [],
    outcome: "pass",
    duration_ms: 1,
  };
}

// Waits until the client has noticed that its server exited (pid goes undefined).
async function waitForExit(c: backplane): Promise<void> {
  const deadline = Date.now() + 5000;
  while (c.pid !== undefined) {
    if (Date.now() > deadline) throw new Error("server did not exit");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("restart after kill: the next request restarts, re-runs hello, and answers correctly", async () => {
  const { store, root } = await seededStore("restart");
  const c = await connect({ store, root });
  try {
    const before = await c.affected(changes, options);
    const firstPid = c.pid;
    assert.ok(firstPid !== undefined);
    process.kill(firstPid, "SIGKILL");
    // Sent immediately after the kill: the client must still answer correctly.
    const after = await c.affected(changes, options);
    assert.notEqual(c.pid, firstPid, "a new server process was started");
    assert.equal(sameJSON(before, after), true, "the plan after restart is identical");
    const hello = await c.hello();
    assert.equal(hello.protocol, 1);
    assert.equal(hello.engine.name.length > 0, true);
  } finally {
    await c.close();
  }
});

test("restart after kill while idle: the next write restarts the server and is recorded", async () => {
  const { store, root } = await seededStore("restart-idle");
  const c = await connect({ store, root });
  try {
    const pid = c.pid!;
    process.kill(pid, "SIGKILL");
    await waitForExit(c);
    assert.equal(c.pid, undefined);
    await c.observe(observation("packages/core/src/restart.test.ts"));
    assert.notEqual(c.pid, pid);
    const stats = await c.stats();
    assert.equal(stats.observations, 8);
    const plan = await c.affected(changes, options);
    assert.deepEqual(comparePlan(plan, { fallback: null, confidence: "medium" }), []);
  } finally {
    await c.close();
  }
});

test("restart: false: after the server dies, requests reject with internal instead of restarting", async () => {
  const { store, root } = await seededStore("norestart");
  const c = await connect({ store, root, restart: false });
  try {
    process.kill(c.pid!, "SIGKILL");
    await waitForExit(c);
    await assert.rejects(c.affected(changes, options), (e: unknown) => {
      assert.ok(isBackplaneError(e));
      assert.equal(e.code, "internal");
      return true;
    });
  } finally {
    await c.close();
  }
});

test("timeout: a request that the server does not answer rejects with code timeout", async () => {
  const store = initStore("timeout");
  const c = await connect({ command: [process.execPath, SILENT_ENGINE], store, root: tempDir("troot"), timeoutMs: 1 });
  try {
    // The silent engine answers hello only; affected is never answered.
    await assert.rejects(c.affected(changes, options), (e: unknown) => {
      assert.ok(e instanceof backplaneError);
      assert.equal(e.code, "timeout");
      assert.deepEqual(e.data, { partial: false, timeoutMs: 1, method: "affected" });
      return true;
    });
    // The client stopped the hung server; the next request starts a fresh one
    // and times out the same way (no partial plan, no hang).
    await assert.rejects(c.affected(changes, options), { code: "timeout" });
  } finally {
    await c.close();
  }
});

test("queue: concurrent observe and affected calls run in call order, each gets its own answer", async () => {
  const { store, root } = await seededStore("queue");
  const c = await connect({ store, root });
  const done: number[] = [];
  const track = <T>(i: number, p: Promise<T>): Promise<T> =>
    p.then((v) => {
      done.push(i);
      return v;
    });
  try {
    const results = await Promise.all([
      track(0, c.observe(observation("packages/core/src/q1.test.ts"))),
      track(1, c.affected(changes, options)),
      track(2, c.observe(observation("packages/core/src/q2.test.ts"))),
      track(3, c.affected(changes, options)),
      track(4, c.observeMany([observation("packages/core/src/q3.test.ts"), observation("packages/core/src/q4.test.ts")])),
      track(5, c.stats()),
    ]);
    assert.deepEqual(done, [0, 1, 2, 3, 4, 5], "completed in call order");
    assert.deepEqual(results[0], { accepted: true });
    assert.equal((results[1] as { total_tasks: number }).total_tasks, 8, "affected sees the first write only");
    assert.deepEqual(results[2], { accepted: true });
    assert.equal((results[3] as { total_tasks: number }).total_tasks, 9, "affected sees the second write only");
    assert.deepEqual(results[4], { accepted: 2 });
    assert.equal((results[5] as { tasks: number }).tasks, 11, "stats after all writes");
    assert.equal((results[5] as { observations: number }).observations, 11);
  } finally {
    await c.close();
  }
});

test("API: observe, baseline, advance, explain, forget, stats, compact, close", async () => {
  const { store, root } = await seededStore("api");
  const c = await connect({ store, root });
  try {
    assert.equal(c.protocol, 1);
    assert.deepEqual(await c.baseline(), { baseline: "b1" });
    assert.deepEqual(await c.advance("b2", "b1"), { baseline: "b2" });
    assert.deepEqual(await c.baseline(), { baseline: "b2" });
    assert.equal((await c.explain("packages/core/src/math.test.ts")).observed, true);
    assert.deepEqual(await c.forget("packages/core/src/old.test.ts"), { forgotten: true });
    assert.equal((await c.stats()).tasks, 6);
    const compact = await c.compact();
    assert.ok(compact.before_bytes >= compact.after_bytes);
  } finally {
    await c.close();
  }
  await assert.rejects(c.stats(), (e: unknown) => {
    assert.ok(isBackplaneError(e));
    return true;
  });
});

test("connect: a missing store rejects with store_missing", async () => {
  const missing = path.join(tempDir("missing"), "nope");
  await assert.rejects(connect({ store: missing, root: tempDir("mroot") }), (e: unknown) => {
    assert.ok(e instanceof backplaneError);
    assert.equal(e.code, "store_missing");
    return true;
  });
});

test("backplaneError: carries code and data; an unknown engine code becomes internal", () => {
  const e = new backplaneError("baseline_conflict", "expected b0", { expected: "b0", actual: "b1" });
  assert.ok(e instanceof Error);
  assert.equal(e.name, "backplaneError");
  assert.equal(e.code, "baseline_conflict");
  assert.deepEqual(e.data, { expected: "b0", actual: "b1" });
  const u = new backplaneError("made_up", "msg");
  assert.equal(u.code, "internal");
  assert.deepEqual(u.data, { engineCode: "made_up" });
});

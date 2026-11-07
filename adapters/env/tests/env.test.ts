// Wiring tests: allowlisted environment variables as observation inputs, through the real
// engine (spec/adapters/env.md). Environments are passed in explicitly; process.env is never read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  connect,
  defaultEngine,
  type incremental,
  type Context,
  type Plan,
} from "@incremental/client";
import { contextFor, planEnv, recordTasks, type Env, type EnvTask } from "../src/index.js";

interface Fixture {
  root: string;
  store: string;
}

function fixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-env-"));
  const store = path.join(base, "store");
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
  return { root: base, store };
}

async function withClient<T>(f: Fixture, fn: (c: incremental) => Promise<T>): Promise<T> {
  const c = await connect({ store: f.store, root: f.root, timeoutMs: 60_000 });
  try {
    return await fn(c);
  } finally {
    await c.close();
  }
}

const BASE = "b1";

// Records the tasks at BASE in env, then returns the context they were recorded with.
async function record(c: incremental, env: Env, tasks: EnvTask[]): Promise<Context> {
  const context = contextFor(tasks.some((t) => t.envAll === true));
  await recordTasks(c, { baseline: BASE, context, env, tasks });
  return context;
}

async function plan(c: incremental, context: Context, env: Env, tasks: EnvTask[]): Promise<Plan> {
  return planEnv(c, { baseline: BASE, context, env, tasks });
}

function reasonsOf(p: Plan, id: string): string[] | undefined {
  return p.tasks.find((t) => t.id === id)?.reasons;
}

const TASKS: EnvTask[] = [
  { id: "tasks/a", names: ["TG_MODE"] },
  { id: "tasks/b", names: ["TG_OTHER"] },
];

test("a listed variable that changes invalidates the task that recorded it, and only that task", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const env = { TG_MODE: "fast", TG_OTHER: "x" };
      const context = await record(c, env, TASKS);
      const p = await plan(c, context, { ...env, TG_MODE: "slow" }, TASKS);
      assert.equal(p.fallback, null);
      assert.deepEqual(reasonsOf(p, "tasks/a"), ["env_changed:TG_MODE"]);
      assert.equal(reasonsOf(p, "tasks/b"), undefined);
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("documented gap: an unlisted variable that changes does not invalidate, even if a task reads it", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const env = { TG_MODE: "fast", TG_OTHER: "x", TG_UNLISTED: "1" };
      const context = await record(c, env, TASKS);
      const p = await plan(c, context, { ...env, TG_UNLISTED: "2" }, TASKS);
      assert.equal(p.fallback, null);
      assert.deepEqual(p.tasks, []);
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a variable unset when recorded is compared as unset, so setting it invalidates", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const context = await record(c, {}, [{ id: "tasks/a", names: ["TG_MODE"] }]);
      const p = await plan(c, context, { TG_MODE: "fast" }, [
        { id: "tasks/a", names: ["TG_MODE"] },
      ]);
      assert.deepEqual(reasonsOf(p, "tasks/a"), ["env_changed:TG_MODE"]);
      const same = await plan(c, context, {}, [{ id: "tasks/a", names: ["TG_MODE"] }]);
      assert.deepEqual(same.tasks, []);
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("env_all with a snapshot: an unchanged environment is not invalid, a changed variable is", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const tasks: EnvTask[] = [{ id: "tasks/all", names: [], envAll: true }];
      const env = { TG_MODE: "fast", HOME: "/h" };
      const context = await record(c, env, tasks);
      const same = await plan(c, context, { ...env }, tasks);
      assert.deepEqual(same.tasks, []);
      const changed = await plan(c, context, { ...env, HOME: "/other" }, tasks);
      assert.deepEqual(reasonsOf(changed, "tasks/all"), ["env_all_changed"]);
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

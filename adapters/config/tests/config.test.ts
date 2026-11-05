// Wiring tests: config files as declared inputs, through the real engine (spec/adapters/config.md).
// The store is created by the engine's `init`; baselines are opaque strings, as in the binding tests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { connect, defaultEngine, type incremental, type Context, type Plan } from "@incremental/client";
import { contextFor, loadConfig, planChanges, recordTasks, type TaskSpec } from "../src/index.js";

interface Fixture {
  root: string;
  store: string;
}

// A repo with one global config file (config/shared.json) and two non-global configs.
function fixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-config-"));
  const root = path.join(base, "repo");
  const store = path.join(base, "store");
  mkdirSync(path.join(root, "config"), { recursive: true });
  writeFileSync(path.join(root, "incremental.config.json"), JSON.stringify({ globalInputs: ["config/shared.json"] }));
  writeFileSync(path.join(root, "config/shared.json"), '{"v":1}\n');
  writeFileSync(path.join(root, "config/app.json"), '{"v":1}\n');
  writeFileSync(path.join(root, "config/other.json"), '{"v":1}\n');
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
  return { root, store };
}

function cleanup(f: Fixture): void {
  rmSync(path.dirname(f.root), { recursive: true, force: true });
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

// Records the tasks at BASE with the given caps, as the task's own recorder would.
async function record(c: incremental, f: Fixture, tasks: TaskSpec[], caps?: Context["caps"]): Promise<Context> {
  const context = contextFor(f.root, caps);
  await recordTasks(c, { root: f.root, baseline: BASE, context, tasks });
  return context;
}

function reasonsOf(plan: Plan, id: string): string[] | undefined {
  return plan.tasks.find((t) => t.id === id)?.reasons;
}

const TASKS: TaskSpec[] = [
  { id: "tasks/a", declares: ["config/app.json"] },
  { id: "tasks/b" },
];

test("the config file of incremental.config.json is read as globalInputs", () => {
  const f = fixture();
  try {
    assert.deepEqual(loadConfig(f.root).globalInputs, ["config/shared.json"]);
  } finally {
    cleanup(f);
  }
});

test("an edit to a global config input falls back, so every task that declares it is invalid", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const context = await record(c, f, TASKS);
      writeFileSync(path.join(f.root, "config/shared.json"), '{"v":2}\n');
      const plan = await planChanges(c, {
        root: f.root,
        baseline: BASE,
        context,
        changes: [{ path: "config/shared.json", status: "modified" }],
      });
      assert.equal(plan.fallback?.reason, "global_input");
      assert.deepEqual(plan.tasks.map((t) => t.id).sort(), ["tasks/a", "tasks/b"]);
    });
  } finally {
    cleanup(f);
  }
});

test("an edit to a declared non-global config invalidates only the task that declares it", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const context = await record(c, f, TASKS);
      writeFileSync(path.join(f.root, "config/app.json"), '{"v":2}\n');
      const plan = await planChanges(c, {
        root: f.root,
        baseline: BASE,
        context,
        changes: [{ path: "config/app.json", status: "modified" }],
      });
      assert.equal(plan.fallback, null);
      assert.deepEqual(reasonsOf(plan, "tasks/a"), ["declared:config/app.json"]);
      assert.equal(reasonsOf(plan, "tasks/b"), undefined);
    });
  } finally {
    cleanup(f);
  }
});

test("an absent declared config that is later created invalidates its task", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const context = await record(c, f, [{ id: "tasks/c", declares: ["config/new.json"] }]);
      writeFileSync(path.join(f.root, "config/new.json"), "{}\n");
      const plan = await planChanges(c, {
        root: f.root,
        baseline: BASE,
        context,
        changes: [{ path: "config/new.json", status: "added" }],
      });
      assert.deepEqual(reasonsOf(plan, "tasks/c"), ["declared:config/new.json"]);
    });
  } finally {
    cleanup(f);
  }
});

test("a change to a config no task declares falls back when probes and dirs are not recorded (cost of the default caps)", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const context = await record(c, f, TASKS);
      writeFileSync(path.join(f.root, "config/other.json"), '{"v":2}\n');
      const plan = await planChanges(c, {
        root: f.root,
        baseline: BASE,
        context,
        changes: [{ path: "config/other.json", status: "modified" }],
      });
      assert.equal(plan.fallback?.reason, "unobserved_input");
    });
  } finally {
    cleanup(f);
  }
});

test("documented gap: with caps that claim probes and dirs, an undeclared config change is unobserved, not invalidating", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const caps = { probes: true, dirs: true, env: false };
      const context = await record(c, f, TASKS, caps);
      writeFileSync(path.join(f.root, "config/other.json"), '{"v":2}\n');
      const plan = await planChanges(c, {
        root: f.root,
        baseline: BASE,
        context,
        changes: [{ path: "config/other.json", status: "modified" }],
      });
      assert.equal(plan.fallback, null);
      assert.deepEqual(plan.tasks, []);
      assert.deepEqual(plan.unobserved, ["config/other.json"]);
    });
  } finally {
    cleanup(f);
  }
});

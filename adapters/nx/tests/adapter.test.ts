// Wiring tests: Nx affected-project detection through the real engine
// (spec/adapters/nx.md). Environments and projects are passed in explicitly;
// process.env is never read.
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
} from "@frontal-labs/incremental-client";
import { contextFor } from "../src/index.js";

interface Fixture {
  root: string;
  store: string;
}

function fixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-nx-"));
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

// Records a synthetic observation for a task at BASE.
async function recordTask(
  c: incremental,
  task: string,
  baseline: string,
  context: Context,
  inputs: Array<{ kind: "file"; path: string; hash: string }>,
): Promise<void> {
  await c.observe({
    task,
    baseline,
    dirty: false,
    context,
    inputs,
    outputs: [],
    outcome: "pass",
    duration_ms: 1,
  });
}

test("affected projects from nx are passed to incremental as declared tasks", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const context = contextFor(f.root);
      // app and web both depend on shared/src/index.ts
      await recordTask(c, "projects/app", BASE, context, [
        { kind: "file", path: "projects/shared/src/index.ts", hash: "sha256:" + "0".repeat(64) },
      ]);
      await recordTask(c, "projects/web", BASE, context, [
        { kind: "file", path: "projects/shared/src/index.ts", hash: "sha256:" + "0".repeat(64) },
      ]);
      const plan = await c.affected(
        { baseline: BASE, changes: [{ path: "projects/shared/src/index.ts", status: "modified" }] },
        {
          baseline: BASE,
          context,
          verify: false,
          policy: "balanced",
          declared_tasks: ["projects/app", "projects/web"],
        },
      );
      assert.equal(plan.fallback, null);
      // Both app and web depend on shared, so both should be invalidated.
      assert.ok(
        plan.tasks.some((t) => t.id === "projects/app"),
        "app should be invalidated",
      );
      assert.ok(
        plan.tasks.some((t) => t.id === "projects/web"),
        "web should be invalidated",
      );
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("unaffected projects are not invalidated", async () => {
  const f = fixture();
  try {
    await withClient(f, async (c) => {
      await c.advance(BASE, null);
      const context = contextFor(f.root);
      // app depends on shared, utils does not
      await recordTask(c, "projects/app", BASE, context, [
        { kind: "file", path: "projects/shared/src/index.ts", hash: "sha256:" + "0".repeat(64) },
      ]);
      await recordTask(c, "projects/utils", BASE, context, [
        { kind: "file", path: "projects/utils/src/formatter.ts", hash: "sha256:" + "0".repeat(64) },
      ]);
      const plan = await c.affected(
        { baseline: BASE, changes: [{ path: "projects/shared/src/index.ts", status: "modified" }] },
        {
          baseline: BASE,
          context,
          verify: false,
          policy: "balanced",
          declared_tasks: ["projects/app", "projects/utils"],
        },
      );
      assert.equal(plan.fallback, null);
      // utils does not depend on shared, so it should not be invalidated.
      assert.ok(
        plan.tasks.some((t) => t.id === "projects/app"),
        "app should be invalidated",
      );
      assert.ok(
        !plan.tasks.some((t) => t.id === "projects/utils"),
        "utils should not be invalidated",
      );
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

// The NODE_OPTIONS probe (PLAN E4 step 0). A probe test checks that the
// recorder preload ran inside the forked worker, and the trace is checked for
// the reads of that task. Also checks the observation shape (PLAN 9.5).
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildObservation, runFile, type TraceEvent } from "../src/index.js";
import { vitestBin } from "../src/planner.js";
import { ADAPTER, PRELOAD, tmp, fixtureReady } from "./helpers.js";

const PROBE_TASK = "packages/probe/test/probe.test.ts";

test("NODE_OPTIONS reaches the forked worker: the preload runs there", async () => {
  fixtureReady();
  const dir = tmp("bp-probe-");
  try {
    mkdirSync(path.join(dir, "packages", "probe", "test"), { recursive: true });
    copyFileSync(path.join(ADAPTER, "fixtures", "repo", "vitest.config.mjs"), path.join(dir, "vitest.config.mjs"));
    writeFileSync(
      path.join(dir, PROBE_TASK),
      [
        "it('probe', () => {",
        "  expect(process.env.BACKPLANE_RECORDER).toBe('1');",
        "  expect(typeof process.send).toBe('function');",
        "  expect(process.ppid).not.toBe(process.pid);",
        "  expect(process.env.NODE_OPTIONS).toContain('--import');",
        "});",
        "",
      ].join("\n"),
    );
    const result = await runFile({
      root: dir,
      task: PROBE_TASK,
      workDir: path.join(dir, ".work"),
      index: 1,
      env: { ...process.env },
      timeoutMs: 120_000,
      vitestBin: vitestBin(),
      preloadPath: PRELOAD,
    });
    assert.equal(result.outcome, "pass", `probe test must pass: ${result.problem}`);
    const files = result.events.filter((e: TraceEvent) => e.k === "file").map((e) => e.p);
    assert.ok(files.includes(PROBE_TASK), "the probe test file is recorded as read");
    const pids = new Set(result.events.map((e) => e.pid));
    assert.ok(pids.size >= 1, "the trace has events");

    // Observation shape (PLAN 9.5): required fields and known input kinds.
    const ctx = {
      lockfile: "absent",
      tsconfig: "absent",
      pkgjson: "absent",
      runner: "vitest@4.1.12",
      node: process.version,
      fmt: 1,
      caps: { probes: true, dirs: true, env: true },
    };
    const obs = buildObservation(result, dir, ctx, "b1", false);
    assert.equal(obs.task, PROBE_TASK);
    assert.equal(obs.baseline, "b1");
    assert.equal(obs.dirty, false, "a clean probe run is not dirty");
    assert.equal(obs.outcome, "pass");
    for (const input of obs.inputs) {
      assert.ok(["file", "dir", "probe", "env", "env_all"].includes(input.kind), `known kind ${input.kind}`);
    }
    assert.ok(obs.inputs.some((i) => i.kind === "file" && i.path === PROBE_TASK), "the probe file is an input");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a worker thread makes the observation dirty (PLAN 11.2)", async () => {
  fixtureReady();
  const dir = tmp("bp-thread-");
  try {
    mkdirSync(path.join(dir, "packages", "probe", "test"), { recursive: true });
    copyFileSync(path.join(ADAPTER, "fixtures", "repo", "vitest.config.mjs"), path.join(dir, "vitest.config.mjs"));
    writeFileSync(
      path.join(dir, PROBE_TASK),
      [
        "import { Worker } from 'node:worker_threads';",
        "it('thread', async () => {",
        "  const v = await new Promise((resolve, reject) => {",
        "    const w = new Worker(\"require('node:worker_threads').parentPort.postMessage(7)\", { eval: true });",
        "    w.once('message', resolve); w.once('error', reject);",
        "  });",
        "  expect(v).toBe(7);",
        "});",
        "",
      ].join("\n"),
    );
    const result = await runFile({
      root: dir,
      task: PROBE_TASK,
      workDir: path.join(dir, ".work"),
      index: 1,
      env: { ...process.env },
      timeoutMs: 120_000,
      vitestBin: vitestBin(),
      preloadPath: PRELOAD,
    });
    assert.equal(result.outcome, "pass", `thread test must pass: ${result.problem}`);
    assert.ok(result.events.some((e) => e.k === "worker"), "the worker start is recorded");
    const ctx = { lockfile: "absent", tsconfig: "absent", pkgjson: "absent", runner: "vitest@4.1.12", node: process.version, fmt: 1, caps: { probes: true, dirs: true, env: true } };
    assert.equal(buildObservation(result, dir, ctx, "b1", false).dirty, true, "a worker thread makes the task dirty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

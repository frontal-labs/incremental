// Five scenarios through the MCP server over stdio (PLAN 15.4 E8, step 2).
// Each expected plan is derived by hand from docs/spec/POLICY.md; none of them was
// produced by running the server. Procedure per scenario (POLICY 2):
// a baseline is stored, observations are recorded, the worktree is edited,
// and affected_tasks is called through MCP.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "../src/context.js";
import type { Plan } from "@incremental/client";
import {
  affectedTasks,
  contextOf,
  envInput,
  fileInput,
  makeRepo,
  observation,
  seedStore,
  withMcpClient,
  writeRepoFile,
} from "./helpers.js";

// The fields compared against the expected plan (PLAN 9.6).
function core(plan: Plan): Omit<Plan, "protocol" | "baseline" | "graph_version" | "verify"> {
  return {
    tasks: plan.tasks,
    unobserved: plan.unobserved,
    ignored: plan.ignored,
    deleted_tasks: plan.deleted_tasks,
    total_tasks: plan.total_tasks,
    skipped: plan.skipped,
    fallback: plan.fallback,
    confidence: plan.confidence,
  };
}

test("S1 (V01-like): an edit to a leaf file selects only its reader", async () => {
  // Store: tests/leaf.test.ts reads src/leaf.ts; tests/other.test.ts reads src/other.ts.
  // Edit: src/leaf.ts modified. POLICY P3: reads:src/leaf.ts for the reader.
  // No fallback; total 2, one skipped; not verify, so confidence medium (8.6).
  const repo = makeRepo("s1", {
    "src/leaf.ts": "export const leaf = 1;\n",
    "src/other.ts": "export const other = 1;\n",
  });
  await seedStore(repo, [
    observation(repo, "tests/leaf.test.ts", [fileInput(repo, "src/leaf.ts")]),
    observation(repo, "tests/other.test.ts", [fileInput(repo, "src/other.ts")]),
  ]);
  writeRepoFile(repo, "src/leaf.ts", "export const leaf = 2;\n");
  const plan = await withMcpClient(repo, {}, (c) => affectedTasks(c));
  assert.deepStrictEqual(core(plan), {
    tasks: [{ id: "tests/leaf.test.ts", reasons: ["reads:src/leaf.ts"] }],
    unobserved: [],
    ignored: [],
    deleted_tasks: [],
    total_tasks: 2,
    skipped: 1,
    fallback: null,
    confidence: "medium",
  });
  assert.equal(plan.baseline, repo.baseline);
});

test("S2 (V03-like): an edit to a shared utility selects every reader of it", async () => {
  // Store: tests/a reads util; tests/b reads util and leaf; tests/c reads leaf.
  // Edit: src/util.ts modified. P3 selects a and b. c is not a reader: skipped.
  const repo = makeRepo("s2", {
    "src/util.ts": "export const u = 1;\n",
    "src/leaf.ts": "export const l = 1;\n",
  });
  await seedStore(repo, [
    observation(repo, "tests/a.test.ts", [fileInput(repo, "src/util.ts")]),
    observation(repo, "tests/b.test.ts", [
      fileInput(repo, "src/util.ts"),
      fileInput(repo, "src/leaf.ts"),
    ]),
    observation(repo, "tests/c.test.ts", [fileInput(repo, "src/leaf.ts")]),
  ]);
  writeRepoFile(repo, "src/util.ts", "export const u = 2;\n");
  const plan = await withMcpClient(repo, {}, (c) => affectedTasks(c));
  assert.deepStrictEqual(core(plan), {
    tasks: [
      { id: "tests/a.test.ts", reasons: ["reads:src/util.ts"] },
      { id: "tests/b.test.ts", reasons: ["reads:src/util.ts"] },
    ],
    unobserved: [],
    ignored: [],
    deleted_tasks: [],
    total_tasks: 3,
    skipped: 1,
    fallback: null,
    confidence: "medium",
  });
});

test("S3 (V14-like): a lockfile change gives the global_input fallback", async () => {
  // Store context has the old lockfile hash. Edit: package-lock.json modified.
  // P1: the file matches the default globalInputs (PLAN 6.7) -> global_input.
  // P2: context.lockfile differs from the store -> context_changed.
  // 8.5: global_input outranks context_changed. Every known task is run.
  const repo = makeRepo("s3", {
    "package.json": '{"name":"fixture"}\n',
    "package-lock.json": '{"lockfileVersion":3}\n',
    "src/leaf.ts": "export const l = 1;\n",
  });
  await seedStore(repo, [
    observation(repo, "tests/leaf.test.ts", [fileInput(repo, "src/leaf.ts")]),
    observation(repo, "tests/none.test.ts", []),
  ]);
  writeRepoFile(repo, "package-lock.json", '{"lockfileVersion":3,"packages":{}}\n');
  const plan = await withMcpClient(repo, {}, (c) => affectedTasks(c));
  assert.deepStrictEqual(core(plan), {
    tasks: [
      { id: "tests/leaf.test.ts", reasons: ["fallback"] },
      { id: "tests/none.test.ts", reasons: ["fallback"] },
    ],
    unobserved: [],
    ignored: [],
    deleted_tasks: [],
    total_tasks: 2,
    skipped: 0,
    fallback: { action: "run_all", reason: "global_input" },
    confidence: "n/a",
  });
});

test("S4 (V10-like): an env-dependent task is selected when its env value changes", async () => {
  // Store: tests/env.test.ts recorded TG_FIXTURE_MODE = "local" (env input).
  // tests/plain.test.ts has no env input. No file changes.
  // The MCP server runs with TG_FIXTURE_MODE = "ci", so the query hash differs:
  // P2b env_changed:TG_FIXTURE_MODE for env.test.ts only.
  const repo = makeRepo("s4", { "src/leaf.ts": "export const l = 1;\n" });
  await seedStore(repo, [
    observation(repo, "tests/env.test.ts", [
      fileInput(repo, "src/leaf.ts"),
      envInput("TG_FIXTURE_MODE", "local"),
    ]),
    observation(repo, "tests/plain.test.ts", [fileInput(repo, "src/leaf.ts")]),
  ]);
  const plan = await withMcpClient(repo, { TG_FIXTURE_MODE: "ci" }, (c) => affectedTasks(c));
  assert.deepStrictEqual(core(plan), {
    tasks: [{ id: "tests/env.test.ts", reasons: ["env_changed:TG_FIXTURE_MODE"] }],
    unobserved: [],
    ignored: [],
    deleted_tasks: [],
    total_tasks: 2,
    skipped: 1,
    fallback: null,
    confidence: "medium",
  });
});

test("S5 (fallback): a changed runner in the stored context gives context_changed", async () => {
  // Store observations were recorded with runner vitest@4.1.11. The server
  // queries with vitest@4.1.12. P2 -> context_changed, the only fallback.
  // Every known task is run, with reason fallback; confidence n/a.
  const repo = makeRepo("s5", {
    "src/leaf.ts": "export const l = 1;\n",
    "src/other.ts": "export const o = 1;\n",
  });
  const oldContext = contextOf(repo, { runner: "vitest@4.1.11" });
  await seedStore(repo, [
    observation(repo, "tests/leaf.test.ts", [fileInput(repo, "src/leaf.ts")], oldContext),
    observation(repo, "tests/other.test.ts", [fileInput(repo, "src/other.ts")], oldContext),
  ]);
  writeRepoFile(repo, "src/leaf.ts", "export const l = 2;\n");
  const plan = await withMcpClient(repo, {}, (c) => affectedTasks(c));
  assert.deepStrictEqual(core(plan), {
    tasks: [
      { id: "tests/leaf.test.ts", reasons: ["fallback"] },
      { id: "tests/other.test.ts", reasons: ["fallback"] },
    ],
    unobserved: [],
    ignored: [],
    deleted_tasks: [],
    total_tasks: 2,
    skipped: 0,
    fallback: { action: "run_all", reason: "context_changed" },
    confidence: "n/a",
  });
});

test("the sha256 helper matches the adapter convention", () => {
  assert.equal(
    sha256("x"),
    "sha256:2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
  );
});

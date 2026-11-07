import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { packageGraph } from "../src/planner.js";

// A three-package pnpm workspace: a depends on b (a workspace package), b has no test script,
// c is standalone with a test script.
function workspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "turbo-graph-"));
  const put = (rel: string, obj: unknown) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), JSON.stringify(obj, null, 2));
  };
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  put("package.json", { name: "ws", private: true, packageManager: "pnpm@9.0.0" });
  put("turbo.json", { tasks: { test: { dependsOn: [] } } });
  put("packages/a/package.json", {
    name: "a",
    scripts: { test: "vitest run" },
    dependencies: { b: "workspace:*" },
  });
  put("packages/b/package.json", { name: "b", scripts: { build: "tsc" } });
  put("packages/c/package.json", { name: "c", scripts: { test: "vitest run" } });
  return root;
}

test("packageGraph reads the workspace packages, their dependencies, and the tested packages", () => {
  const g = packageGraph(workspace());
  assert.deepEqual(g.roots, { a: "packages/a", b: "packages/b", c: "packages/c" });
  assert.deepEqual(g.deps, { a: ["b"], b: [], c: [] });
  assert.deepEqual(g.tested, ["a", "c"]);
});

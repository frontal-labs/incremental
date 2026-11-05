// Input selection without a build (spec/adapters/turbopack.md): an app's inputs
// are the repository minus the directories of the other apps.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { excludedFor, repoInputs } from "../src/index.js";

function write(root: string, rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

test("an app's inputs exclude the other apps, and keep shared code and root files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "incremental-tp-inputs-"));
  try {
    write(root, "package.json", "{}");
    write(root, "libs/util/index.ts", "export {};\n");
    write(root, "apps/web/app/page.tsx", "x\n");
    write(root, "apps/docs/app/page.tsx", "y\n");
    const apps = ["apps/docs", "apps/web"];

    const web = repoInputs(root, excludedFor("apps/web", apps)).map((i) => i.path);
    assert.ok(web.includes("apps/web/app/page.tsx"));
    assert.ok(web.includes("libs/util/index.ts"), "shared code is an input");
    assert.ok(web.includes("package.json"), "root files are inputs");
    assert.ok(!web.some((p) => p.startsWith("apps/docs/")), "the other app is excluded");

    const root2 = repoInputs(root, excludedFor(".", ["."])).map((i) => i.path);
    assert.ok(
      root2.includes("apps/docs/app/page.tsx"),
      "a root app that is the only app sees everything",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the root app excludes the apps it does not contain, and an app keeps the root", () => {
  assert.deepEqual([...excludedFor("apps/web", [".", "apps/web", "apps/docs"])].sort(), [
    "apps/docs",
  ]);
  assert.deepEqual([...excludedFor(".", [".", "apps/web"])].sort(), ["apps/web"]);
});

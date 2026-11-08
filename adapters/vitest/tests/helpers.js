// Shared helpers for the adapter tests. Compiled to dist/tests/helpers.js.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEngine } from "@frontal-labs/incremental-client";
const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> the adapter root (adapters/vitest).
export const ADAPTER = path.resolve(here, "..", "..");
export const FIXTURE = path.join(ADAPTER, "fixtures", "repo");
export const CASES = path.join(ADAPTER, "fixtures", "cases");
export const RUN_JS = path.join(ADAPTER, "dist", "src", "run.js");
export const PRELOAD = path.join(ADAPTER, "dist", "src", "preload.js");
export const ENGINE = defaultEngine();
// The fixture's test files, sorted (CR-001: 7 in core, 7 in app).
export const FIXTURE_TESTS = [
  "packages/app/test/config.test.ts",
  "packages/app/test/disposable.test.ts",
  "packages/app/test/envall.test.ts",
  "packages/app/test/linked.test.ts",
  "packages/app/test/only-app.test.ts",
  "packages/app/test/plugins.test.ts",
  "packages/app/test/shared.test.ts",
  "packages/core/test/crash.test.ts",
  "packages/core/test/env.test.ts",
  "packages/core/test/leaf-a.test.ts",
  "packages/core/test/leaf-b.test.ts",
  "packages/core/test/probe.test.ts",
  "packages/core/test/util.test.ts",
  "packages/core/test/worker.test.ts",
];
export function tmp(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}
export function git(dir, args) {
  const r = spawnSync(
    "git",
    ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    {
      encoding: "utf8",
    },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}
// A fresh git repository holding the fixture, committed as the first commit.
export function makeRepo(dir) {
  cpSync(FIXTURE, dir, { recursive: true, verbatimSymlinks: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "fixture"]);
}
export function commitAll(dir) {
  git(dir, ["add", "-A"]);
  const staged = git(dir, ["diff", "--cached", "--name-only"]);
  if (staged.trim().length > 0) git(dir, ["commit", "-q", "-m", "edit"]);
}
// Applies file edits in the worktree and returns the environment overrides.
export function applyEdits(dir, edits) {
  const env = {};
  for (const e of edits) {
    if (e.op === "env") {
      env[e.name] = e.value;
    } else if (e.op === "write") {
      const file = path.join(dir, e.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, e.content);
    } else {
      rmSync(path.join(dir, e.path));
    }
  }
  return env;
}
// Runs the adapter CLI on a repo and store, with --json.
export function runCli(dir, store, extra = [], env = {}) {
  const r = spawnSync(
    process.execPath,
    [RUN_JS, "run", "--root", dir, "--store", store, "--json", ...extra],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 900_000,
    },
  );
  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = null;
  }
  return { status: r.status, out, stderr: r.stderr };
}
export function stats(store) {
  const r = spawnSync(ENGINE, ["stats", "--store", store, "--json"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`stats failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
export function sortChanges(cs) {
  return [...cs].sort((a, b) =>
    (a.path + a.status + (a.old_path ?? "")).localeCompare(b.path + b.status + (b.old_path ?? "")),
  );
}
export function normTasks(tasks) {
  return tasks
    .map((t) => ({ id: t.id, reasons: [...t.reasons].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function loadCases() {
  return readdirSync(CASES)
    .filter((f) => /^V\d+\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(CASES, f), "utf8")));
}
export function fixtureReady() {
  if (!existsSync(ENGINE)) throw new Error(`the engine is missing at ${ENGINE}; run make build`);
}
//# sourceMappingURL=helpers.js.map

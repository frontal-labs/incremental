// Integration tests: a scratch git repository with a pnpm workspace (one package
// depends on another), run through the real engine, incremental-git and pnpm
// (spec/adapters/pnpm.md). The fixture has no external dependencies.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { closure, declaredInputs, runAdapter, tasksOf, workspacePackages, type RunReport } from "../src/index.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

// Pinned to the repo's pnpm, so the fixture does not reach for corepack's default.
const ROOT_MANIFEST = { name: "fixture", private: true, packageManager: "pnpm@9.0.0" };
const PASS = 'node -e "process.exit(0)"';

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

function makeRepo(): { root: string; store: string } {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-pnpm-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, "package.json", JSON.stringify(ROOT_MANIFEST));
  write(root, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
  write(
    root,
    "packages/lib/package.json",
    JSON.stringify({ name: "@x/lib", version: "1.0.0", scripts: { build: PASS, test: PASS } }),
  );
  write(root, "packages/lib/index.js", "module.exports = 1;\n");
  write(
    root,
    "packages/app/package.json",
    JSON.stringify({
      name: "@x/app",
      version: "1.0.0",
      dependencies: { "@x/lib": "workspace:*" },
      // Fails while packages/app/fail.flag exists (a committed file, not a manifest change).
      scripts: { test: `node -e "process.exit(require('fs').existsSync('fail.flag') ? 1 : 0)"` },
    }),
  );
  commit(root, "init");
  return { root, store: path.join(base, "store") };
}

function cleanup(root: string): void {
  rmSync(path.dirname(root), { recursive: true, force: true });
}

async function run(root: string, store: string, base?: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 120_000, ...(base !== undefined ? { base } : {}) });
}

test("discovers workspace packages, their scripts and workspace edges", () => {
  const { root } = makeRepo();
  try {
    const pkgs = workspacePackages(root);
    assert.deepEqual(pkgs.map((p) => p.rel), [".", "packages/app", "packages/lib"]);
    const app = pkgs.find((p) => p.rel === "packages/app");
    assert.deepEqual(app?.deps, ["packages/lib"]);
    assert.deepEqual(closure(pkgs, "packages/app"), ["packages/app", "packages/lib"]);
    assert.deepEqual(tasksOf(pkgs).map((t) => t.task), ["packages/app#test", "packages/lib#build", "packages/lib#test"]);
  } finally {
    cleanup(root);
  }
});

test("a dependent declares the files of its workspace dependency", () => {
  const { root } = makeRepo();
  try {
    const paths = declaredInputs(root, workspacePackages(root), "packages/app").map((i) => i.path);
    assert.ok(paths.includes("packages/lib/index.js"), paths.join("\n"));
    assert.ok(paths.includes("packages/app/package.json"), paths.join("\n"));
    assert.ok(paths.includes("pnpm-workspace.yaml"), paths.join("\n"));
  } finally {
    cleanup(root);
  }
});

test("first run runs all tasks and advances the baseline", async () => {
  const { root, store } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["packages/app#test", "packages/lib#build", "packages/lib#test"]);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "pass", "pass"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a change to a workspace dependency invalidates its dependents", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "packages/lib/index.js", "module.exports = 2;\n");
    commit(root, "edit lib");
    const r = await run(root, store);
    // No confined task reads packages/lib/index.js, so the ignore list drops it. The
    // dependent is unconfined and dirty, so it is selected on its own account.
    const app = r.plan?.tasks.find((t) => t.id === "packages/app#test");
    assert.ok(app, "the dependent task is in the plan");
    assert.deepEqual(app.reasons, ["dirty_observation"]);
    assert.ok(r.selected.includes("packages/app#test"));
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a failing script is reported as fail and exits 1", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "packages/app/fail.flag", "");
    commit(root, "make app fail");
    const r = await run(root, store);
    const app = r.results.find((x) => x.task === "packages/app#test");
    assert.equal(app?.outcome, "fail");
    assert.equal(r.advanced, true, "a failed script is a complete run, so the baseline advances");
    assert.equal(r.exit, 1);
  } finally {
    cleanup(root);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "packages/lib/index.js", "module.exports = 3;\n");
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(r.notAdvanced.some((m) => m.includes("dirty")), r.notAdvanced.join("; "));
  } finally {
    cleanup(root);
  }
});

const ALL_TASKS = ["packages/app#test", "packages/lib#build", "packages/lib#test"];

// incremental-pnpm.json declares tasks whose scripts read only their declared inputs.
function confine(root: string, tasks: string[]): void {
  write(root, "incremental-pnpm.json", JSON.stringify({ confined: tasks }));
  commit(root, "declare confined tasks");
}

test("confined scripts are skipped when nothing they read changed", async () => {
  const { root, store } = makeRepo();
  try {
    confine(root, ALL_TASKS);
    await run(root, store);
    const r = await run(root, store);
    assert.deepEqual(r.selected, [], "no task is selected, so none is run");
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a confined edit reaches its own task and its dependents, and nothing else", async () => {
  const { root, store } = makeRepo();
  try {
    confine(root, ALL_TASKS);
    await run(root, store);
    write(root, "packages/lib/index.js", "module.exports = 3;\n");
    commit(root, "edit lib");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["packages/app#test", "packages/lib#build", "packages/lib#test"]);
    const app = r.plan?.tasks.find((t) => t.id === "packages/app#test");
    assert.ok(app?.reasons.some((m) => m.includes("packages/lib/index.js")), app?.reasons.join("; "));
    assert.equal(r.advanced, true);
  } finally {
    cleanup(root);
  }
});

test("an unconfined script stays dirty, so it runs again even when nothing changed", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    const r = await run(root, store);
    assert.deepEqual(r.selected, ALL_TASKS, "no recorder is paired, so the observation is dirty");
  } finally {
    cleanup(root);
  }
});

test("an edit no confined task reads selects nothing and does not fall back", async () => {
  const { root, store } = makeRepo();
  try {
    confine(root, ALL_TASKS);
    await run(root, store);
    write(root, "docs/notes.md", "outside every workspace package\n");
    commit(root, "docs only");
    const r = await run(root, store);
    assert.equal(r.plan?.fallback, null, `fallback: ${JSON.stringify(r.plan?.fallback)}`);
    assert.deepEqual(r.selected, []);
    assert.equal(r.advanced, true);
  } finally {
    cleanup(root);
  }
});

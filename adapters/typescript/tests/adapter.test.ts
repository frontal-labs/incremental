// Integration tests: a scratch git repository with two TypeScript projects, run
// through the real engine and backplane-git (spec/adapters/typescript.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverProjects, programFiles, runAdapter, type RunReport } from "../src/index.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

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
  const base = mkdtempSync(path.join(os.tmpdir(), "backplane-ts-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true }));
  for (const pkg of ["a", "b"]) {
    write(root, `pkg/${pkg}/tsconfig.json`, JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }));
    write(root, `pkg/${pkg}/src/index.ts`, `export const ${pkg}: number = 1;\n`);
  }
  write(root, "README.md", "fixture\n");
  commit(root, "init");
  return { root, store: path.join(base, "store") };
}

function cleanup(root: string): void {
  rmSync(path.dirname(root), { recursive: true, force: true });
}

async function run(root: string, store: string, base?: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 120_000, ...(base !== undefined ? { base } : {}) });
}

test("discovers each tsconfig.json as a project, skipping node_modules", () => {
  const { root } = makeRepo();
  try {
    write(root, "node_modules/dep/tsconfig.json", "{}");
    assert.deepEqual(discoverProjects(root), ["pkg/a/tsconfig.json", "pkg/b/tsconfig.json"]);
  } finally {
    cleanup(root);
  }
});

test("program files are the project's sources, repo-relative after the adapter", () => {
  const { root } = makeRepo();
  try {
    const files = programFiles(path.join(root, "pkg/a/tsconfig.json"));
    assert.ok(files.some((f) => f === path.join(root, "pkg/a/src/index.ts")), files.join("\n"));
    assert.ok(!files.some((f) => f.startsWith(path.join(root, "pkg/b"))), "project a must not list project b");
  } finally {
    cleanup(root);
  }
});

test("first run checks every project and advances the baseline", async () => {
  const { root, store } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["pkg/a/tsconfig.json", "pkg/b/tsconfig.json"]);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "pass"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a change to one project selects only that project", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "pkg/a/src/index.ts", "export const a: number = 2;\n");
    commit(root, "edit a");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["pkg/a/tsconfig.json"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a type error fails its project, exits 1 and keeps the project invalid", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "pkg/b/src/index.ts", 'export const b: number = "not a number";\n');
    commit(root, "break b");
    const r = await run(root, store);
    const b = r.results.find((x) => x.task === "pkg/b/tsconfig.json");
    assert.equal(b?.outcome, "fail");
    assert.equal(r.advanced, true, "a failed check is a complete run, so the baseline advances");
    assert.equal(r.exit, 1);

    // A docs-only edit is not an input of either project. The adapter declares
    // probes and dirs false (tsc probes during module resolution and the adapter
    // does not record those), so P7 falls back to running every project. That is
    // the sound answer, and it is the cost of this capability set.
    write(root, "README.md", "fixture, edited\n");
    commit(root, "docs only");
    const next = await run(root, store);
    assert.equal(next.fallback?.reason, "unobserved_input");
    assert.deepEqual(next.selected, ["pkg/a/tsconfig.json", "pkg/b/tsconfig.json"]);
    assert.equal(next.exit, 1, "the failed project still fails");
  } finally {
    cleanup(root);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "pkg/a/src/index.ts", "export const a: number = 3;\n");
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(r.notAdvanced.some((m) => m.includes("dirty")), r.notAdvanced.join("; "));
  } finally {
    cleanup(root);
  }
});

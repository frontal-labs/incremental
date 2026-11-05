// Integration tests: a scratch git repository with a biome.json and three files,
// run through the real engine, incremental-git and the real Biome binary
// (spec/adapters/biome.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { processedFiles, runAdapter, taskId, type RunReport } from "../src/index.js";

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

const CLEAN = "export const value = 1;\n";

function makeRepo(): { root: string; store: string } {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-biome-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, "biome.json", '{\n\t"linter": { "enabled": true }\n}\n');
  write(root, "src/a.ts", CLEAN);
  write(root, "src/b.ts", CLEAN);
  write(root, "src/sub/c.ts", CLEAN);
  commit(root, "init");
  return { root, store: path.join(base, "store") };
}

function cleanup(root: string): void {
  rmSync(path.dirname(root), { recursive: true, force: true });
}

async function run(root: string, store: string, base?: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 120_000, ...(base !== undefined ? { base } : {}) });
}

const outcomeOf = (r: RunReport, rel: string): string | undefined => r.results.find((x) => x.task === taskId(rel))?.outcome;

test("biome's file list is the task set, repo-relative and without the store", () => {
  const { root } = makeRepo();
  try {
    write(root, ".incremental/x.js", "var x = 1;\n");
    const files = processedFiles(root, ["."], 120_000);
    assert.deepEqual(files, ["biome.json", "src/a.ts", "src/b.ts", "src/sub/c.ts"]);
  } finally {
    cleanup(root);
  }
});

test("first run checks every file and advances the baseline", async () => {
  const { root, store } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["biome check biome.json", "biome check src/a.ts", "biome check src/b.ts", "biome check src/sub/c.ts"]);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "pass", "pass", "pass"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("an edit to one file invalidates only that file's task", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "src/a.ts", "export const value = 2;\n");
    commit(root, "edit a");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["biome check src/a.ts"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a file that fails biome check is reported as fail and exits 1", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "src/b.ts", "export const value = 'single quotes';\n");
    commit(root, "break b");
    const r = await run(root, store);
    assert.equal(outcomeOf(r, "src/b.ts"), "fail");
    assert.equal(outcomeOf(r, "src/a.ts"), undefined, "a is not selected");
    assert.equal(r.advanced, true, "a failed check is a complete run, so the baseline advances");
    assert.equal(r.exit, 1);
  } finally {
    cleanup(root);
  }
});

test("a change to biome.json invalidates every task", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "biome.json", '{\n  "formatter": { "indentStyle": "space" }\n}\n');
    commit(root, "config");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["biome check biome.json", "biome check src/a.ts", "biome check src/b.ts", "biome check src/sub/c.ts"]);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "src/a.ts", "export const value = 3;\n");
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(r.notAdvanced.some((m) => m.includes("dirty")), r.notAdvanced.join("; "));
  } finally {
    cleanup(root);
  }
});

test("a change to a config reached through extends invalidates every task", async () => {
  const { root, store } = makeRepo();
  try {
    write(root, "biome.json", '{\n\t"extends": ["./cfg/base.json"]\n}\n');
    write(root, "cfg/base.json", '{\n\t"linter": { "enabled": true }\n}\n');
    commit(root, "extends");
    await run(root, store);
    write(root, "cfg/base.json", '{\n\t"linter": { "enabled": false }\n}\n');
    commit(root, "edit base");
    const r = await run(root, store);
    assert.deepEqual(r.selected, [
      "biome check biome.json",
      "biome check cfg/base.json",
      "biome check src/a.ts",
      "biome check src/b.ts",
      "biome check src/sub/c.ts",
    ]);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

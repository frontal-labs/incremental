// Integration tests: a scratch git repository with three Python files, run
// through the real engine, incremental-git and ruff (spec/adapters/ruff.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverFiles, runAdapter, type RunReport } from "../src/index.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const PYPROJECT = '[tool.ruff.lint]\nselect = ["F"]\n';
const FILES = ["pkg/a.py", "pkg/b.py", "pkg/c.py"];

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
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-ruff-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, "pyproject.toml", PYPROJECT);
  for (const f of FILES) write(root, f, "VALUE = 1\n");
  write(root, "README.md", "fixture\n");
  commit(root, "init");
  return { root, store: path.join(base, "store") };
}

function cleanup(root: string): void {
  rmSync(path.dirname(root), { recursive: true, force: true });
}

async function run(root: string, store: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 120_000 });
}

// ruff checks pyproject.toml too (its own TOML rules), so it is a task.
const ALL = ["ruff check pkg/a.py", "ruff check pkg/b.py", "ruff check pkg/c.py", "ruff check pyproject.toml"];

test("discovers each file ruff checks as a task", () => {
  const { root } = makeRepo();
  try {
    write(root, "node_modules/dep/x.py", "x = 1\n");
    assert.deepEqual(discoverFiles(root), [...FILES, "pyproject.toml"]);
  } finally {
    cleanup(root);
  }
});

test("first run checks every file and advances the baseline", async () => {
  const { root, store } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, ALL);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "pass", "pass", "pass"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("an edit to one file selects only that file's task", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "pkg/a.py", "VALUE = 2\n");
    commit(root, "edit a");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["ruff check pkg/a.py"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a changed [tool.ruff] in pyproject.toml selects every task", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "pyproject.toml", '[tool.ruff.lint]\nselect = ["F", "E"]\n');
    commit(root, "config");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ALL);
    assert.equal(r.advanced, true);
  } finally {
    cleanup(root);
  }
});

test("a rule violation fails its file, exits 1, and the baseline advances", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "pkg/b.py", "import os\n");
    commit(root, "unused import");
    const r = await run(root, store);
    const b = r.results.find((x) => x.task === "ruff check pkg/b.py");
    assert.equal(b?.outcome, "fail", JSON.stringify(r.results));
    assert.equal(r.advanced, true, "a failed check is a complete run");
    assert.equal(r.exit, 1);

    // The failing file stays invalid until a clean run replaces its observation.
    const next = await run(root, store);
    assert.ok(next.selected.includes("ruff check pkg/b.py"));
    assert.equal(next.exit, 1);
  } finally {
    cleanup(root);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "pkg/a.py", "VALUE = 3\n");
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(r.notAdvanced.some((m) => m.includes("dirty")), r.notAdvanced.join("; "));
  } finally {
    cleanup(root);
  }
});

test("a new Python file falls back to every task (no probes or dirs observed)", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "pkg/d.py", "VALUE = 4\n");
    commit(root, "add d");
    const r = await run(root, store);
    assert.equal(r.fallback?.reason, "unobserved_input");
    assert.equal(r.selected.length, 5);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a deleted Python file runs every remaining task and forgets its own", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    git(root, "rm", "-q", "pkg/c.py");
    commit(root, "remove c");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["ruff check pkg/a.py", "ruff check pkg/b.py", "ruff check pyproject.toml"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

// Integration tests: a scratch Cargo workspace in a scratch git repository, run
// through the real engine, backplane-git and cargo clippy (spec/adapters/clippy.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { memberTasks, parseDepInfo, runAdapter, workspaceOf, type RunReport } from "../src/index.js";

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

function crate(root: string, name: string, lib: string, extra = ""): void {
  write(root, `crates/${name}/Cargo.toml`, `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${extra}`);
  write(root, `crates/${name}/src/lib.rs`, lib);
}

// A workspace of three crates: b depends on a, c is independent. The lock file is
// generated (no registry dependencies, so no network) and committed, so the
// worktree stays clean.
function makeRepo(): { root: string; store: string } {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "backplane-clippy-")));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, "Cargo.toml", '[workspace]\nresolver = "2"\nmembers = ["crates/*"]\n');
  crate(root, "a", "pub fn a() -> u32 {\n    1\n}\n");
  crate(root, "b", "pub fn b() -> u32 {\n    a::a() + 1\n}\n", "[dependencies]\na = { path = \"../a\" }\n");
  crate(root, "c", "pub fn c() -> u32 {\n    3\n}\n");
  write(root, "README.md", "fixture\n");
  lockfile(root);
  commit(root, "init");
  return { root, store: path.join(base, "store") };
}

function lockfile(root: string): void {
  const r = spawnSync("cargo", ["generate-lockfile"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cargo generate-lockfile failed: ${r.stderr}`);
}

function cleanup(root: string): void {
  rmSync(path.dirname(root), { recursive: true, force: true });
}

async function run(root: string, store: string, base?: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 300_000, ...(base !== undefined ? { base } : {}) });
}

function resultOf(r: RunReport, task: string) {
  const found = r.results.find((x) => x.task === task);
  assert.ok(found, `no result for ${task}: ${r.results.map((x) => x.task).join(", ")}`);
  return found;
}

test("parses dep-info: rules, escaped spaces, continuation lines and env records", () => {
  const text = "/t/deps/a-1.d: src/lib.rs Cargo.toml\n\nsrc/lib.rs:\n/t/a.d: my\\ file.rs \\\n  other.rs\n# env-dep:X=\n";
  assert.deepEqual(parseDepInfo(text), ["src/lib.rs", "Cargo.toml", "my file.rs", "other.rs"]);
});

test("discovers each workspace member as a task", () => {
  const { root } = makeRepo();
  try {
    assert.deepEqual(memberTasks(workspaceOf(root), root).map((m) => m.task), ["crates/a", "crates/b", "crates/c"]);
  } finally {
    cleanup(root);
  }
});

test("first run checks every crate and advances the baseline", async () => {
  const { root, store } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["crates/a", "crates/b", "crates/c"]);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "pass", "pass"]);
    assert.equal(r.advanced, true, r.notAdvanced.join("; "));
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("an edit to one crate selects only that crate", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "crates/c/src/lib.rs", "pub fn c() -> u32 {\n    4\n}\n");
    commit(root, "edit c");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["crates/c"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("an edit to a dependency selects it and its dependents", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "crates/a/src/lib.rs", "pub fn a() -> u32 {\n    2\n}\n");
    commit(root, "edit a");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["crates/a", "crates/b"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a deny-level clippy lint fails its crate, exits 1 and still advances", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "crates/c/src/lib.rs", "#![deny(clippy::needless_return)]\npub fn c() -> u32 {\n    return 3;\n}\n");
    commit(root, "break c");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["crates/c"]);
    assert.equal(resultOf(r, "crates/c").outcome, "fail", JSON.stringify(r.results));
    assert.equal(r.advanced, true, "a failed lint is a complete run, so the baseline advances");
    assert.equal(r.exit, 1);
  } finally {
    cleanup(root);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "crates/a/src/lib.rs", "pub fn a() -> u32 {\n    5\n}\n");
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(r.notAdvanced.some((m) => m.includes("dirty")), r.notAdvanced.join("; "));
  } finally {
    cleanup(root);
  }
});

test("a build script without rerun-if-changed is recorded dirty; one with it is not", async () => {
  const { root, store } = makeRepo();
  try {
    crate(root, "d", "pub fn d() {}\n");
    write(root, "crates/d/build.rs", "fn main() {}\n");
    crate(root, "e", "pub fn e() {}\n");
    write(root, "crates/e/build.rs", 'fn main() {\n    println!("cargo:rerun-if-changed=build-input.txt");\n}\n');
    write(root, "crates/e/build-input.txt", "x\n");
    lockfile(root);
    commit(root, "add build scripts");
    const r = await run(root, store);
    const d = resultOf(r, "crates/d");
    assert.equal(d.outcome, "pass");
    assert.equal(d.dirty, true);
    assert.ok(d.reasons.some((m) => m.includes("rerun-if-changed")), d.reasons.join("; "));
    const e = resultOf(r, "crates/e");
    assert.equal(e.dirty, false, e.reasons.join("; "));
    assert.equal(r.advanced, true);
  } finally {
    cleanup(root);
  }
});

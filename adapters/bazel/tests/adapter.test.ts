// Integration tests: a scratch Bazel workspace in a git repository, run through
// the real engine, backplane-git and bazel (spec/adapters/bazel.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverTests, labelPath, remoteFlags, runAdapter, type RunReport } from "../src/index.js";
import { bazelBin } from "../src/bazel.js";

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

// Three shell tests in one package: a and b pass, c fails. The rule is defined in
// the repository, so the fixture reads no external repository of its own.
function makeRepo(): { root: string; store: string; base: string } {
  const base = mkdtempSync(path.join(os.tmpdir(), "backplane-bazel-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, "MODULE.bazel", 'module(name = "fx", version = "0.0.0")\n');
  write(root, ".gitignore", "/bazel-*\n");
  write(root, "BUILD", "");
  write(
    root,
    "defs.bzl",
    [
      "def _impl(ctx):",
      '    exe = ctx.actions.declare_file(ctx.label.name + ".run")',
      "    ctx.actions.symlink(output = exe, target_file = ctx.file.src, is_executable = True)",
      "    return [DefaultInfo(executable = exe, files = depset([exe]))]",
      "",
      "shell_test = rule(",
      "    implementation = _impl,",
      "    test = True,",
      '    attrs = {"src": attr.label(allow_single_file = True, mandatory = True)},',
      ")",
      "",
    ].join("\n"),
  );
  write(root, "app/BUILD", 'load("//:defs.bzl", "shell_test")\nshell_test(name = "a", src = "a.sh")\nshell_test(name = "b", src = "b.sh")\nshell_test(name = "c", src = "c.sh")\n');
  write(root, "app/a.sh", "#!/bin/sh\nexit 0\n");
  write(root, "app/b.sh", "#!/bin/sh\nexit 0\n");
  write(root, "app/c.sh", "#!/bin/sh\nexit 1\n");
  for (const f of ["a", "b", "c"]) chmodSync(path.join(root, "app", `${f}.sh`), 0o755);
  // Bazel rewrites MODULE.bazel.lock on its first test run. Warm up, then commit
  // the settled lockfile, so the run itself leaves the worktree clean.
  for (const args of [["query", "//..."], ["test", "//app:a", "//app:b", "//app:c"]]) {
    spawnSync(bazelBin(), args, { cwd: root, encoding: "utf8" });
  }
  commit(root, "init");
  return { root, store: path.join(base, "store"), base };
}

// Expunges the workspace's Bazel output base (it is large), then removes the scratch files.
function cleanup(root: string, base: string): void {
  spawnSync(bazelBin(), ["clean", "--expunge"], { cwd: root, encoding: "utf8" });
  rmSync(base, { recursive: true, force: true });
}

const TARGETS = ["//app:a", "//app:b", "//app:c"];

async function run(root: string, store: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 300_000 });
}

test("labels are repo-relative paths, and main-repo test targets are discovered", () => {
  assert.equal(labelPath("//app:a.sh"), "app/a.sh");
  assert.equal(labelPath("//:BUILD"), "BUILD");
  assert.equal(labelPath("@rules_cc//cc:defs.bzl"), null);
  assert.equal(labelPath("//app/a.sh"), null, "a label without a colon is not named");
  const { root, base } = makeRepo();
  try {
    assert.deepEqual(discoverTests(root, 120_000), TARGETS);
  } finally {
    cleanup(root, base);
  }
});

test("remote execution flags are read from the canonical flags, empty values are not remote", () => {
  const canonical = [
    "INFO: Checking for file changes...",
    "--cache_test_results=0",
    "--remote_executor=grpc://build.example:8980",
    "--remote_cache=",
  ].join("\n");
  assert.deepEqual(remoteFlags(canonical), ["--remote_executor=grpc://build.example:8980"]);
  assert.deepEqual(remoteFlags("--cache_test_results=0\n--remote_cache="), []);
});

test("first run runs all tasks, reports the failing one as fail, and advances", async () => {
  const { root, store, base } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, TARGETS);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "pass", "fail"]);
    assert.equal(r.dirty, false);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 1, "a failed target exits 1 even though the run advanced");
  } finally {
    cleanup(root, base);
  }
});

test("an edit to one target's source invalidates only that target", async () => {
  const { root, store, base } = makeRepo();
  try {
    await run(root, store);
    write(root, "app/a.sh", "#!/bin/sh\nexit 0\n# edited\n");
    commit(root, "edit a");
    const r = await run(root, store);
    // b passed and did not read a.sh, so it is not selected. c failed last time,
    // so the engine selects it again (failed_outcome, PLAN 8.2 P9).
    assert.deepEqual(r.selected, ["//app:a", "//app:c"]);
    assert.deepEqual(r.plan?.tasks.find((t) => t.id === "//app:a")?.reasons, ["reads:app/a.sh"]);
    assert.deepEqual(r.plan?.tasks.find((t) => t.id === "//app:c")?.reasons, ["failed_outcome"]);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "fail"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 1);
  } finally {
    cleanup(root, base);
  }
});

test("an edit to a BUILD file, which every target in the package depends on, invalidates them all", async () => {
  const { root, store, base } = makeRepo();
  try {
    await run(root, store);
    write(root, "app/BUILD", 'load("//:defs.bzl", "shell_test")\n# edited\nshell_test(name = "a", src = "a.sh")\nshell_test(name = "b", src = "b.sh")\nshell_test(name = "c", src = "c.sh")\n');
    commit(root, "edit BUILD");
    const r = await run(root, store);
    assert.deepEqual(r.selected, TARGETS);
  } finally {
    cleanup(root, base);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store, base } = makeRepo();
  try {
    await run(root, store);
    write(root, "app/a.sh", "#!/bin/sh\nexit 0\n# uncommitted\n");
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(r.notAdvanced.some((m) => m.includes("dirty")), r.notAdvanced.join("; "));
  } finally {
    cleanup(root, base);
  }
});

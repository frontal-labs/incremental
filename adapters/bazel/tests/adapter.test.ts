// Integration tests: a scratch Bazel workspace in a git repository, run through
// the real engine, incremental-git and bazel (spec/adapters/bazel.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
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

interface Fixture {
  root: string;
  base: string;
  // The initial commit. Each test returns the worktree to it.
  initial: string;
  stores: number;
}

// Two shell tests in one package, a and b, both pass. The rule is defined in the
// repository, so the fixture reads no external repository of its own.
function makeFixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-bazel-"));
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
  write(
    root,
    "app/BUILD",
    'load("//:defs.bzl", "shell_test")\nshell_test(name = "a", src = "a.sh")\nshell_test(name = "b", src = "b.sh")\n',
  );
  write(root, "app/a.sh", "#!/bin/sh\nexit 0\n");
  write(root, "app/b.sh", "#!/bin/sh\nexit 0\n");
  for (const f of ["a", "b"]) chmodSync(path.join(root, "app", `${f}.sh`), 0o755);
  // `bazel test` writes MODULE.bazel.lock. Running it before the commit commits the
  // lockfile, so later runs leave the worktree clean.
  spawnSync(bazelBin(), ["test", "//...", "--nocache_test_results"], {
    cwd: root,
    encoding: "utf8",
  });
  commit(root, "init");
  return { root, base, initial: git(root, "rev-parse", "HEAD"), stores: 0 };
}

// Starting a Bazel server and loading the build graph is slow, so the workspace and
// its server are shared by the whole file. `fresh` returns the worktree to the
// initial commit and gives the test a store of its own.
let fx: Fixture;
before(() => {
  fx = makeFixture();
});

// Expunges the workspace's Bazel output base (it is large), then removes the scratch files.
after(() => {
  spawnSync(bazelBin(), ["clean", "--expunge"], { cwd: fx.root, encoding: "utf8" });
  rmSync(fx.base, { recursive: true, force: true });
});

function fresh(): { root: string; store: string } {
  git(fx.root, "reset", "-q", "--hard", fx.initial);
  git(fx.root, "clean", "-q", "-fd");
  fx.stores += 1;
  return { root: fx.root, store: path.join(fx.base, `store-${fx.stores}`) };
}

const TARGETS = ["//app:a", "//app:b"];

async function run(root: string, store: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 300_000 });
}

test("labels are repo-relative paths, and main-repo test targets are discovered", () => {
  assert.equal(labelPath("//app:a.sh"), "app/a.sh");
  assert.equal(labelPath("//:BUILD"), "BUILD");
  assert.equal(labelPath("@rules_cc//cc:defs.bzl"), null);
  assert.equal(labelPath("//app/a.sh"), null, "a label without a colon is not named");
  assert.deepEqual(discoverTests(fresh().root, 120_000), TARGETS);
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
  const { root, store } = fresh();
  const r = await run(root, store);
  assert.deepEqual(r.selected, TARGETS);
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["pass", "pass"],
  );
  assert.equal(r.dirty, false);
  assert.equal(r.advanced, true);
  assert.equal(r.exit, 0, "all targets pass and exit 0");
});

test("an edit to one target's source invalidates only that target", async () => {
  const { root, store } = fresh();
  await run(root, store);
  write(root, "app/a.sh", "#!/bin/sh\nexit 0\n# edited\n");
  commit(root, "edit a");
  const r = await run(root, store);
  // b passed and did not read a.sh, so it is not selected. Only a is invalidated.
  assert.deepEqual(r.selected, ["//app:a"]);
  assert.deepEqual(r.plan?.tasks.find((t) => t.id === "//app:a")?.reasons, ["reads:app/a.sh"]);
  assert.ok(
    !r.plan?.tasks.find((t) => t.id === "//app:b"),
    "b should not be invalidated since it did not read a.sh",
  );
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["pass"],
  );
  assert.equal(r.advanced, true);
  assert.equal(r.exit, 0);
});

test("an edit to a BUILD file, which every target in the package depends on, invalidates them all", async () => {
  const { root, store } = fresh();
  await run(root, store);
  write(
    root,
    "app/BUILD",
    'load("//:defs.bzl", "shell_test")\n# edited\nshell_test(name = "a", src = "a.sh")\nshell_test(name = "b", src = "b.sh")\n',
  );
  commit(root, "edit BUILD");
  const r = await run(root, store);
  assert.deepEqual(r.selected, TARGETS);
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store } = fresh();
  await run(root, store);
  write(root, "app/a.sh", "#!/bin/sh\nexit 0\n# uncommitted\n");
  const r = await run(root, store);
  assert.equal(r.advanced, false);
  assert.equal(r.exit, 7);
  assert.ok(
    r.notAdvanced.some((m) => m.includes("dirty")),
    r.notAdvanced.join("; "),
  );
});

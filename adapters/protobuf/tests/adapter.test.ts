// Integration tests: a scratch git repository with protoc targets (one importing
// another, one unrelated, one importing a well-known type) and a buf module, run
// through the real engine and incremental-git (spec/adapters/protobuf.md).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverTargets, parseDepFile, runAdapter, type RunReport } from "../src/index.js";

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

const LIB_A = `syntax = "proto3";
package lib;
import "google/protobuf/timestamp.proto";
message A { int32 x = 1; google.protobuf.Timestamp t = 2; }
`;

function makeRepo(): { root: string; store: string } {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-pb-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, "lib/a.proto", LIB_A);
  write(root, "app/b.proto", `syntax = "proto3";\npackage app;\nimport "lib/a.proto";\nmessage B { lib.A a = 1; }\n`);
  write(root, "c/c.proto", `syntax = "proto3";\npackage c;\nmessage C { int32 y = 1; }\n`);
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

test("discovers each .proto and buf.yaml as a target, skipping node_modules", () => {
  const { root } = makeRepo();
  try {
    write(root, "node_modules/dep/x.proto", "syntax = \"proto3\";\n");
    write(root, "mod/buf.yaml", "version: v2\n");
    const t = discoverTargets(root);
    assert.deepEqual(t.protoc, ["app/b.proto", "c/c.proto", "lib/a.proto"]);
    assert.deepEqual(t.buf, ["mod/buf.yaml"]);
  } finally {
    cleanup(root);
  }
});

test("parses protoc dependency files with continuations and escaped spaces", () => {
  const text = "/out/x.pb: /repo/lib/a.proto\\\n /usr/include/google/protobuf/timestamp.proto\\\n /repo/my\\ dir/b.proto\n";
  assert.deepEqual(parseDepFile(text), [
    "/repo/lib/a.proto",
    "/usr/include/google/protobuf/timestamp.proto",
    "/repo/my dir/b.proto",
  ]);
});

test("first run compiles every target and advances the baseline", async () => {
  const { root, store } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["app/b.proto", "c/c.proto", "lib/a.proto"]);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "pass", "pass"]);
    assert.equal(r.advanced, true, r.notAdvanced.join("; "));
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("an edit to an imported .proto invalidates every target that imports it", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "lib/a.proto", LIB_A.replace("int32 x = 1;", "int32 x = 1; int32 z = 3;"));
    commit(root, "edit lib a");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["app/b.proto", "lib/a.proto"]);
    assert.equal(r.advanced, true, r.notAdvanced.join("; "));
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("an edit to an unrelated .proto invalidates only its own target", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "c/c.proto", `syntax = "proto3";\npackage c;\nmessage C { int32 y = 2; }\n`);
    commit(root, "edit c");
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["c/c.proto"]);
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("a compile error fails its target, exits 1 and the baseline still advances", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "c/c.proto", `syntax = "proto3";\npackage c;\nmessage C { int32 y = 1 }\n`);
    commit(root, "break c");
    const r = await run(root, store);
    const c = r.results.find((x) => x.task === "c/c.proto");
    assert.equal(c?.outcome, "fail");
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 1);
  } finally {
    cleanup(root);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, "lib/a.proto", LIB_A.replace("int32 x = 1;", "int32 x = 9;"));
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(r.notAdvanced.some((m) => m.includes("dirty")), r.notAdvanced.join("; "));
  } finally {
    cleanup(root);
  }
});

test("a buf module is one task, built offline with buf build, and advances", async () => {
  const { root, store } = makeRepo();
  try {
    write(root, "mod/buf.yaml", "version: v2\n");
    write(root, "mod/x.proto", `syntax = "proto3";\npackage x;\nmessage X { int32 v = 1; }\n`);
    commit(root, "add buf module");
    const r = await run(root, store);
    const buf = r.results.find((x) => x.task === "mod/buf.yaml");
    assert.equal(buf?.kind, "buf");
    assert.equal(buf?.outcome, "pass", buf?.problem ?? "");
    assert.equal(r.advanced, true, r.notAdvanced.join("; "));
  } finally {
    cleanup(root);
  }
});

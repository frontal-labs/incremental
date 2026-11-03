// Integration tests: a scratch git repository with Playwright test files, run
// through the real engine, backplane-git and the pinned Playwright CLI
// (spec/adapters/playwright.md). No browser is launched: the test files use no
// browser fixture. The live test uses the request fixture against a local server,
// which is recorded dirty.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverTasks, defaultPlaywright, runAdapter, type RunReport } from "../src/index.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

// The adapter's node_modules, linked into the scratch repo so its test files can
// import @playwright/test. Ignored by git (.gitignore), so the worktree stays clean.
const NODE_MODULES = path.resolve(path.dirname(createRequire(import.meta.url).resolve("@playwright/test/package.json")), "..", "..");

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

const PURE_A = `import { test, expect } from "@playwright/test";
test("a adds", () => { expect(1 + 1).toBe(2); });
`;

const PURE_B = `import { test, expect } from "@playwright/test";
import { add } from "./helper";
test("b adds", () => { expect(add(1, 1)).toBe(2); });
`;

const LIVE = `import http from "node:http";
import { test, expect } from "@playwright/test";
test("live", async ({ request }) => {
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const port = (server.address() as { port: number }).port;
    expect(await (await request.get(\`http://127.0.0.1:\${port}/\`)).text()).toBe("ok");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
`;

function makeRepo(): { root: string; store: string; base: string } {
  const base = mkdtempSync(path.join(os.tmpdir(), "backplane-pw-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true }));
  write(root, "playwright.config.mjs", "export default {};\n");
  write(root, ".gitignore", "node_modules/\n");
  write(root, "pure/a.spec.ts", PURE_A);
  write(root, "pure/b.spec.ts", PURE_B);
  write(root, "pure/helper.ts", "export const add = (x: number, y: number): number => x + y;\n");
  write(root, "live/api.spec.ts", LIVE);
  symlinkSync(NODE_MODULES, path.join(root, "node_modules"), "dir");
  commit(root, "init");
  return { root, store: path.join(base, "store"), base };
}

function cleanup(base: string): void {
  rmSync(base, { recursive: true, force: true });
}

async function run(root: string, store: string, base?: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 120_000, ...(base !== undefined ? { base } : {}) });
}

function result(r: RunReport, task: string) {
  const found = r.results.find((x) => x.task === task);
  assert.ok(found, `no result for ${task}: ${r.results.map((x) => x.task).join(", ")}`);
  return found;
}

test("discovery lists the test files, not the helpers", () => {
  const { root, base } = makeRepo();
  try {
    assert.deepEqual(discoverTasks(root, defaultPlaywright()), ["live/api.spec.ts", "pure/a.spec.ts", "pure/b.spec.ts"]);
  } finally {
    cleanup(base);
  }
});

test("first run runs every task, advances the baseline and exits 0", async () => {
  const { root, store, base } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, ["live/api.spec.ts", "pure/a.spec.ts", "pure/b.spec.ts"]);
    assert.deepEqual(r.results.map((x) => x.outcome), ["pass", "pass", "pass"], JSON.stringify(r.results));
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(base);
  }
});

test("an edit to one test file invalidates only that test", async () => {
  const { root, store, base } = makeRepo();
  try {
    await run(root, store);
    write(root, "pure/a.spec.ts", PURE_A + "// edited\n");
    commit(root, "edit a");
    const r = await run(root, store);
    assert.ok(r.selected.includes("pure/a.spec.ts"), r.selected.join(", "));
    assert.ok(!r.selected.includes("pure/b.spec.ts"), "b does not import a");
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(base);
  }
});

test("an edit to a shared helper invalidates every test that imports it", async () => {
  const { root, store, base } = makeRepo();
  try {
    await run(root, store);
    write(root, "pure/helper.ts", "export const add = (x: number, y: number): number => x + y + 0;\n");
    commit(root, "edit helper");
    const r = await run(root, store);
    assert.ok(r.selected.includes("pure/b.spec.ts"), r.selected.join(", "));
    assert.ok(!r.selected.includes("pure/a.spec.ts"), "a does not import the helper");
  } finally {
    cleanup(base);
  }
});

test("a test that reaches a live server is recorded dirty, and a pure test is not", async () => {
  const { root, store, base } = makeRepo();
  try {
    const r = await run(root, store);
    assert.equal(result(r, "live/api.spec.ts").dirty, true);
    assert.equal(result(r, "live/api.spec.ts").outcome, "pass");
    assert.equal(result(r, "pure/a.spec.ts").dirty, false);
    assert.equal(result(r, "pure/b.spec.ts").dirty, false);
    // Dirty observations are never valid (POLICY P8), so the live test runs again.
    const next = await run(root, store);
    assert.ok(next.selected.includes("live/api.spec.ts"));
    assert.ok(!next.selected.includes("pure/a.spec.ts"));
  } finally {
    cleanup(base);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store, base } = makeRepo();
  try {
    await run(root, store);
    write(root, "pure/a.spec.ts", PURE_A + "// uncommitted\n");
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(r.notAdvanced.some((m) => m.includes("dirty")), r.notAdvanced.join("; "));
    assert.ok(!existsSync(path.join(root, "test-results")), "the run must not write into the worktree");
  } finally {
    cleanup(base);
  }
});

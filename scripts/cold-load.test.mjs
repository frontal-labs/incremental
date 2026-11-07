// Cold-load regression test: a new engine process must load tg.idx instead of
// replaying the whole log, when the store holds observations with contexts.
//
//   node --test scripts/cold-load.test.mjs
//
// The trace (INCREMENTAL_TRACE=1) names each phase of the load. A replay shows
// "log_replay"; an index load shows "idx_rebuild_dicts" and no replay.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(ROOT, "core", "dist", "incremental");
const TASKS = 500;

const CTX = {
  lockfile: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  tsconfig: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  pkgjson: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  runner: "vitest@0.0.0",
  node: process.version,
  fmt: 1,
  caps: { probes: true, dirs: true, env: true },
};

function observation(i) {
  return {
    task: `task-${i}`,
    baseline: "base",
    dirty: false,
    context: CTX,
    inputs: [{ kind: "file", path: `src/task-${i}.ts`, hash: "sha256:" + "0".repeat(64) }],
    outputs: [],
    outcome: "pass",
    duration_ms: 1,
  };
}

// Writes a store with TASKS observations and a baseline, then shuts the engine down,
// which writes tg.idx.
async function buildStore(store) {
  assert.equal(spawnSync(ENGINE, ["init", "--store", store]).status, 0);
  const proc = spawn(ENGINE, ["serve", "--store", store, "--root", ROOT], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const waiting = new Map();
  let nextId = 1;
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  const request = (method, params) =>
    new Promise((resolveReply) => {
      const id = nextId++;
      waiting.set(id, resolveReply);
      proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  await request("hello", { protocol: 1, client: { name: "cold-load-test", version: "0.1.0" } });
  const obs = await request("observe_many", {
    observations: Array.from({ length: TASKS }, (_, i) => observation(i)),
  });
  assert.equal(obs.result.accepted, TASKS);
  await request("advance", { to: "base", expected: null });
  proc.stdin.end();
  await new Promise((done) => proc.on("close", done));
}

test("cold start loads tg.idx when observations carry contexts", async () => {
  const work = mkdtempSync(join(os.tmpdir(), "cold-load-"));
  const store = path.join(work, "store");
  try {
    await buildStore(store);

    const r = spawnSync(ENGINE, ["stats", "--store", store, "--root", ROOT], {
      encoding: "utf8",
      env: { ...process.env, INCREMENTAL_TRACE: "1" },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).tasks, TASKS);
    assert.match(r.stderr, /trace idx_rebuild_dicts \d+ us/, "index was not loaded");
    assert.doesNotMatch(r.stderr, /trace log_replay/, "cold start replayed the whole log");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// A damaged or truncated tg.idx is a cache miss, not an error: the engine replays
// the log and answers the same.
for (const [name, damage] of [
  ["truncated", (img) => img.subarray(0, Math.floor(img.length / 2))],
  [
    "flipped body byte",
    (img) => {
      const out = Buffer.from(img);
      out[out.length - 100] ^= 0xff;
      return out;
    },
  ],
]) {
  test(`a ${name} tg.idx is ignored and the log is replayed`, async () => {
    const work = mkdtempSync(join(os.tmpdir(), "cold-load-"));
    const store = path.join(work, "store");
    try {
      await buildStore(store);
      const idx = path.join(store, "tg.idx");
      writeFileSync(idx, damage(readFileSync(idx)));

      const r = spawnSync(ENGINE, ["stats", "--store", store, "--root", ROOT], {
        encoding: "utf8",
        env: { ...process.env, INCREMENTAL_TRACE: "1" },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).tasks, TASKS);
      assert.match(r.stderr, /trace log_replay \d+ us/, "damaged index was not rejected");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
}

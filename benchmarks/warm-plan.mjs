#!/usr/bin/env node
// Warm plan latency benchmark.
//
//   node benchmarks/warm-plan.mjs <tasks> <queries> [iterations]
//
// Builds a store holding <tasks> synthetic observations, each reading a
// UNIQUE source file (src/task-<i>.ts). Then measures warm plan latency of
// `incremental serve` over protocol v1 stdio by changing one file per query,
// so only one task is invalidated per query — a realistic incremental query.
//
// Runs <iterations> full benchmark cycles and reports statistics (min, max,
// median, mean) for per-query latency.
//
//   process_load_ms     time to spawn the engine, complete the hello handshake,
//                        and load the store (first stats call, which triggers
//                        refresh_log with all <tasks> observations)
//   per_query_ms_approx average time of <queries> warm `affected` calls once
//                        the store is loaded (each invalidates exactly one task)
//   log_bytes           size of the store's tg.idx index image
//
// Prints one JSON object to stdout:
//
//   {"tasks":N,"queries":Q,"iterations":I,"process_load_ms":{..},"per_query_ms":{..},"log_bytes":Z,"note":"..."}
//
// `make bench` / `make bench-smoke` redirect stdout to
// benchmarks/results/warm-plan.json.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const ENGINE = join(process.cwd(), "core", "dist", "incremental");

const ROOT_CTX = {
  lockfile: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  tsconfig: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  pkgjson: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  runner: "vitest@0.0.0",
  node: process.version,
  fmt: 1,
  caps: { probes: true, dirs: true, env: true },
};

function synthObs(i, baseline) {
  return {
    task: `bench-task-${i}`,
    baseline,
    dirty: false,
    context: ROOT_CTX,
    inputs: [
      { kind: "file", path: `src/task-${i}.ts`, hash: "sha256:" + "0".repeat(64) },
      { kind: "dir", path: "src" },
    ],
    outputs: [],
    outcome: "pass",
    duration_ms: 1,
  };
}

function die(msg) {
  console.error(`benchmark: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const tasks = Number(argv[0] ?? 10000);
  const queries = Number(argv[1] ?? 100);
  const iterations = Number(argv[2] ?? 3);
  if (!Number.isInteger(tasks) || tasks < 1) die(`invalid tasks: ${argv[0]}`);
  if (!Number.isInteger(queries) || queries < 1) die(`invalid queries: ${argv[1]}`);
  if (!Number.isInteger(iterations) || iterations < 1) die(`invalid iterations: ${argv[2]}`);
  return { tasks, queries, iterations };
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function stats(xs) {
  return {
    min: Math.min(...xs),
    max: Math.max(...xs),
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    median: median(xs),
  };
}

// One stdio protocol v1 session against a spawned `incremental serve` process.
class Session {
  constructor(proc) {
    this.proc = proc;
    this.buf = "";
    this.pending = new Map();
    this.nextId = 1;
    this.exited = new Promise((res) => {
      proc.once("close", res);
    });
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (c) => this.onData(c));
    proc.stderr.on("data", () => {});
    proc.on("error", (e) => {
      this._fail(`engine error: ${e.message}`);
    });
  }
  onData(c) {
    this.buf += c;
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.trim()) {
        try {
          this.onLine(JSON.parse(line));
        } catch {
          /* non-protocol line; ignore */
        }
      }
    }
  }
  onLine(msg) {
    const p = this.pending && this.pending.get(msg.id);
    if (p) {
      this.pending.delete(p.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(String(msg.error)));
      else p.resolve(msg.result);
    }
  }
  _fail(msg) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(msg));
    }
    this.pending.clear();
  }
  request(method, params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout on ${method}`));
        try {
          this.proc.kill("SIGKILL");
        } catch {}
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      } catch (e) {
        reject(e);
      }
    });
  }
  async close() {
    try {
      await this.request("shutdown", {});
    } catch {}
    await this.exited;
    try {
      this.proc.kill("SIGKILL");
    } catch {}
  }
}

async function main() {
  const { tasks, queries, iterations } = parseArgs(process.argv.slice(2));
  const work = mkdtempSync(join(os.tmpdir(), "bp-bench-"));
  const store = join(work, "store");
  const baseline = "bench-baseline";

  // 1. Init the store via the CLI.
  const init = spawnSync(ENGINE, ["init", "--store", store], { encoding: "utf8" });
  if (init.status !== 0) die(`init failed: ${init.stderr}`);

  // 2. Insert <tasks> synthetic observations, each reading a unique file,
  //    then advance to the baseline. Use one serve session for setup.
  const setup = spawn(ENGINE, ["serve", "--store", store, "--root", process.cwd()], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const setupSess = new Session(setup);
  await setupSess.request("hello", { protocol: 1, client: { name: "setup", version: "0.1.0" } });
  await setupSess.request("observe_many", {
    observations: Array.from({ length: tasks }, (_, i) => synthObs(i, baseline)),
  });
  await setupSess.request("advance", { to: baseline, expected: null });
  setupSess.close();

  const processLoadSamples = [];
  const perQuerySamples = [];

  for (let iter = 0; iter < iterations; iter++) {
    // 3. Re-open a session and measure process load (spawn + hello + store load)
    //    via the first stats call, which triggers refresh_log over all records.
    const proc = spawn(ENGINE, ["serve", "--store", store, "--root", process.cwd()], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const sess = new Session(proc);
    const t0 = process.hrtime.bigint();
    await sess.request("hello", { protocol: 1, client: { name: "bench", version: "0.1.0" } });
    await sess.request("stats", {});
    const processLoadMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
    processLoadSamples.push(processLoadMs);

    // 4. Warm per-query latency: <queries> affected calls, each changing one
    //    unique source file so exactly one task is invalidated per query.
    const options = { baseline, context: ROOT_CTX, verify: false, policy: "balanced" };
    const queryMs = [];
    for (let i = 0; i < queries; i++) {
      const taskIdx = i % tasks;
      const changes = {
        baseline,
        changes: [{ path: `src/task-${taskIdx}.ts`, status: "modified" }],
      };
      const q0 = process.hrtime.bigint();
      const res = await sess.request("affected", { changes, options });
      const q1 = process.hrtime.bigint();
      queryMs.push(Number(q1 - q0) / 1_000_000);
      if (res.error) die(`affected error: ${JSON.stringify(res.error)}`);
      // Verify exactly one task was invalidated.
      const plan = res;
      if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length !== 1) {
        die(`expected 1 invalidated task, got ${plan && plan.tasks ? plan.tasks.length : "none"}`);
      }
    }
    perQuerySamples.push(queryMs.reduce((a, b) => a + b, 0) / queryMs.length);

    sess.close();
  }

  // 5. log_bytes: size of the index image written by graceful shutdown.
  const idxPath = join(store, "tg.idx");
  let logBytes = 0;
  try {
    logBytes = statSync(idxPath).size;
  } catch {}

  const result = {
    tasks,
    queries,
    iterations,
    process_load_ms: stats(processLoadSamples),
    per_query_ms: stats(perQuerySamples),
    log_bytes: logBytes,
    note: "warm plan latency over protocol v1 stdio; each query invalidates one task; process_load includes engine spawn + hello + store load; stats over multiple iterations",
  };
  console.log(JSON.stringify(result));
  // Best-effort cleanup of the temp store dir (the engine may release file
  // handles asynchronously on some platforms).
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {}
}

main().catch((e) => {
  console.error(`benchmark: ${e.message}`);
  process.exit(1);
});

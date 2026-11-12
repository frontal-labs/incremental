#!/usr/bin/env node
// Shared-file benchmark: one change to a file almost every task reads.
//
//   node benchmarks/shared-file.mjs [tasks] [reads] [iterations]
//
// Builds a store of <tasks> observations with realistic read sets, then asks
// `incremental serve` for the plan of two single-file changes:
//
//   shared   the widely shared file every task reads (expect all tasks invalid)
//   leaf     one module of one package (expect only that package's readers)
//
// Read sets (deterministic, seeded). Each task reads:
//   - the shared file, src/shared/core.ts, plus its package directory listing;
//   - a set of <reads>-1 further files: 70% drawn uniformly from its own
//     package's modules, 30% from the whole repo with a Zipf-like skew, so a few
//     modules are read by many packages, as in a real import graph.
// These are synthetic read sets. They are not taken from a real repository; the
// real-repository replay is a separate benchmark (benchmarks/replay).
//
// Prints one JSON object to stdout (redirect it into benchmarks/results/):
//   index bytes (tg.idx), total store bytes, read-set statistics, and for each
//   change the invalidated count (checked against the expected count), the
//   process load time and the warm query latency.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { ENGINE, ROOT_CTX, Session, stats } from "./lib/session.mjs";

const BASELINE = "shared-file-baseline";
const SHARED_PATH = "src/shared/core.ts";
const PACKAGES = 50;
const MODULES_PER_PACKAGE = 100;
const OBSERVE_BATCH = 500;
const QUERIES_PER_CHANGE = 5;

function die(msg) {
  console.error(`benchmark: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const tasks = Number(argv[0] ?? 5000);
  const reads = Number(argv[1] ?? 120);
  const iterations = Number(argv[2] ?? 3);
  if (!Number.isInteger(tasks) || tasks < 1) die(`invalid tasks: ${argv[0]}`);
  if (!Number.isInteger(reads) || reads < 2) die(`invalid reads: ${argv[1]}`);
  if (!Number.isInteger(iterations) || iterations < 1) die(`invalid iterations: ${argv[2]}`);
  return { tasks, reads, iterations };
}

// mulberry32: a small seeded PRNG, so the read sets are the same on every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function modulePath(pkg, mod) {
  return `src/pkg-${pkg}/module-${mod}.ts`;
}

function hashOf(path) {
  return "sha256:" + createHash("sha256").update(path).digest("hex");
}

// The read set of task <i>: a list of repo-relative file paths, deduplicated.
function readSetFor(i, reads, random) {
  const pkg = i % PACKAGES;
  const set = new Set([SHARED_PATH]);
  const poolSize = PACKAGES * MODULES_PER_PACKAGE;
  while (set.size < reads) {
    if (random() < 0.7) {
      set.add(modulePath(pkg, Math.floor(random() * MODULES_PER_PACKAGE)));
    } else {
      // Zipf-like: index = floor(pool^u) puts most picks on the low indices.
      const g = Math.min(poolSize - 1, Math.floor(poolSize ** random()) - 1);
      const p = Math.floor(g / MODULES_PER_PACKAGE);
      set.add(modulePath(p, g % MODULES_PER_PACKAGE));
    }
  }
  return [...set];
}

function observationFor(i, files, baseline) {
  const pkg = i % PACKAGES;
  return {
    task: `shared-task-${i}`,
    baseline,
    dirty: false,
    context: ROOT_CTX,
    inputs: [
      ...files.map((path) => ({ kind: "file", path, hash: hashOf(path) })),
      { kind: "dir", path: `src/pkg-${pkg}` },
    ],
    outputs: [],
    outcome: "pass",
    duration_ms: 1,
  };
}

// Total bytes under a directory (the store is a directory of log and index files).
function dirBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    total += name.isDirectory() ? dirBytes(p) : statSync(p).size;
  }
  return total;
}

async function main() {
  const { tasks, reads, iterations } = parseArgs(process.argv.slice(2));
  const work = mkdtempSync(join(os.tmpdir(), "bp-shared-"));
  const store = join(work, "store");

  const init = spawnSync(ENGINE, ["init", "--store", store], { encoding: "utf8" });
  if (init.status !== 0) die(`init failed: ${init.stderr}`);

  // Build the read sets once, and count how often each file is read.
  const random = rng(20260608);
  const readCounts = new Map();
  const readSizes = [];
  const allFiles = new Set();
  const setup = spawn(ENGINE, ["serve", "--store", store, "--root", process.cwd()], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const setupSession = new Session(setup);
  await setupSession.request("hello", {
    protocol: 1,
    client: { name: "shared-file-setup", version: "0.1.0" },
  });
  for (let i = 0; i < tasks; i += OBSERVE_BATCH) {
    const observations = [];
    for (let j = i; j < Math.min(tasks, i + OBSERVE_BATCH); j++) {
      const files = readSetFor(j, reads, random);
      readSizes.push(files.length);
      for (const f of files) {
        readCounts.set(f, (readCounts.get(f) ?? 0) + 1);
        allFiles.add(f);
      }
      observations.push(observationFor(j, files, BASELINE));
    }
    await setupSession.request("observe_many", { observations }, 600000);
  }
  await setupSession.request("advance", { to: BASELINE, expected: null });
  await setupSession.close();

  // The leaf change is the least-read file that any task reads (a rarely
  // imported module), so its blast radius is small next to the shared file's.
  let leafPath = SHARED_PATH;
  let leafReaders = Infinity;
  for (const [file, count] of [...readCounts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (file !== SHARED_PATH && count < leafReaders) {
      leafPath = file;
      leafReaders = count;
    }
  }
  // The expected invalidation for each change, from the read sets themselves.
  const expected = {
    shared: tasks,
    leaf: readCounts.get(leafPath) ?? 0,
  };

  const changes = {
    shared: { baseline: BASELINE, changes: [{ path: SHARED_PATH, status: "modified" }] },
    leaf: { baseline: BASELINE, changes: [{ path: leafPath, status: "modified" }] },
  };
  const options = { baseline: BASELINE, context: ROOT_CTX, verify: false, policy: "balanced" };

  const loadSamples = [];
  const queryMs = { shared: [], leaf: [] };
  const invalidated = {};
  for (let iter = 0; iter < iterations; iter++) {
    const proc = spawn(ENGINE, ["serve", "--store", store, "--root", process.cwd()], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session = new Session(proc);
    const t0 = process.hrtime.bigint();
    await session.request("hello", {
      protocol: 1,
      client: { name: "shared-file", version: "0.1.0" },
    });
    await session.request("stats", {});
    loadSamples.push(Number(process.hrtime.bigint() - t0) / 1_000_000);

    for (const name of ["shared", "leaf"]) {
      for (let q = 0; q < QUERIES_PER_CHANGE; q++) {
        const q0 = process.hrtime.bigint();
        const plan = await session.request("affected", { changes: changes[name], options });
        queryMs[name].push(Number(process.hrtime.bigint() - q0) / 1_000_000);
        if (!plan || !Array.isArray(plan.tasks)) die(`${name}: no plan returned`);
        invalidated[name] = plan.tasks.length;
        if (plan.tasks.length !== expected[name]) {
          die(`${name}: invalidated ${plan.tasks.length}, expected ${expected[name]}`);
        }
      }
    }
    await session.close();
  }

  const indexBytes = statSync(join(store, "tg.idx")).size;
  const storeBytes = dirBytes(store);

  const result = {
    tasks,
    reads_per_task: reads,
    iterations,
    read_sets: {
      min: Math.min(...readSizes),
      max: Math.max(...readSizes),
      mean: readSizes.reduce((a, b) => a + b, 0) / readSizes.length,
      distinct_files: allFiles.size,
      shared_file_readers: readCounts.get(SHARED_PATH) ?? 0,
      leaf_file_readers: expected.leaf,
    },
    index_bytes: indexBytes,
    store_bytes: storeBytes,
    changes: {
      shared: {
        path: SHARED_PATH,
        invalidated: invalidated.shared,
        expected: expected.shared,
        query_ms: stats(queryMs.shared),
      },
      leaf: {
        path: leafPath,
        invalidated: invalidated.leaf,
        expected: expected.leaf,
        query_ms: stats(queryMs.leaf),
      },
    },
    process_load_ms: stats(loadSamples),
    note: "synthetic read sets (seeded); shared file read by every task; each query is one affected call over protocol v1 stdio",
  };
  console.log(JSON.stringify(result));
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {}
}

main().catch((e) => {
  console.error(`benchmark: ${e.message}`);
  process.exit(1);
});

#!/usr/bin/env node
// End-to-end comparison on the monorepo fixtures: how long a test run takes after one change,
// with and without affected-test selection.
//
//   node scripts/e2e-compare.mjs [iterations] [workdir]
//
// For each fixture (nx, turborepo, bazel) the change under test is the last commit that touches
// packages/shared/src/index.ts, and the base is its parent. The expected tests are the ones of
// shared, api and web (utils does not depend on shared).
//
// Each method runs at the change state, with a warm-up run before the timed runs:
//   raw          vitest run in the root, every test file (no selection)
//   nx           nx affected -t test, the Nx graph and its selection
//   turbo        turbo run test --filter=...[base], the Turborepo graph and its selection
//   bazel        bazel test over rdeps of the shared package (the query the fixture documents)
//   incremental  incremental-vitest run against a store warmed at the base (a copy per run)
//
// Time is wall-clock for the whole command, including the tool's own start-up and selection.
// Each run records the packages whose tests ran and whether the run passed. A method is
// "correct" when it ran every affected package (shared, api, web) and all of them passed. It is
// "selective" when it ran exactly those three, not more (raw runs utils too, so it is not).
//
// Output: benchmarks/results/e2e-compare.json (medians and per-run samples).

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INCR = join(ROOT, "adapters", "vitest", "dist", "src", "run.js");
const EXPECTED = ["api", "shared", "web"];
// Each fixture is measured with its own affected-detection tool, plus raw and Incremental.
const FIXTURES = {
  nx: ["raw", "nx", "incremental"],
  turborepo: ["raw", "turbo", "incremental"],
  bazel: ["raw", "bazel", "incremental"],
};

const iterations = Number(process.argv[2] ?? 5);
const work = process.argv[3] ?? mkdtempSync(join(os.tmpdir(), "e2e-compare-"));
if (!Number.isInteger(iterations) || iterations < 1) throw new Error(`invalid iterations: ${process.argv[2]}`);

function sh(cmd, args, opts = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function must(cmd, args, opts) {
  const r = sh(cmd, args, opts);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}):\n${r.out.slice(-2000)}`);
  return r;
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Packages named by a tool's output: "shared:test" (Nx, Turbo), "//packages/shared:shared_test"
// (Bazel), or "packages/shared/test/..." (Vitest file paths, used for raw and incremental).
function packagesIn(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((m) => m[1]))].sort();
}

function summarize(set, status) {
  const covers = EXPECTED.every((p) => set.includes(p));
  const selective = JSON.stringify(set) === JSON.stringify(EXPECTED);
  return { packages: set, pass: status === 0, correct: status === 0 && covers, selective: status === 0 && selective };
}

function setupFixture(name) {
  const dir = join(work, name);
  must("git", ["clone", "-q", join(ROOT, "monorepos", name), dir]);
  const change = must("git", ["-C", dir, "log", "-1", "--format=%H", "--", "packages/shared/src/index.ts"]).out.trim();
  const base = must("git", ["-C", dir, "rev-parse", `${change}^`]).out.trim();
  must("git", ["-C", dir, "checkout", "-q", "--detach", change]);
  // Install the fixture's Vitest without its workspace file (see monorepos/README.md). The
  // install rewrites package.json, so revert it: Turbo counts uncommitted edits.
  must("npx", ["--yes", "pnpm@9", "install", "--ignore-workspace", "--no-lockfile"], { cwd: dir });
  must("git", ["-C", dir, "checkout", "--", "."], { cwd: dir });
  return { name, dir, change, base };
}

const RUNNERS = {
  raw: (f) => sh("npx", ["vitest", "run", "--reporter=verbose"], { cwd: f.dir }),
  nx: (f) => sh("npx", ["nx", "affected", "-t", "test", `--base=${f.base}`, "--head=HEAD", "--skip-nx-cache"], {
    cwd: f.dir,
    env: { ...process.env, NX_DAEMON: "false", NX_NO_CLOUD: "true" },
  }),
  turbo: (f) => sh("npx", ["turbo", "run", "test", `--filter=...[${f.base}]`, "--force"], { cwd: f.dir }),
  bazel: (f) => {
    const q = must("bazel", ["query", "kind(test, rdeps(//packages/..., //packages/shared:shared_pkg))"], { cwd: f.dir });
    const targets = q.out.split("\n").filter((l) => l.startsWith("//"));
    return sh("bazel", ["test", "--nocache_test_results", ...targets], { cwd: f.dir });
  },
  incremental: (f) => {
    const store = join(work, `${f.name}-store`);
    rmSync(store, { recursive: true, force: true });
    cpSync(join(work, `${f.name}-store-base`), store, { recursive: true });
    return sh("node", [INCR, "run", "--json", "--store", store], { cwd: f.dir });
  },
};

// The set of packages each method ran, read from its output.
function packagesRan(method, r) {
  if (method === "raw") return packagesIn(r.out, /packages\/(\w+)\/test\//g);
  if (method === "nx" || method === "turbo") return packagesIn(r.out, /\b(shared|api|web|utils):test\b/g);
  if (method === "bazel") return packagesIn(r.out, /\/\/packages\/(\w+):\w+_test/g);
  // Incremental prints JSON; "selected" lists the test files it ran.
  const json = JSON.parse(r.out.slice(r.out.indexOf("{")));
  return packagesIn(json.selected.join("\n"), /packages\/(\w+)\/test\//g);
}

const results = { timestamp: new Date().toISOString(), iterations, fixtures: {} };

for (const [name, methods] of Object.entries(FIXTURES)) {
  const f = setupFixture(name);
  // Warm the Incremental store at the base, then snapshot it. Each timed run starts from the snapshot.
  must("git", ["-C", f.dir, "checkout", "-q", "--detach", f.base]);
  const warm = sh("node", [INCR, "run", "--all", "--store", join(work, `${f.name}-store-base`)], { cwd: f.dir });
  if (warm.status !== 0) throw new Error(`incremental warm-up failed for ${name}:\n${warm.out.slice(-1500)}`);
  must("git", ["-C", f.dir, "checkout", "-q", "--detach", f.change]);

  const per = {};
  for (const m of methods) {
    RUNNERS[m](f); // warm-up, untimed
    const runs = [];
    for (let i = 0; i < iterations; i++) {
      const r = RUNNERS[m](f);
      const set = packagesRan(m, r);
      runs.push({ ms: r.ms, ...summarize(set, r.status) });
    }
    per[m] = {
      median_ms: median(runs.map((x) => x.ms)),
      samples_ms: runs.map((x) => Math.round(x.ms)),
      packages: runs[0].packages,
      pass: runs.every((x) => x.pass),
      correct: runs.every((x) => x.correct),
      selective: runs.every((x) => x.selective),
    };
    console.error(`${name} ${m}: median ${per[m].median_ms.toFixed(0)} ms, packages ${per[m].packages.join(",")}, correct=${per[m].correct}, selective=${per[m].selective}`);
  }
  results.fixtures[name] = { base: f.base, change: f.change, methods: per };
}

const out = join(ROOT, "benchmarks", "results", "e2e-compare.json");
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.error(`wrote ${out}`);

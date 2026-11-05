#!/usr/bin/env node
// Cold end-to-end affected-detection benchmark.
//
//   node scripts/cold-e2e.mjs [runs]
//
// For each fixture repository, one run is:
//   1. changes:  incremental-git changes --base <base>      (the real git change source)
//   2. engine:   spawn `incremental serve` (a new process), hello
//   3. plan:     affected(ChangeSet, options)               (one query, nothing warm)
//   4. shutdown
// The timed span is steps 1-3, so it includes process start-up and store load.
//
// Setup per fixture (in a scratch copy, the fixture's own git history is not touched):
//   - copy the sources (no node_modules, .git, build output),
//   - commit the copy as the base,
//   - edit the non-test source file that the most tests depend on, commit as HEAD,
//   - build the import graph from the base, observe every test with its input closure,
//     and advance the store's baseline to the base commit.
//
// Correctness: the expected invalid set is the tests whose input closure contains the edited
// file. It is computed from the import graph, so the check tests the engine against that graph,
// not against a run of the tests.
//
// Output: benchmarks/results/cold-e2e.json and a table on stdout.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(ROOT, "core", "dist", "incremental");
const GIT_CHANGES = join(ROOT, "adapters", "git", "dist", "incremental-git");

// Fixture repositories. adapters/ has one fixture (adapters/vitest/fixtures/repo); the other
// adapters are tools with no fixture repository, so they have no target here.
const TARGETS = [
  { name: "monorepos/nx", dir: "monorepos/nx" },
  { name: "monorepos/turborepo", dir: "monorepos/turborepo" },
  { name: "monorepos/bazel", dir: "monorepos/bazel" },
  { name: "fixture", dir: "fixture" },
  { name: "adapters/vitest/fixtures/repo", dir: "adapters/vitest/fixtures/repo" },
];

const CTX = {
  lockfile: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  tsconfig: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  pkgjson: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  runner: "vitest@0.0.0",
  node: process.version,
  fmt: 1,
  caps: { probes: true, dirs: true, env: true },
};

const SKIP_DIR =
  /(^|\/)(node_modules|\.git|dist|\.turbo|\.nx|target|\.vite|\.vitest-cache|\.incremental|bazel-[^/]*)(\/|$)/;
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g;

function die(msg) {
  console.error(`cold-e2e: ${msg}`);
  process.exit(1);
}

function git(cwd, args) {
  const r = spawnSync(
    "git",
    ["-C", cwd, "-c", "user.name=cold-e2e", "-c", "user.email=cold-e2e@example", ...args],
    { encoding: "utf8" },
  );
  if (r.status !== 0) die(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
}

function sha256(buf) {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

// Every source file under dir, as posix paths relative to dir.
function listSources(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (SKIP_DIR.test(r)) continue;
      if (ent.isDirectory()) walk(join(abs, ent.name), r);
      else if (SOURCE.test(ent.name)) out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

// File -> the source files it imports (relative paths, plus the `@fixture/<pkg>/...` workspace alias).
function importGraph(dir, files) {
  const known = new Set(files);
  const resolveSpec = (fromRel, spec) => {
    let base;
    if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(fromRel), spec);
    else if (spec.startsWith("@fixture/")) base = "packages/" + spec.slice("@fixture/".length);
    else return null;
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.mjs`,
      `${base}/index.ts`,
      `${base}/index.js`,
    ];
    if (base.endsWith(".js")) candidates.push(base.replace(/\.js$/, ".ts"));
    return candidates.find((c) => known.has(c)) ?? null;
  };
  const deps = new Map();
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    const out = new Set();
    for (const m of text.matchAll(SPECIFIER)) {
      const r = resolveSpec(f, m[1]);
      if (r) out.add(r);
    }
    deps.set(f, [...out]);
  }
  return deps;
}

// Transitive closure of the imports of one file, including the file itself.
function closure(start, deps) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const d of deps.get(stack.pop()) ?? []) {
      if (!seen.has(d)) {
        seen.add(d);
        stack.push(d);
      }
    }
  }
  return seen;
}

// Scratch copy of a fixture with a base commit and a HEAD commit that edits one shared source file.
async function prepare(target) {
  const src = join(ROOT, target.dir);
  if (!existsSync(src)) die(`missing fixture ${target.dir}`);
  const work = mkdtempSync(join(os.tmpdir(), "cold-e2e-"));
  const repo = join(work, "repo");
  cpSync(src, repo, {
    recursive: true,
    filter: (p) => !SKIP_DIR.test(path.relative(src, p)),
  });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "--allow-empty", "-m", "base"]);
  const base = git(repo, ["rev-parse", "HEAD"]);

  const files = listSources(repo);
  const tests = files.filter((f) => TEST.test(f));
  const nonTests = files.filter((f) => !TEST.test(f));
  if (tests.length === 0) die(`no test files in ${target.name}`);
  const deps = importGraph(repo, files);

  // The changed file: the non-test source that the most tests depend on (ties: first by path).
  const closures = new Map(tests.map((t) => [t, closure(t, deps)]));
  let changed = null;
  let best = -1;
  for (const f of nonTests) {
    let n = 0;
    for (const c of closures.values()) if (c.has(f)) n++;
    if (n > best) {
      best = n;
      changed = f;
    }
  }
  if (!changed) die(`no shared source file in ${target.name}`);

  const expected = tests.filter((t) => closures.get(t).has(changed)).sort();
  const observations = tests.sort().map((t) => ({
    task: t,
    baseline: base,
    dirty: false,
    context: CTX,
    inputs: [...closures.get(t)].sort().map((p) => ({
      kind: "file",
      path: p,
      hash: sha256(readFileSync(join(repo, p))),
    })),
    outputs: [],
    outcome: "pass",
    duration_ms: 1,
  }));

  appendFileSync(join(repo, changed), `\n// cold-e2e edit\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "head"]);

  const store = join(work, "store");
  const init = spawnSync(ENGINE, ["init", "--store", store], { encoding: "utf8" });
  if (init.status !== 0) die(`engine init failed: ${init.stderr}`);
  await seedStore(store, repo, observations, base);

  return { work, repo, store, base, changed, expected, tests: tests.length };
}

// Load the observations and advance the baseline, using one serve session that is then closed.
async function seedStore(store, repo, observations, base) {
  const proc = spawn(ENGINE, ["serve", "--store", store, "--root", repo], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const sess = new Session(proc);
  await sess.request("hello", { protocol: 1, client: { name: "cold-e2e-seed", version: "0.1.0" } });
  const r = await sess.request("observe_many", { observations });
  if (r.error || r.accepted !== observations.length) die(`observe_many: ${JSON.stringify(r)}`);
  const a = await sess.request("advance", { to: base, expected: null });
  if (a.error) die(`advance: ${JSON.stringify(a)}`);
  await sess.close();
}

// One stdio session (protocol v1), line-delimited JSON, requests matched by id.
class Session {
  constructor(proc) {
    this.proc = proc;
    this.buf = "";
    this.pending = new Map();
    this.nextId = 1;
    this.exited = new Promise((res) => proc.once("close", res));
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (c) => this.onData(c));
    proc.stderr.on("data", () => {});
  }
  onData(c) {
    this.buf += c;
    let nl = this.buf.indexOf("\n");
    while (nl >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      nl = this.buf.indexOf("\n");
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg.error ? { error: msg.error } : msg.result);
      }
    }
  }
  request(method, params, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.proc.kill("SIGKILL");
        reject(new Error(`timeout on ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async close() {
    try {
      await this.request("shutdown", {}, 5000);
    } catch {}
    await this.exited;
  }
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

// One cold run: change set, then a new engine process, hello, one affected query, shutdown.
async function coldRun(p) {
  const t0 = process.hrtime.bigint();
  const gitRun = spawnSync(GIT_CHANGES, ["changes", "--base", p.base, "--root", p.repo], {
    encoding: "utf8",
  });
  const tChanges = ms(t0);
  if (gitRun.status !== 0) die(`incremental-git changes failed: ${gitRun.stderr}`);
  const cs = JSON.parse(gitRun.stdout);

  const tEngine0 = process.hrtime.bigint();
  const proc = spawn(ENGINE, ["serve", "--store", p.store, "--root", p.repo], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const sess = new Session(proc);
  await sess.request("hello", { protocol: 1, client: { name: "cold-e2e", version: "0.1.0" } });
  const tHello = ms(tEngine0);

  const tPlan0 = process.hrtime.bigint();
  const plan = await sess.request("affected", {
    changes: cs,
    options: { baseline: p.base, context: CTX, verify: false, policy: "balanced" },
  });
  const tPlan = ms(tPlan0);
  const e2e = ms(t0);
  await sess.close();

  if (plan.error) die(`affected: ${JSON.stringify(plan.error)}`);
  return { e2e, changes: tChanges, spawnHello: tHello, plan: tPlan, plan_result: plan };
}

async function benchTarget(target, runs) {
  const p = await prepare(target);
  const samples = [];
  let last = null;
  for (let i = 0; i < runs; i++) {
    const r = await coldRun(p);
    samples.push(r);
    last = r;
  }
  const got = (last.plan_result.tasks ?? []).map((t) => t.id).sort();
  const expected = p.expected;
  const missing = expected.filter((t) => !got.includes(t));
  const extra = got.filter((t) => !expected.includes(t));
  const med = (f) => median(samples.map(f));
  const result = {
    target: target.name,
    changed_file: p.changed,
    tests: p.tests,
    expected_invalid: expected.length,
    plan_invalid: got.length,
    plan_skipped: last.plan_result.skipped ?? null,
    plan_fallback: last.plan_result.fallback ?? null,
    matches_import_graph: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    cold_e2e_ms: {
      median: med((s) => s.e2e),
      min: Math.min(...samples.map((s) => s.e2e)),
      max: Math.max(...samples.map((s) => s.e2e)),
    },
    changes_ms_median: med((s) => s.changes),
    spawn_hello_ms_median: med((s) => s.spawnHello),
    plan_ms_median: med((s) => s.plan),
    runs,
  };
  rmSync(p.work, { recursive: true, force: true });
  return result;
}

async function main() {
  const runs = Number(process.argv[2] ?? 5);
  if (!Number.isInteger(runs) || runs < 1) die(`invalid runs: ${process.argv[2]}`);
  if (!existsSync(ENGINE)) die(`engine missing at ${ENGINE}: run make build`);
  if (!existsSync(GIT_CHANGES)) die(`git change source missing at ${GIT_CHANGES}: run make build`);

  const results = [];
  for (const t of TARGETS) {
    process.stderr.write(`cold-e2e: ${t.name} ...\n`);
    results.push(await benchTarget(t, runs));
  }

  const out = {
    timestamp: new Date().toISOString(),
    runs,
    engine: "core/dist/incremental serve (new process per run)",
    change_source: "adapters/git/dist/incremental-git changes",
    results,
  };
  writeFileSync(
    join(ROOT, "benchmarks", "results", "cold-e2e.json"),
    JSON.stringify(out, null, 2) + "\n",
  );

  console.log(
    "| Fixture | Tests | Changed file | Expected | Plan | Matches graph | Cold e2e median (min-max) ms | changes | spawn+hello | plan |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(
      `| ${r.target} | ${r.tests} | ${r.changed_file} | ${r.expected_invalid} | ${r.plan_invalid} | ${r.matches_import_graph ? "yes" : "NO"} | ${r.cold_e2e_ms.median.toFixed(1)} (${r.cold_e2e_ms.min.toFixed(1)}-${r.cold_e2e_ms.max.toFixed(1)}) | ${r.changes_ms_median.toFixed(1)} | ${r.spawn_hello_ms_median.toFixed(1)} | ${r.plan_ms_median.toFixed(1)} |`,
    );
  }
  console.log(`\nWrote benchmarks/results/cold-e2e.json`);
}

main().catch((e) => die(e.message));

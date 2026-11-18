#!/usr/bin/env node
// T-07 (issue #39): per-file cold-start benchmark — measurement harness.
//
// Primes a copy of the committed vitest fixture with one full run (13 files,
// worker.test.ts excluded so its worker-thread observation stays clean), then
// measures, wall time, three runs of each kind:
//
//   full     — run --all on a dirty worktree (one vitest spawn per file;
//              the per-file cold start this ticket measures)
//   pool     — run --all with --pool N on the SAME dirty worktree state:
//              N files share one vitest spawn (shared-pool prototype)
//   fast     — no-op run on the clean worktree (T-05 fast path; no engine)
//   shadow   — no-op run with --shadow (full path; engine spawned, store
//              consulted, nothing re-run)
//
// The fixture has no node_modules; the adapter resolves vitest from
// adapters/vitest/node_modules via createRequire, so no install is needed.
//
// NOTE: run on a quiet machine. Load-inflated numbers are invalid (see
// evidence/T07.txt).
//
// Usage: node scripts/t07-bench.mjs [n]   (n = runs per kind, default 3)
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER = path.resolve(here, "..", "adapters", "vitest");
const FIXTURE = path.join(ADAPTER, "fixtures", "repo");
const RUN_JS = path.join(ADAPTER, "dist", "src", "run.js");
const WORKER = "packages/core/test/worker.test.ts";
// SHLVL is the shell nesting counter: every shell spawn increments it, so it
// differs between this harness's shell and the Node child it spawns. The
// adapter tracks it as an env input, which would invalidate every observation
// between runs and defeat the fast-path/shadow no-op measurements. Pin it to
// the child's own view (parent SHLVL + 1, capped at 15 like the shell does)
// so the env is identical across priming and all measured runs.
const RUN_ENV = {
  ...process.env,
  SHLVL: String(Math.min(15, (parseInt(process.env.SHLVL ?? "0", 10) || 0) + 1)),
};

const n = Number(process.argv[2] ?? 3);
// Pool sizes to benchmark for the shared-pool prototype (T-07). 1 == per-file
// baseline (control); 13 == all files in a single spawn (max sharing).
const POOLS = [1, 4, 13];
const dir = mkdtempSync(path.join(os.tmpdir(), "t07-"));
const repo = path.join(dir, "repo");
const store = path.join(dir, "store");
const git = (args) =>
  spawnSync(
    "git",
    ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    {
      encoding: "utf8",
    },
  );
const RUN_ARGS_BASE = ["run", "--root", repo, "--store", store, "--json", "--exclude", WORKER];
const run = (args, env = {}) => {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [RUN_JS, ...RUN_ARGS_BASE, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...RUN_ENV, ...env },
    timeout: 600_000,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};
// The fixture has 13 test files; worker.test.ts is excluded on every run, so
// a full/pool run must execute exactly EXPECTED_FILES files, and a fast/shadow
// run must execute exactly 0.
const EXPECTED_FILES = 13;
const fails = [];
const summary = (label, r, expectRan) => {
  let parsed = null;
  try {
    parsed = JSON.parse(r.out);
  } catch {
    /* not json */
  }
  const results = parsed?.results;
  const ran = Array.isArray(results) ? results.length : (parsed?.selected?.length ?? null);
  const notAdvanced = parsed?.notAdvanced?.length
    ? ` notAdvanced=${JSON.stringify(parsed.notAdvanced)}`
    : "";
  console.log(
    `${label}\t${r.ms.toFixed(0)} ms\texit ${r.status}\tran=${ran}\tadvanced=${parsed?.advanced}${notAdvanced}`,
  );
  // A measured sample is only valid when the run completed its workflow:
  // exit 0 (advanced) and the expected file count. Anything else — a timeout
  // (status null), an unexpected exit code, a missing or short result list —
  // is recorded and aborts the harness with a nonzero exit.
  const ok =
    r.status === 0 &&
    ran !== null &&
    ran === expectRan &&
    (parsed?.advanced ?? false) === true;
  if (!ok) {
    fails.push(`${label}: exit=${r.status} ran=${ran} expected=${expectRan} advanced=${parsed?.advanced}`);
    if (r.status !== 0 || r.err) console.error(`${label} stderr:\n${r.err.slice(-2000)}`);
  }
};
const finish = () => {
  if (fails.length > 0) {
    console.error(`# t07-bench: ${fails.length} failed measurement(s):`);
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
};

console.error(`# t07-bench: dir=${dir}`);
// 1. Prime: fresh repo copy, commit, one full run excluding the worker test.
cpSync(FIXTURE, repo, { recursive: true });
git(["init", "-q", "-b", "main"]);
git(["add", "-A"]);
git(["commit", "-q", "-m", "fixture"]);
{
  const r = run(["--all", "--exclude", WORKER]);
  let parsed = null;
  try {
    parsed = JSON.parse(r.out);
  } catch {
    /* */
  }
  console.log(
    `prime\t${r.ms.toFixed(0)} ms\texit ${r.status}\tadvanced=${parsed?.advanced}\tobserved=${parsed?.observed}`,
  );
  if (r.status !== 0) {
    console.error(r.err.slice(-3000));
    process.exit(1);
  }
}

// 2. Dirty worktree for the full-path measurement: edit a source file.
const probe = path.join(repo, "packages", "core", "src", "util.ts");
const before = readFileSync(probe, "utf8");

// 3. Measure. Each iteration:
//   (a) commit a probe edit so HEAD advances to a new commit;
//   (b) full --all: re-runs every file and re-baselines to the new HEAD;
//   (c) pool[P]: run --all --pool P on the SAME dirty worktree state as (b) —
//       P files share one vitest spawn (shared-pool prototype);
//   (d) fast/shadow no-ops: after (c) the store baseline equals HEAD and the
//       worktree is clean, so the fast path must skip and the shadow full path
//       must run 0 tasks. Measured AFTER the last full run (not after a reset)
//       so the baseline equals HEAD — a `git reset --hard` would leave the
//       baseline ahead of HEAD and the fast path would correctly refuse;
//   (e) reset the edit so the next iteration starts from the same base.
for (let i = 0; i < n; i++) {
  writeFileSync(probe, before + "\n// t07-bench\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", `t07 edit ${i}`]);
  // (b) per-file baseline: every file in its own spawn, re-baselines to HEAD.
  //     --jobs 1 matches the pool runs so the timing comparison isolates the
  //     spawn-sharing effect (one spawn per file vs one spawn per batch), not
  //     the adapter's default fan-out across CPUs (which already parallelizes
  //     per-file runs and swamps the shared-pool benefit).
  const full = run(["--all", "--jobs", "1"]);
  summary(`full[${i}]`, full, EXPECTED_FILES);
  // (c) shared-pool: same dirty state, N files per spawn. Each run re-baselines
  //     to the same HEAD, so the state is identical across pool sizes.
  //     --jobs 1 runs the batches sequentially: concurrent `vitest run` spawns
  //     on the same project race on shared Vite/forks state and flake
  //     (T-07 finding 2). Sequential isolates the timing measurement.
  for (const p of POOLS) {
    if (p === 1) continue; // identical to full; skip to save time
    summary(`pool[${i}](${p})`, run(["--all", "--pool", String(p), "--jobs", "1"]), EXPECTED_FILES);
  }
  // (d) no-op measurements (true no-ops: HEAD == baseline, clean worktree).
  const fast = run([]); // fast path: T-05, no engine
  summary(`fast[${i}]`, fast, 0);
  const shadow = run(["--shadow"]); // full path, engine consulted, 0 re-runs
  summary(`shadow[${i}]`, shadow, 0);
  // (e) restore the pre-edit state for the next iteration.
  git(["reset", "--hard", "-q", "HEAD~1"]);
}
console.log(`# done: ${dir}`);
process.exit(0);
// note: dir left in /tmp for inspection; remove with: rm -rf <dir>

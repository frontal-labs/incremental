#!/usr/bin/env node
// Gate 0 replay (PLAN 12.5, 13.1) on a demo monorepo. Usage:
//   node replay_demo.mjs <repo> <scratch> [engine=core/dist/backplane] [adapter=adapters/vitest/dist/src/run.js]
// For each first-parent commit c_i after the base:
//   - GROUND TRUTH: plain full-suite run at c_i, no recorder, store untouched.
//     Failing files are rerun twice; "fail" only if both reruns fail.
//   - the adapter loop (PLAN 10.4): plan at baseline c_{i-1}, run invalid files
//     under the recorder, advance to c_i.
//   - a commit is evaluated only if ground truth at c_{i-1} was green (12.5 3d).
// Writes bench/results/gate0-demo.json. Thresholds are the plan's (13.1).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , REPO, SCRATCH, ENGINE_ARG, ADAPTER_ARG] = process.argv;
if (!REPO || !SCRATCH) {
  console.error("usage: replay_demo.mjs <repo> <scratch> [engine] [adapter]");
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const graph = path.resolve(here, "../../..");
const ENGINE = path.resolve(ENGINE_ARG ?? path.join(graph, "core/dist/backplane"));
const ADAPTER = path.resolve(ADAPTER_ARG ?? path.join(graph, "adapters/vitest/dist/src/run.js"));
const GITSRC = path.join(graph, "adapters/git/dist/backplane-git");
const STORE = path.join(SCRATCH, "store");
const OUT = path.join(graph, "bench/results/gate0-demo.json");
fs.mkdirSync(SCRATCH, { recursive: true });
fs.rmSync(STORE, { recursive: true, force: true });

const run = (cmd, args, cwd = REPO) => {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ms: performance.now() - t0 };
};
const git = (args) => run("git", ["-C", REPO, ...args]).stdout.trim();
const commits = git(["rev-list", "--first-parent", "--reverse", "HEAD"]).split("\n");
const checkout = (sha) => run("git", ["-C", REPO, "checkout", "-q", "--detach", sha]);

// Plain ground truth: test-file outcomes. Returns { green, failing: [rel], ok }.
function groundTruth(tag) {
  const out = path.join(SCRATCH, `gt-${tag}.json`);
  const r = run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${out}`]);
  const j = JSON.parse(fs.readFileSync(out, "utf8"));
  const rel = (abs) => path.relative(REPO, abs).split(path.sep).join("/");
  const files = j.testResults.map((t) => ({ file: rel(t.name), status: t.status }));
  const failing = files.filter((f) => f.status !== "passed").map((f) => f.file);
  return { green: failing.length === 0 && r.status === 0, failing, files: files.map((f) => f.file), exit: r.status };
}
// Confirms a failing file: it must fail on two reruns to count as a fail.
function confirmFailure(file) {
  const outcomes = [];
  for (let k = 0; k < 2; k++) {
    const out = path.join(SCRATCH, `rerun-${k}.json`);
    run("npx", ["vitest", "run", file, "--reporter=json", `--outputFile=${out}`]);
    const j = JSON.parse(fs.readFileSync(out, "utf8"));
    outcomes.push(j.testResults.every((t) => t.status === "passed") ? "passed" : "failed");
  }
  return outcomes.every((o) => o === "failed") ? "fail" : "flaky";
}
// Files that vitest would select for a change since `since` (the repo's own selection, K4).
function vitestChanged(since) {
  const r = run("npx", ["vitest", "list", "--changed", since, "--json"]);
  try {
    const j = JSON.parse(r.stdout);
    const names = new Set();
    for (const t of Array.isArray(j) ? j : j.tests ?? []) names.add(t.file ?? t.filepath ?? t.name);
    return [...names].filter(Boolean).length;
  } catch {
    return null;
  }
}
// Cold CLI plan on the store (K3): a fresh engine process, context from the last observation.
function coldAffected(base, changesFile, ctxFile) {
  const r = run(ENGINE, ["affected", "--store", STORE, "--root", REPO, "--changes", changesFile, "--baseline", base, "--context", ctxFile]);
  return { ms: r.ms, status: r.status };
}
function lastContext() {
  const log = fs.readFileSync(path.join(STORE, "tg.log"), "utf8").split("\n").filter(Boolean);
  for (let i = log.length - 1; i >= 0; i--) {
    try {
      const rec = JSON.parse(log[i]);
      if (rec.r === "obs") return rec.context;
    } catch { /* partial tail */ }
  }
  throw new Error("no observation in the store");
}
const isSource = (f) => /\/src\//.test(f) && /\.(mjs|ts|js)$/.test(f);
const globalInput = (f) => /(^|\/)(package-lock\.json|package\.json|tsconfig\.json|vitest\.config\.mjs)$/.test(f);

// ---- base -----------------------------------------------------------------
checkout(commits[0]);
const base = groundTruth("base");
if (!base.green) {
  console.error("base commit is not green; no commit can be evaluated");
  process.exit(3);
}
const prime = run("node", [ADAPTER, "run", "--root", REPO, "--store", STORE, "--json"]);
const primeReport = JSON.parse(prime.stdout);
if (!primeReport.advanced) {
  console.error("prime run did not advance", JSON.stringify(primeReport.notAdvanced));
  process.exit(4);
}

const records = [];
let prevGreen = base.green;
for (let i = 1; i < commits.length; i++) {
  const prev = commits[i - 1];
  const cur = commits[i];
  checkout(cur);
  const gt = groundTruth(`c${i}`);
  // Confirm each failing file on two reruns.
  const confirmed = {};
  for (const f of gt.failing) confirmed[f] = confirmFailure(f);

  const changedFiles = git(["diff", "--name-only", prev, cur]).split("\n").filter(Boolean);
  const rec = {
    index: i, commit: cur, prev, changedFiles,
    sourceFilesChanged: changedFiles.filter(isSource).length,
    globalInput: changedFiles.some(globalInput),
    evaluated: prevGreen,
    gtGreen: gt.green,
    gtFailing: gt.failing,
    gtConfirmed: confirmed,
  };
  // The adapter loop at c_i: plan against baseline c_{i-1}, run, advance.
  const r = run("node", [ADAPTER, "run", "--root", REPO, "--store", STORE, "--json"]);
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { report = null; }
  rec.adapterExit = r.status;
  rec.advanced = report ? report.advanced : false;
  rec.notAdvanced = report ? report.notAdvanced : ["no report"];
  rec.total = report?.plan?.total_tasks ?? gt.files.length;
  rec.invalid = (report?.plan?.tasks ?? []).map((t) => t.id);
  rec.fallback = report?.plan?.fallback ?? null;
  rec.skipShare = rec.total ? (rec.total - rec.invalid.length) / rec.total : null;
  // K2: false skips. Confirmed failures the plan did not invalidate.
  rec.falseSkips = Object.entries(confirmed).filter(([f, o]) => o === "fail" && !rec.invalid.includes(f)).map(([f]) => f);
  rec.flaky = Object.entries(confirmed).filter(([, o]) => o === "flaky").map(([f]) => f);
  // K4: the repo's own selection for the same change.
  rec.vitestChangedFiles = vitestChanged(prev);
  rec.vitestChangedSkipShare = rec.vitestChangedFiles != null && rec.total
    ? (rec.total - rec.vitestChangedFiles) / rec.total : null;
  // K3: cold CLI plan. The ChangeSet is from git; the context is the store's.
  const cs = run(GITSRC, ["changes", "--base", prev, "--root", REPO]);
  const csFile = path.join(SCRATCH, "cs.json");
  fs.writeFileSync(csFile, cs.stdout);
  const ctxFile = path.join(SCRATCH, "ctx.json");
  fs.writeFileSync(ctxFile, JSON.stringify(lastContext()));
  rec.coldAffectedMs = coldAffected(prev, csFile, ctxFile).ms;
  records.push(rec);
  prevGreen = gt.green;
  console.error(`c${i} ${cur.slice(0, 8)} gt=${gt.green ? "green" : "red"} eval=${rec.evaluated} invalid=${rec.invalid.length}/${rec.total} adv=${rec.advanced}`);
}
git(["checkout", "-q", "--detach", commits[commits.length - 1]]);

// ---- metrics ---------------------------------------------------------------
const evaluated = records.filter((r) => r.evaluated && r.advanced);
const typical = evaluated.filter((r) => r.sourceFilesChanged <= 5 && !r.globalInput);
const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const K1 = median(typical.map((r) => r.skipShare));
const falseSkipCount = evaluated.reduce((n, r) => n + r.falseSkips.length, 0);
const pairs = evaluated.reduce((n, r) => n + r.total, 0);
const K2 = { falseSkips: falseSkipCount, evaluatedCommits: evaluated.length, taskCommitPairs: pairs, bound95Commits: evaluated.length ? 3 / evaluated.length : null };
const K3 = { medianMs: median(evaluated.map((r) => r.coldAffectedMs)), thresholdMs: 1000 };
const K4 = {
  medianEngineSkip: K1,
  medianVitestChangedSkip: median(typical.map((r) => r.vitestChangedSkipShare)),
};
K4.gainPp = K4.medianEngineSkip != null && K4.medianVitestChangedSkip != null
  ? (K4.medianEngineSkip - K4.medianVitestChangedSkip) * 100 : null;
const decision = evaluated.length >= 50 && K1 != null && K1 >= 0.3 && falseSkipCount === 0 && K3.medianMs < 1000 && K4.gainPp != null && K4.gainPp >= 10
  ? "CONTINUE" : "STOP";
const result = {
  kind: "demo",
  note: "Synthetic demo repository built by bench/gate0/demo/make_demo.mjs. This validates the harness, not a real repository.",
  repo: REPO, commits: commits.length, engine: ENGINE, adapter: ADAPTER,
  primeFiles: primeReport.plan?.total_tasks,
  evaluated: evaluated.length, typicalEvaluated: typical.length,
  K1: { medianSkipShare: K1, thresholdAtLeast: 0.3 },
  K2, K3, K4, decision, records,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ evaluated: evaluated.length, typical: typical.length, K1, K2: { falseSkips: falseSkipCount, bound: K2.bound95Commits }, K3: K3.medianMs, K4: K4.gainPp, decision }, null, 2));

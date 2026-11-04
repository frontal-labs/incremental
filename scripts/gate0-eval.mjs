#!/usr/bin/env node
// Gate 0 evaluator (PLAN 13.1, GATE 0).
//
// Computes K1 to K4 from Gate 0 replay records (bench/gate0/driver/replay.mjs
// output in <scratch>/out) and writes `GATE.md` with the Gate 0 table.
// Falls back to the committed raw data `bench/results/gate0.json` when no
// replay records are available. A STOP decision is a valid outcome (PLAN 13.1)
// and is not treated as a target failure; this script exits 0 when it produces
// the table.
//
//   node scripts/gate0-eval.mjs /tmp/gate0-scratch/out > GATE.md
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FALLBACK = path.join(ROOT, "bench", "results", "gate0.json");
const OUT = process.argv[2];

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function loadRecords(outDir) {
  if (!outDir || !existsSync(outDir)) return null;
  const files = readdirSync(outDir).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  if (!files.length) return null;
  return files.map((f) => JSON.parse(readFileSync(path.join(outDir, f), "utf8")));
}

function loadFallback() {
  if (!existsSync(FALLBACK)) return null;
  try { return JSON.parse(readFileSync(FALLBACK, "utf8")); } catch { return null; }
}

function main() {
  const records = loadRecords(OUT);
  const fallback = loadFallback();
  const rows = [];
  let decision = "STOP";
  let basis = "";

  if (records && records.length) {
    // Recompute from raw replay records.
    const evaluated = records.filter((r) => r.evaluated === true);
    const typical = evaluated.filter((r) => r.typical === true);
    const skipShares = typical.filter((r) => typeof r.engine_skip_share === "number").map((r) => r.engine_skip_share);
    const k1Median = median(skipShares);
    const k1Pass = k1Median != null && k1Median >= 0.30;
    const falseSkips = evaluated.flatMap((r) => r.false_skips || []);
    const n = evaluated.length;
    const bound = n > 0 ? `3/${n}` : "n/a";
    const k2Pass = n >= 50 && falseSkips.length === 0;
    const cold = records.filter((r) => r.cold && r.cold.ok).map((r) => r.cold.median_ms).filter((x) => x != null);
    const k3Median = median(cold);
    const k3Pass = k3Median != null && k3Median < 1000;
    const k4 = typical.filter((r) => r.related && typeof r.related.skip_share === "number").map((r) => r.related.skip_share);
    const k4Median = median(k4);
    const k4Pass = k4Median != null && k4Median >= 0.10;
    decision = k1Pass && k2Pass && k3Pass && k4Pass ? "CONTINUE" : "STOP";
    rows.push(["K1", `median skip share ${(k1Median * 100).toFixed(1)}% over ${skipShares.length} typical evaluated commits`, ">= 30%", k1Pass ? "pass" : "fail", "bench/gate0 replay records"]);
    rows.push(["K2", `${falseSkips.length} false skips over ${n} evaluated commits; rule-of-three bound ${bound}`, "zero observed over >= 50 evaluated commits", k2Pass ? "pass" : "fail", "bench/gate0 replay records"]);
    rows.push(["K3", `cold CLI plan median ${k3Median == null ? "n/a" : k3Median.toFixed(0)} ms over ${cold.length} commits`, "< 1 s", k3Pass ? "pass" : "fail", "bench/gate0 replay records"]);
    rows.push(["K4", `engine skip gain over vitest related: median ${(k4Median * 100).toFixed(1)} pp over ${k4.length} typical commits`, ">= 10 pp", k4Pass ? "pass" : "fail", "bench/gate0 replay records"]);
    basis = `Recomputed from ${records.length} Gate 0 replay records (${n} evaluated commits).`;
  } else if (fallback) {
    const m = fallback.metrics || {};
    const k1 = m.K1 || {}; const k2 = m.K2 || {}; const k3 = m.K3 || {}; const k4 = m.K4 || {};
    const k1Pass = k1.result && k1.result.includes("pass");
    const k2Pass = k2.result && k2.result.includes("pass") && (k2.n_evaluated_commits || 0) >= 50;
    const k3Pass = k3.result && k3.result.includes("pass");
    const k4Pass = k4.result && k4.result.includes("pass");
    decision = k1Pass && k2Pass && k3Pass && k4Pass ? "CONTINUE" : "STOP";
    rows.push(["K1", k1.value == null ? "not measured (0 evaluated commits)" : String(k1.value), ">= 30%", k1Pass ? "pass" : "fail", "benchmarks/results/gate0.json"]);
    rows.push(["K2", `n/a (${k2.n_evaluated_commits || 0} evaluated commits); bound ${k2.rule_of_three_bound == null ? "n/a" : k2.rule_of_three_bound}`, "zero observed", k2Pass ? "pass" : "fail", "benchmarks/results/gate0.json"]);
    rows.push(["K3", k3.median_ms == null ? "not measured per commit" : `${k3.median_ms} ms`, "< 1 s", k3Pass ? "pass" : "fail", "benchmarks/results/gate0.json"]);
    rows.push(["K4", k4.value == null ? "not measured (0 evaluated commits)" : String(k4.value), "engine >= 10 pp more than vitest related", k4Pass ? "pass" : "fail", "benchmarks/results/gate0.json"]);
    basis = fallback.decision_basis || "Committed Gate 0 raw data (bench/results/gate0.json). Replay not completed; fewer than 50 evaluated commits.";
  } else {
    rows.push(["K1", "no raw results", ">= 30%", "fail", "—"]);
    rows.push(["K2", "no raw results", "zero observed", "fail", "—"]);
    rows.push(["K3", "no raw results", "< 1 s", "fail", "—"]);
    rows.push(["K4", "no raw results", ">= 10 pp", "fail", "—"]);
    basis = "No Gate 0 replay records and no committed raw data found.";
  }

  const now = new Date().toISOString();
  const md = [
    "# GATE.md: Gate 0 (PLAN 13.1, GATE 0)",
    "",
    `Generated: ${now}`,
    "",
    "## Gate 0 table (PLAN 17.2 format)",
    "",
    "| Criterion | Measured | Threshold | Result | Raw data |",
    "|-----------|----------|-----------|--------|----------|",
  ];
  for (const r of rows) md.push(`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} |`);
  md.push("", `Decision: **${decision}**`, "", basis, "", "Recommendation: " + (decision === "CONTINUE" ? "proceed to E5/E6" : "the gate cannot be evaluated here; report STOP per PLAN 13.1 and 14.1."));
  writeFileSync(path.join(ROOT, "GATE.md"), md.join("\n") + "\n");
  console.log(`Gate 0: decision ${decision}. ${basis}`);
}

main();

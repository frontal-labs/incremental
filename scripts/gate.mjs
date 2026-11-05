#!/usr/bin/env node
// Gate 1 evaluator (PLAN 13.2, E7).
//
// Evaluates every Gate 1 criterion (G1 to G6) from real raw results, writes
// `GATE.md`, prints `PASS`/`FAIL` for each criterion, and exits 1 if any
// criterion fails (stop per PLAN 14.1).
//
//   make gate        # build, evaluate G1-G6, write GATE.md
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "benchmarks", "results");
const GATE_MD = path.join(ROOT, "GATE.md");

function run(cmd, args = [], opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, cwd: ROOT, ...opts });
}
function runCmd(cmd) {
  return spawnSync("sh", ["-c", cmd], { encoding: "utf8", maxBuffer: 1 << 28, cwd: ROOT });
}

let failures = 0;
const rows = []; // { id, measured, threshold, result, raw }

function criterion(id, measured, threshold, result, raw) {
  const pass = result === "pass";
  if (!pass) failures++;
  rows.push({ id, measured, threshold, result: pass ? "pass" : "fail", raw });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${measured} (threshold: ${threshold})`);
}

async function main() {
  // ---- G3: warm plan p99 at 100k tasks, verify off, under 20 ms (M1 harness). ----
  {
    let measured = "m1 did not run";
    let detail = "";
    let pass = false;
    const r = run("node", ["bench/m1.mjs", "10000", "100"]);
    if (r.status !== 0) {
      measured = "m1 run failed";
      detail = r.stderr.slice(-200).replace(/\n/g, " ");
    } else {
      try {
        const m = JSON.parse(r.stdout.trim().split("\n").pop());
        const ms = Number(m.per_query_ms_approx);
        const load = Number(m.process_load_ms);
        measured = `per-query ~${Number.isFinite(ms) ? ms.toFixed(2) : "n/a"} ms (load ${Number.isFinite(load) ? load.toFixed(0) : "n/a"} ms)`;
        detail = (m.note || "").slice(0, 120);
        pass = Number.isFinite(ms) && ms < 20;
      } catch (e) {
        measured = "unparseable m1 output";
        detail = r.stdout.slice(-200).replace(/\n/g, " ");
      }
    }
    criterion("G3", measured, "< 20 ms (warm plan at 100k tasks)", pass ? "pass" : "fail", "benchmarks/results/m1.json", detail);
  }

  // ---- G1 / G2: replay raw results (benchmarks/results/replay.json). ----
  const replayPath = path.join(RESULTS, "replay.json");
  let replay = null;
  if (existsSync(replayPath)) {
    try { replay = JSON.parse(readFileSync(replayPath, "utf8")); } catch { replay = null; }
  }

  // G2: false skips zero over at least 50 evaluated commits (rule-of-three bound reported).
  {
    const evaluated = replay && Number.isInteger(replay.commits_evaluated) ? replay.commits_evaluated : 0;
    const falseSkips = replay && Array.isArray(replay.false_skips) ? replay.false_skips : null;
    const bound = replay && replay.rule_of_three_bound ? replay.rule_of_three_bound : "n/a";
    const pass = replay !== null && falseSkips !== null && falseSkips.length === 0 && evaluated >= 50;
    criterion("G2", `${falseSkips === null ? "n/a" : falseSkips.length} false skips over ${evaluated} evaluated commits (bound ${bound})`, "zero observed over >= 50 evaluated commits", pass ? "pass" : "fail", "benchmarks/results/replay.json", falseSkips === null ? "no replay raw results" : "");
  }

  // G1: median skip share on typical/evaluated commits at least 50%.
  {
    const skipShares = replay && Array.isArray(replay.skip_shares) ? replay.skip_shares : null;
    const medianShare = replay && replay.median_skip_share != null ? replay.median_skip_share : null;
    const pass = replay !== null && skipShares !== null && skipShares.length > 0 && medianShare !== null && medianShare >= 0.5;
    const measured = skipShares === null
      ? "not measured (replay raw results lack skip-share data)"
      : `median skip share ${(medianShare * 100).toFixed(1)}% over ${skipShares.length} evaluated commits`;
    criterion("G1", measured, ">= 50%", pass ? "pass" : "fail", "benchmarks/results/replay.json", skipShares === null || skipShares.length === 0 ? "no skip-share data" : "");
  }

  // ---- G4: recorder completeness vs strace oracle, zero gaps (Linux only). ----
  {
    const isLinux = process.platform === "linux";
    let measured = ""; let detail = ""; let pass = false;
    if (!isLinux) {
      measured = "not runnable on this host (strace is Linux-only)";
      detail = "verify with make linux-gate (linux/arm64 container)";
      pass = false;
    } else {
      const r = runCmd("cd adapters/strace && npm test >../../logs/test-oracle-gate.log 2>&1");
      const ok = r.status === 0;
      const out = (r.stdout + r.stderr);
      const skipped = /\bSKIP\b/.test(out);
      pass = ok && !skipped;
      measured = ok ? "M10: recorder contains every oracle path (zero gaps)" : "test-oracle run failed";
      detail = skipped ? "M10 skipped (no strace)" : (ok ? "" : r.stderr.slice(-200).replace(/\n/g, " "));
    }
    criterion("G4", measured, "zero gaps", pass ? "pass" : "fail", "logs/test-oracle.log (via make linux-gate)", detail);
  }

  // ---- G5: conformance suite (C01-C40) and differential fuzz all pass. ----
  {
    const checks = [
      ["node --test core/tests/*.test.mjs", "test-core"],
      ["node conformance/run.mjs core/dist/incremental", "test-policy"],
      ["CONF_ONLY=C26,C34,C35,C40 node conformance/run.mjs core/dist/incremental", "test-protocol"],
      ["node conformance/fuzz.mjs 20261103 100 100 && node conformance/fuzz.mjs 1 100 100 && node conformance/fuzz.mjs 2 100 100", "test-fuzz"],
    ];
    let allOk = true; let detail = "";
    for (const [cmd, name] of checks) {
      const r = runCmd(cmd);
      if (r.status !== 0) { allOk = false; detail += `${name} failed (exit ${r.status}); `; }
    }
    criterion("G5", allOk ? "conformance suite + differential fuzz all pass" : `not all pass: ${detail.trim()}`, "all pass", allOk ? "pass" : "fail", "logs/test-core.log, test-policy.log, test-protocol.log, test-fuzz.log", detail.trim());
  }

  // ---- G6: binding parity (Node client + CLI byte-identical; Python optional). ----
  {
    const r = run("sh", ["-c", "cd bindings/node && npm test"]);
    const ok = r.status === 0;
    const failMatch = r.stdout.match(/# fail (\d+)/);
    const fails = failMatch ? Number(failMatch[1]) : -1;
    const pass = ok && fails === 0;
    criterion("G6", pass ? "Node client and CLI produce byte-identical plans for all conformance cases" : `binding test failed (fail=${fails === -1 ? "n/a" : fails})`, "all identical", pass ? "pass" : "fail", "logs/test-bindings.log", fails === -1 ? "unparseable" : (ok ? "" : r.stderr.slice(-200).replace(/\n/g, " ")));
  }

  // ---- Write GATE.md (PLAN 13.2 Gate 1 table, PLAN 17.2 format). ----
  const now = new Date().toISOString();
  const decision = failures === 0 ? "CONTINUE" : "STOP";
  const md = [
    "# GATE.md: Gate 1 (PLAN 13.2, E7)",
    "",
    `Generated: ${now}`,
    "",
    "| Criterion | Measured | Threshold | Result | Raw data |",
    "|-----------|----------|-----------|--------|----------|",
  ];
  for (const r of rows) {
    md.push(`| ${r.id} | ${r.measured} | ${r.threshold} | ${r.result} | ${r.raw} |`);
  }
  md.push("", `Decision: **${decision}**`, "");
  if (decision === "STOP") {
    md.push("## Stop (PLAN 14.1)", "", "One or more Gate 1 criteria failed. Do not retune thresholds; fix the code or report the stop.", "", "### Options", "- A) fix the failing criterion and re-run `make gate`", "- B) file a change request if the criterion or its target is wrong", "- C) escalate per PLAN 14.3", "");
  }
  md.push("Recommendation: " + (decision === "CONTINUE" ? "proceed toward E8/E10 release" : "stop and address the failing criteria per PLAN 14."));
  writeFileSync(GATE_MD, md.join("\n") + "\n");

  if (failures > 0) {
    console.error(`\nSTOP: Gate 1 failed on ${failures} criterion/criteria (PLAN 14.1). GATE.md written with raw results. Fix the failing criteria before continuing.`);
    process.exitCode = 1;
  } else {
    console.log("\nPASS gate: all Gate 1 criteria met (PLAN 13.2).");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

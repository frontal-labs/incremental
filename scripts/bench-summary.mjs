#!/usr/bin/env node
// Generates benchmarks/results/RESULTS.md from the raw benchmark outputs
// (PLAN 12.7: results go to benchmarks/results/*.json and a generated RESULTS.md).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "benchmarks", "results");

function load(name) {
  const p = path.join(RESULTS, name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function ms(x) { return x == null ? "n/a" : x.toString(); }

function main() {
  const replay = load("replay.json");
  const m1 = load("m1.json");
  const now = new Date().toISOString();
  const lines = [
    "# Benchmark results (PLAN 12.4 / 12.5)",
    "",
    `Generated: ${now}`,
    "",
    "## Raw data",
    "",
    `- benchmarks/results/replay.json: ${replay ? "present" : "missing"}`,
    `- benchmarks/results/m1.json: ${m1 ? "present" : "missing"}`,
    "",
    "## Replay (PLAN 12.5, E6)",
    "",
  ];
  if (replay) {
    lines.push(
      `| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |`,
      `| ${replay.commits_processed ?? "-"} | ${replay.commits_evaluated ?? "-"} | ${replay.total_tasks ?? "-"} | ${replay.task_commit_pairs_examined ?? "-"} | ${(replay.false_skips ?? []).length} | ${replay.rule_of_three_bound ?? "-"} |`,
      "",
      `| median_skip_share | skip_shares |`,
      `| ${replay.median_skip_share == null ? "n/a" : (replay.median_skip_share * 100).toFixed(2) + "%"} | ${JSON.stringify(replay.skip_shares ?? [])} |`,
      "",
    );
  }
  lines.push("## M1 warm plan latency (PLAN 12.4)", "");
  if (m1) {
    lines.push(
      `| tasks | queries | process_load_ms | per_query_ms_approx | log_bytes |`,
      `| ${m1.tasks ?? "-"} | ${m1.queries ?? "-"} | ${ms(m1.process_load_ms)} | ${ms(m1.per_query_ms_approx)} | ${ms(m1.log_bytes)} |`,
      "",
      `_Note: ${m1.note || ""}_`,
      "",
    );
  }
  lines.push("## Thresholds (PLAN 12.4)", "", "- M1: p50 under 5 ms, p99 under 20 ms at 100k tasks. - M2: cold CLI under 300 ms at 100k tasks (hyperfine).", "");
  writeFileSync(path.join(RESULTS, "RESULTS.md"), lines.join("\n") + "\n");
  console.log("wrote benchmarks/results/RESULTS.md");
}

main();

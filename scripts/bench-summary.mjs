#!/usr/bin/env node
// Generates benchmarks/results/RESULTS.md from the raw benchmark outputs
// (results go to benchmarks/results/*.json and a generated RESULTS.md).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "benchmarks", "results");

function load(name) {
  const p = path.join(RESULTS, name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function ms(x) {
  return x == null ? "n/a" : x.toString();
}

function msMedian(obj) {
  return obj && obj.median != null ? obj.median.toFixed(3) : "n/a";
}

function range(obj) {
  return obj && obj.min != null && obj.max != null
    ? `${obj.min.toFixed(3)}–${obj.max.toFixed(3)}`
    : "n/a";
}

function main() {
  const replay = load("replay.json");
  const warmPlan = load("warm-plan.json");
  const comparison = load("comparison.json");
  const now = new Date().toISOString();
  const lines = [
    "# Benchmark results",
    "",
    `Generated: ${now}`,
    "",
    "## Raw data",
    "",
    `- benchmarks/results/replay.json: ${replay ? "present" : "missing"}`,
    `- benchmarks/results/warm-plan.json: ${warmPlan ? "present" : "missing"}`,
    `- benchmarks/results/comparison.json: ${comparison ? "present" : "missing"}`,
    "",
    "## Replay",
    "",
  ];
  if (replay) {
    lines.push(
      `| commits_processed | commits_evaluated | total_tasks | task_commit_pairs_examined | false_skips | rule_of_three_bound |`,
      `|---|---|---|---|---|---|`,
      `| ${replay.commits_processed ?? "-"} | ${replay.commits_evaluated ?? "-"} | ${replay.total_tasks ?? "-"} | ${replay.task_commit_pairs_examined ?? "-"} | ${(replay.false_skips ?? []).length} | ${replay.rule_of_three_bound ?? "-"} |`,
      "",
      `| median_skip_share | skip_shares |`,
      `|---|---|`,
      `| ${replay.median_skip_share == null ? "n/a" : (replay.median_skip_share * 100).toFixed(2) + "%"} | ${JSON.stringify(replay.skip_shares ?? [])} |`,
      "",
    );
  }
  lines.push("## Warm plan latency", "");
  if (warmPlan) {
    lines.push(
      `| tasks | queries | iterations | process_load_ms (median) | per_query_ms (median) | per_query_ms (min–max) | log_bytes |`,
      `|---|---|---|---|---|---|---|`,
      `| ${warmPlan.tasks ?? "-"} | ${warmPlan.queries ?? "-"} | ${warmPlan.iterations ?? "-"} | ${msMedian(warmPlan.process_load_ms)} | ${msMedian(warmPlan.per_query_ms)} | ${range(warmPlan.per_query_ms)} | ${ms(warmPlan.log_bytes)} |`,
      "",
      `_Note: ${warmPlan.note || ""}_`,
      "",
    );
  }
  lines.push("## Comparison vs alternatives", "");
  lines.push(
    "Measured on three dedicated monorepo fixtures under `monorepos/`. Each fixture has 4 packages",
    "with a `shared → api/web` dependency graph (`utils` standalone), 8 vitest tests, and git history.",
    "The change at HEAD is `packages/shared/src/index.ts`, so the expected affected set is shared, api, web.",
    "",
    "| Tool | Detect time | Projects/tasks found | Correct set? | Monorepo |",
    "|---|---|---|---|---|",
  );
  if (comparison) {
    const inc = comparison.incremental;
    const incMs = inc.per_query_ms ?? 0;
    lines.push(
      `| **Incremental** | **${incMs.toFixed(3)} ms/query** | per-task invalidation | n/a (synthetic store) | native (synthetic store) |`,
    );
    // Expected affected set when packages/shared/src/index.ts changes (see monorepos/README.md).
    const EXPECTED = ["api", "shared", "web"];
    const sameSet = (found) =>
      JSON.stringify([...found].sort()) === JSON.stringify(EXPECTED) ? "Yes" : "No";
    if (comparison.nx) {
      const nx = comparison.nx;
      const found = nx.projects ?? [];
      lines.push(
        `| **Nx** | ${(nx.affected_detect_ms ?? 0).toFixed(0)} ms detect | ${found.length} projects | ${sameSet(found)} | monorepos/nx/ |`,
      );
    }
    if (comparison.turbo) {
      const tb = comparison.turbo;
      const tbFound = tb.tasks_found ?? 0;
      // Turbo reports build tasks, one per package in the affected set.
      lines.push(
        `| **Turbo** | ${(tb.affected_detect_ms ?? 0).toFixed(0)} ms detect | ${tbFound} tasks (\`--filter=...[HEAD~1]\`) | ${tbFound === EXPECTED.length ? "Yes" : "No"} | monorepos/turborepo/ |`,
      );
    }
    if (comparison.bazel) {
      const bz = comparison.bazel;
      const labels = (bz.targets ?? []).map((t) =>
        t.replace(/^\/\/packages\//, "").replace(/:.*$/, ""),
      );
      lines.push(
        `| **Bazel** | ${(bz.affected_detect_ms ?? 0).toFixed(0)} ms rdeps query | ${bz.targets?.length ?? 0} targets | ${sameSet(labels)} | monorepos/bazel/ |`,
      );
    }
    lines.push(
      "",
      "Not like-for-like: the Incremental figure is a warm query against a 10,000-task synthetic store",
      "(`benchmarks/warm-plan.mjs`). The Nx, Turbo and Bazel figures are each one affected-detection run",
      "against a 4-package fixture, with a cold tool process. Do not read any ratio between these rows as a speedup.",
      "",
    );
  }
  lines.push(
    "## Thresholds",
    "",
    "- Warm plan target: p50 under 5 ms and p99 under 20 ms at 100k tasks.",
    "- Cold CLI plan target: under 300 ms at 100k tasks (hyperfine).",
    "- Measured so far: warm plan at 10k tasks only. The 100k-task targets are not measured.",
    "",
  );
  writeFileSync(path.join(RESULTS, "RESULTS.md"), lines.join("\n") + "\n");
  console.log("wrote benchmarks/results/RESULTS.md");
}

main();

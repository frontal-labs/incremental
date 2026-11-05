#!/usr/bin/env node
// Replay driver: replays a sequence of commits through the engine and measures
// false skips against ground truth, using the real adapter (git change source
// + @incremental/client over core/dist/incremental serve + incremental-vitest
// run) plus plain vitest runs for ground truth.
//
//   commits_processed        commits walked, oldest -> newest
//   commits_evaluated        commits whose predecessor's ground truth was green
//   task_commit_pairs_examined (task, commit) pairs compared vs ground truth
//   false_skips              task fails in ground truth, is not invalidated,
//                             and fails again on two reruns
//   rule_of_three_bound      3 / commits_evaluated
//
// Report is written to --out (default benchmarks/results/replay.json) and
// printed to stdout.
//
// Entry point. Orchestration lives here; see ./cli.ts, ./git.ts, ./edits.ts,
// ./vitest.ts, ./report.ts, ./paths.ts, ./types.ts.

import { cpSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { connect } from "@incremental/client";

import { EDIT_SEQUENCE, applyEdit } from "./edits.js";
import { ENGINE, FIXTURE, ROOT } from "./paths.js";
import { groundTruth, runOnce, runRecorded } from "./vitest.js";
import { git, headOf } from "./git.js";
import { buildReport, writeReport } from "./report.js";
import { parseArgs } from "./cli.js";
import type { FalseSkip, Flaky } from "./types.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const commitsN = args.commits ?? EDIT_SEQUENCE.length;
  const work = mkdtempSync(path.join(os.tmpdir(), "bp-replay-"));
  const repo = path.join(work, "repo");
  const store = args.store ?? path.join(work, "store");
  cpSync(args.repo ?? FIXTURE, repo, { recursive: true, verbatimSymlinks: true });

  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["add", "-A"]);
  // --allow-empty: a fixture whose working tree is already clean (its own .git was copied
  // above) has nothing to commit. Without it the replay fails on such a fixture.
  git(repo, ["commit", "-q", "--allow-empty", "-m", "fixture base"]);

  const initStore = spawnSync(ENGINE, ["init", "--store", store], { encoding: "utf8" });
  if (initStore.status !== 0) throw new Error(`engine init failed: ${initStore.stderr}`);

  const client = await connect({
    store,
    root: repo,
    command: [ENGINE, "serve"],
    timeoutMs: 60_000,
  });
  try {
    const walked: Array<{ index: number; id: string }> = [];
    let current = headOf(repo);
    walked.push({ index: 0, id: current });

    let commitsEvaluated = 0;
    let taskCommitPairs = 0;
    const falseSkips: FalseSkip[] = [];
    const flaky: Flaky[] = [];
    let total_tasks = 0;
    let prevAllPassed = true;
    const skipShares: number[] = [];

    // c0: take ground truth, then prime the store (no baseline -> fallback
    // runs every task) and advance to c0.
    let gt = groundTruth(repo);
    const prime = runRecorded(repo, store);
    total_tasks = prime.total_tasks || gt.results.length;
    prevAllPassed = gt.allPassed;

    for (let i = 1; i <= commitsN; i++) {
      applyEdit(repo, EDIT_SEQUENCE[(i - 1) % EDIT_SEQUENCE.length]!);
      const id = headOf(repo);
      walked.push({ index: i, id });

      gt = groundTruth(repo); // ground truth at c_i; the store is untouched
      const evaluated = prevAllPassed;
      if (evaluated) {
        commitsEvaluated++;
        taskCommitPairs += total_tasks;
      }

      const run = runRecorded(repo, store); // plan from c_{i-1}, run invalid tasks w/ recorder, advance to c_i
      const plan = run.plan;
      if (evaluated && run.discovered) {
        // Skip share for this evaluated commit: share of discovered tasks the plan would skip.
        skipShares.push(run.discovered.length ? run.wouldSkip.length / run.discovered.length : 0);
      }
      const invalid = new Set<string>((plan?.tasks ?? []).map((t) => t.id));
      const reasonsById = new Map<string, string[]>(
        (plan?.tasks ?? []).map((t) => [t.id, t.reasons ?? []]),
      );

      if (evaluated && plan !== null) {
        for (const t of gt.results) {
          // invalidated by the plan: not a skip
          if (t.outcome === "fail" && !invalid.has(t.task)) {
            // Candidate false skip: failing in ground truth and not invalidated.
            const r1 = runOnce(repo, t.task);
            const r2 = runOnce(repo, t.task);
            if (r1 === "fail" && r2 === "fail") {
              falseSkips.push({
                commit: id,
                task: t.task,
                query: [...reasonsById.entries()].map(([tid, reasons]) => ({ id: tid, reasons })),
              });
            } else {
              flaky.push({ commit: id, task: t.task });
            }
          }
        }
      }

      current = id;
      prevAllPassed = gt.allPassed;
    }

    const report = buildReport({
      engine: ENGINE,
      repo,
      commits: walked,
      commitsEvaluated,
      totalTasks: total_tasks,
      taskCommitPairs,
      falseSkips,
      flaky,
      skipShares,
    });
    const out = args.out ?? path.join(ROOT, "benchmarks", "results", "replay.json");
    writeReport(report, out);
  } finally {
    await client.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? String(e)) : String(e));
  process.exit(1);
});

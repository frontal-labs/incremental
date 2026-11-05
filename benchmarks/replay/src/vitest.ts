import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { VITEST_BIN, VITEST_RUN } from "./paths.js";
import type { GtResult, RunReport } from "./types.js";

// Ground truth at the current worktree state: a plain vitest run with no
// recorder, so it never touches the store.
export function groundTruth(repo: string): { results: GtResult[]; allPassed: boolean } {
  const repoReal = realpathSync(repo);
  const dir = mkdtempSync(path.join(os.tmpdir(), "bp-replay-gt-"));
  const report = path.join(dir, "report.json");
  const r = spawnSync(
    process.execPath,
    [
      VITEST_BIN,
      "run",
      "--root",
      repo,
      "--pool=forks",
      "--reporter=json",
      `--outputFile=${report}`,
    ],
    { encoding: "utf8", timeout: 900_000 },
  );
  if (r.error !== undefined)
    throw new Error(`ground-truth vitest failed to start: ${r.error.message}`);
  // vitest exits non-zero when tests fail: that is ground-truth data, not a harness error.
  const json = JSON.parse(readFileSync(report, "utf8")) as {
    testResults?: Array<{ name: string; status: string }>;
  };
  const results: GtResult[] = [];
  for (const tr of json.testResults ?? []) {
    const rel = path.relative(repoReal, realpathSync(tr.name)).split(path.sep).join("/");
    results.push({ task: rel, outcome: tr.status === "passed" ? "pass" : "fail" });
  }
  results.sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));
  return { results, allPassed: results.every((t) => t.outcome === "pass") };
}

// Re-run one test file twice (plain vitest, no recorder) to confirm a
// suspected false skip.
export function runOnce(repo: string, task: string): "pass" | "fail" | "error" {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bp-replay-rerun-"));
  const report = path.join(dir, "report.json");
  const r = spawnSync(
    process.execPath,
    [
      VITEST_BIN,
      "run",
      task,
      "--root",
      repo,
      "--pool=forks",
      "--reporter=json",
      `--outputFile=${report}`,
    ],
    { cwd: repo, encoding: "utf8", timeout: 300_000 },
  );
  if (r.error !== undefined) return "error";
  try {
    const json = JSON.parse(readFileSync(report, "utf8")) as {
      testResults?: Array<{ status?: string }>;
    };
    const status = json.testResults?.[0]?.status;
    return status === "passed" ? "pass" : status === "failed" ? "fail" : "error";
  } catch {
    return "error";
  }
}

// One adapter loop iteration at the current worktree state: plan from the
// store baseline, run the invalid tasks with the recorder, observe, advance.
// Returns the report the adapter CLI emits with --json.
export function runRecorded(repo: string, store: string): RunReport {
  const r = spawnSync(
    process.execPath,
    [VITEST_RUN, "run", "--root", repo, "--store", store, "--json", "--jobs", "2"],
    {
      cwd: repo,
      encoding: "utf8",
      timeout: 900_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  if (r.status !== 0 && r.status !== 1 && r.status !== 7)
    throw new Error(`incremental-vitest run failed (exit ${r.status}): ${r.stderr.slice(-1000)}`);
  const parsed = JSON.parse(r.stdout) as RunReport & { total_tasks?: number };
  return {
    plan: parsed.plan ?? null,
    results: parsed.results ?? [],
    advanced: Boolean(parsed.advanced),
    exit: r.status ?? -1,
    total_tasks: parsed.total_tasks ?? 0,
    discovered: parsed.discovered ?? [],
    wouldSkip: parsed.wouldSkip ?? [],
    selected: parsed.selected ?? [],
  };
}

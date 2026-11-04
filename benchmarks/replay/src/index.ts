#!/usr/bin/env node
// Replay driver (PLAN 12.5, E6): replays a sequence of commits through the
// engine and measures false skips against ground truth, using the real adapter
// (git change source + @backplane/client over core/dist/backplane serve +
// backplane-vitest run) plus plain vitest runs for ground truth.
//
//   commits_processed        commits walked, oldest -> newest
//   commits_evaluated        commits whose predecessor's ground truth was green
//   task_commit_pairs_examined (task, commit) pairs compared plan vs ground truth
//   false_skips              task fails in ground truth, is not invalidated by
//                             the plan, and fails again on two reruns
//   rule_of_three_bound      3 / commits_evaluated (PLAN 12.6)
//
// Report is written to --out (default benchmarks/results/replay.json) and
// printed to stdout.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type Plan } from "@backplane/client";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../benchmarks/replay/dist/src
const ROOT = path.resolve(HERE, "../../../..");            // graph root
const ENGINE = path.join(ROOT, "core", "dist", "backplane");
const VITEST_RUN = path.join(ROOT, "adapters", "vitest", "dist", "src", "run.js");
const VITEST_BIN = path.join(ROOT, "adapters", "vitest", "node_modules", "vitest", "vitest.mjs");
const FIXTURE = path.join(ROOT, "adapters", "vitest", "fixtures", "repo");

interface CliArgs {
  repo?: string;
  commits?: number;
  store?: string;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    switch (a) {
      case "--repo": out.repo = value(); break;
      case "--commits": {
        out.commits = Number(value());
        if (!Number.isInteger(out.commits) || out.commits < 1) throw new Error("--commits needs a positive integer");
        break;
      }
      case "--store": out.store = value(); break;
      case "--out": out.out = value(); break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  return out;
}

function git(repo: string, args: string[]): string {
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=replay", "-c", "user.email=replay@example", ...args], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function headOf(repo: string): string {
  return git(repo, ["rev-parse", "HEAD"]);
}

interface GtResult {
  task: string;
  outcome: "pass" | "fail";
}

// Ground truth at the current worktree state: a plain vitest run with no
// recorder, so it never touches the store.
function groundTruth(repo: string): { results: GtResult[]; allPassed: boolean } {
  const repoReal = realpathSync(repo);
  const dir = mkdtempSync(path.join(os.tmpdir(), "bp-replay-gt-"));
  const report = path.join(dir, "report.json");
  const r = spawnSync(
    process.execPath,
    [VITEST_BIN, "run", "--root", repo, "--pool=forks", "--reporter=json", `--outputFile=${report}`],
    { encoding: "utf8", timeout: 900_000 },
  );
  if (r.error !== undefined) throw new Error(`ground-truth vitest failed to start: ${r.error.message}`);
  // vitest exits non-zero when tests fail: that is ground-truth data, not a harness error.
  const json = JSON.parse(readFileSync(report, "utf8")) as { testResults?: Array<{ name: string; status: string }> };
  const results: GtResult[] = [];
  for (const tr of json.testResults ?? []) {
    const rel = path.relative(repoReal, realpathSync(tr.name)).split(path.sep).join("/");
    results.push({ task: rel, outcome: tr.status === "passed" ? "pass" : "fail" });
  }
  results.sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));
  return { results, allPassed: results.every((t) => t.outcome === "pass") };
}

// Re-run one test file twice (plain vitest, no recorder) to confirm a
// suspected false skip (PLAN 12.5 step 4).
function runOnce(repo: string, task: string): "pass" | "fail" | "error" {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bp-replay-rerun-"));
  const report = path.join(dir, "report.json");
  const r = spawnSync(
    process.execPath,
    [VITEST_BIN, "run", task, "--root", repo, "--pool=forks", "--reporter=json", `--outputFile=${report}`],
    { cwd: repo, encoding: "utf8", timeout: 300_000 },
  );
  if (r.error !== undefined) return "error";
  try {
    const json = JSON.parse(readFileSync(report, "utf8")) as { testResults?: Array<{ status?: string }> };
    const status = json.testResults?.[0]?.status;
    return status === "passed" ? "pass" : status === "failed" ? "fail" : "error";
  } catch {
    return "error";
  }
}

// One deterministic edit per replayed commit, exercising different input kinds
// (file read, dir listing, probe, global input, broken read, deletion).
const EDIT_SEQUENCE: Array<{ op: "write" | "delete"; path: string; content?: string }> = [
  { op: "write", path: "packages/core/src/leaf.ts", content: "export const LEAF: number = 3;\n" },
  { op: "write", path: "packages/app/plugins/p2.ts", content: "export default function other(): string { return 'p2';\n" },
  { op: "write", path: "packages/core/src/shadow.ts", content: "export const SHADOW: boolean = true;\n" },
  {
    op: "write",
    path: "package-lock.json",
    content: '{\n  "name": "fixture-root",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": { "": { "name": "fixture-root", "version": "0.0.1" } }\n}\n',
  },
  {
    op: "write",
    path: "packages/core/src/util.ts",
    content: "export function double(n: number): number { throw new Error('broken util'); }\n",
  },
  { op: "delete", path: "packages/app/test/disposable.test.ts" },
];

function applyEdit(repo: string, edit: { op: "write" | "delete"; path: string; content?: string }): void {
  const full = path.join(repo, edit.path);
  if (edit.op === "write") {
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, edit.content!);
  } else {
    rmSync(full, { force: true });
  }
  git(repo, ["add", "-A"]);
  const staged = git(repo, ["diff", "--cached", "--name-only"]);
  if (staged.length > 0) git(repo, ["commit", "-q", "-m", `replay ${edit.path}`]);
}

// One adapter loop iteration at the current worktree state: plan from the
// store baseline, run the invalid tasks with the recorder, observe, advance.
// Returns the report the adapter CLI emits with --json.
interface RunReport {
  plan: Plan | null;
  results: Array<{ task: string; outcome: string }>;
  advanced: boolean;
  exit: number;
  total_tasks: number;
}

function runRecorded(repo: string, store: string): RunReport {
  const r = spawnSync(
    process.execPath,
    [VITEST_RUN, "run", "--root", repo, "--store", store, "--json", "--jobs", "2"],
    { cwd: repo, encoding: "utf8", timeout: 900_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_ENV: "test" } },
  );
  if (r.status !== 0 && r.status !== 1 && r.status !== 7) throw new Error(`backplane-vitest run failed (exit ${r.status}): ${r.stderr.slice(-1000)}`);
  const parsed = JSON.parse(r.stdout) as RunReport & { total_tasks?: number };
  return {
    plan: parsed.plan ?? null,
    results: parsed.results ?? [],
    advanced: Boolean(parsed.advanced),
    exit: r.status ?? -1,
    total_tasks: parsed.total_tasks ?? 0,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const commitsN = args.commits ?? EDIT_SEQUENCE.length;
  const work = mkdtempSync(path.join(os.tmpdir(), "bp-replay-"));
  const repo = path.join(work, "repo");
  const store = args.store ?? path.join(work, "store");
  cpSync(args.repo ?? FIXTURE, repo, { recursive: true, verbatimSymlinks: true });

  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fixture base"]);

  const initStore = spawnSync(ENGINE, ["init", "--store", store], { encoding: "utf8" });
  if (initStore.status !== 0) throw new Error(`engine init failed: ${initStore.stderr}`);

  const client = await connect({ store, root: repo, command: [ENGINE, "serve"], timeoutMs: 60_000 });
  try {
    const walked: Array<{ index: number; id: string }> = [];
    let current = headOf(repo);
    walked.push({ index: 0, id: current });

    let commitsEvaluated = 0;
    let taskCommitPairs = 0;
    const falseSkips: Array<{
      commit: string;
      task: string;
      query: Array<{ id: string; reasons: string[] }>;
    }> = [];
    const flaky: Array<{ commit: string; task: string }> = [];
    let total_tasks = 0;
    let prevAllPassed = true;

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
      const invalid = new Set<string>((plan?.tasks ?? []).map((t) => t.id));
      const reasonsById = new Map<string, string[]>(
        (plan?.tasks ?? []).map((t) => [t.id, t.reasons ?? []]),
      );

      if (evaluated && plan !== null) {
        for (const t of gt.results) {
          if (t.outcome !== "fail") continue;
          if (invalid.has(t.task)) continue; // invalidated by the plan: not a skip
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

      current = id;
      prevAllPassed = gt.allPassed;
    }

    const report = {
      spec: "PLAN 12.5 replay",
      milestone: "E6",
      engine: ENGINE,
      repo,
      commits: walked,
      commits_processed: walked.length,
      commits_evaluated: commitsEvaluated,
      total_tasks,
      task_commit_pairs_examined: taskCommitPairs,
      false_skips: falseSkips,
      flaky,
      rule_of_three_bound: commitsEvaluated > 0 ? `3/${commitsEvaluated}` : "n/a",
    };
    const out = args.out ?? path.join(ROOT, "benchmarks", "results", "replay.json");
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? String(e) : String(e));
  process.exit(1);
});

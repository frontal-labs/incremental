#!/usr/bin/env node
// `incremental-playwright run`: the Playwright adapter loop (PLAN 10.4).
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (incremental-git)
//   plan = affected(ch, context, declared test files)
//   forget the test files that were deleted
//   run each selected test file and observe it (inputs hashed before the run)
//   advance to HEAD only if every selected file ran, the worktree is clean
//   and HEAD did not move; otherwise exit 7 (ran, not advanced).
//
// Exit codes: 0 ok and advanced; 1 a test failed (advanced when allowed);
// 2 usage error; 4 engine or setup error; 7 ran but not advanced.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  connect,
  defaultEngine,
  isIncrementalError,
  repoRoot,
  type Change,
  type Fallback,
  type Observation,
  type Outcome,
  type Plan,
} from "@incremental/client";
import {
  configAnalysis,
  contextFor,
  defaultPlaywright,
  discoverTasks,
  inputsFor,
  runFile,
  TEST_FILE,
  type FileRun,
} from "./project.js";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  // Timeout for one test file, in milliseconds.
  timeoutMs: number;
  // The Playwright CLI (cli.js) to run. Default: the adapter's pinned version.
  playwright?: string;
}

export interface TaskRun extends FileRun {
  // The observation for this task is dirty (PLAN 11.1 rule 4).
  dirty: boolean;
}

export interface RunReport {
  mode: "run" | "all";
  root: string;
  stored: string | null;
  base: string | null;
  head: string;
  headEnd: string;
  dirty: boolean;
  changes: Change[];
  plan: Plan | null;
  fallback: Fallback | null;
  selected: string[];
  discovered: string[];
  results: TaskRun[];
  observed: number;
  advanced: boolean;
  notAdvanced: string[];
  exit: number;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

interface GitChangeSet {
  baseline: string;
  head: string;
  dirty: boolean;
  changes: Change[];
}

// The git change source (PLAN 11.7). Throws on failure.
function gitSourcePath(): string {
  return (
    process.env.INCREMENTAL_GIT ||
    path.join(repoRoot(), "adapters", "git", "dist", "incremental-git")
  );
}

function gitChangeSet(root: string, ref: string): GitChangeSet {
  const r = spawnSync(gitSourcePath(), ["changes", "--base", ref, "--root", root], {
    encoding: "utf8",
  });
  if (r.error !== undefined)
    throw new Error(`cannot run the git change source: ${r.error.message}`);
  if (r.status !== 0)
    throw new Error(
      `git change source failed (exit ${r.status}): ${(r.stdout || r.stderr || "").trim()}`,
    );
  return JSON.parse(r.stdout) as GitChangeSet;
}

function ensureStore(store: string): void {
  if (existsSync(store)) return;
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0)
    throw new UsageError(`cannot create the store at ${store}: ${(r.stderr || "").trim()}`);
}

export async function runAdapter(opts: RunOptions): Promise<RunReport> {
  const root = path.resolve(opts.root);
  const store = path.resolve(opts.store);
  const cli = opts.playwright !== undefined ? path.resolve(opts.playwright) : defaultPlaywright();
  ensureStore(store);

  const context = contextFor(root, cli);
  const discovered = discoverTasks(root, cli);
  const analysis = configAnalysis(root);

  let head0: GitChangeSet;
  try {
    head0 = gitChangeSet(root, "HEAD");
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }

  const client = await connect({
    store,
    root,
    command: [defaultEngine(), "serve"],
    timeoutMs: 60_000,
  });
  try {
    const stored = (await client.baseline()).baseline;

    let cs: GitChangeSet | null = null;
    let gitError: string | null = null;
    try {
      cs = gitChangeSet(root, opts.base ?? stored ?? "HEAD");
    } catch (e) {
      gitError = e instanceof Error ? e.message : String(e);
    }
    if (cs === null && (opts.base !== undefined || stored === null)) {
      throw new UsageError(gitError ?? "the git change source failed");
    }
    if (cs !== null && opts.base !== undefined && stored !== null && cs.baseline !== stored) {
      throw new UsageError(
        `--base resolves to ${cs.baseline}, but the store baseline is ${stored}`,
      );
    }

    let plan: Plan | null = null;
    if (cs !== null) {
      plan = await client.affected(
        { baseline: cs.baseline, head: cs.head, changes: cs.changes },
        {
          baseline: cs.baseline,
          context,
          declared_tasks: discovered,
          verify: false,
          policy: "balanced",
        },
      );
    }

    const deleted = new Set<string>(plan?.deleted_tasks ?? []);
    for (const c of cs?.changes ?? []) {
      if (c.status === "deleted" && TEST_FILE.test(c.path)) deleted.add(c.path);
      if (c.status === "renamed" && c.old_path !== undefined && TEST_FILE.test(c.old_path))
        deleted.add(c.old_path);
    }
    for (const t of [...deleted].sort()) await client.forget(t);

    const runAll = opts.all || plan === null || plan.fallback !== null;
    const planned = new Set((plan?.tasks ?? []).map((t) => t.id));
    const selected = runAll ? discovered : discovered.filter((t) => planned.has(t));

    const workDir = mkdtempSync(path.join(os.tmpdir(), "incremental-playwright-"));
    const results: TaskRun[] = [];
    const observations: Observation[] = [];
    const obsBaseline = stored ?? head0.head;
    for (const [i, task] of selected.entries()) {
      let inputs: ReturnType<typeof inputsFor>["inputs"];
      let dirty: boolean;
      try {
        ({ inputs, dirty } = inputsFor(root, task, analysis.config, analysis.live));
        const run = runFile(root, cli, task, path.join(workDir, String(i + 1)), opts.timeoutMs);
        results.push({ ...run, dirty });
        observations.push({
          task,
          baseline: obsBaseline,
          dirty,
          context,
          inputs,
          outputs: [],
          outcome: run.outcome,
          duration_ms: run.durationMs,
        });
      } catch (e) {
        results.push({
          task,
          outcome: "error",
          durationMs: 0,
          problem: e instanceof Error ? e.message : String(e),
          dirty: true,
        });
      }
    }

    const end = gitChangeSet(root, "HEAD");
    const dirty = end.dirty;
    const headEnd = end.head;
    if (dirty) for (const o of observations) o.dirty = true;
    for (const r of results) if (dirty) r.dirty = true;

    const allRan = results.every((r) => r.outcome !== "error");
    const canAdvance = allRan && !dirty && headEnd === head0.head;
    if (observations.length > 0) await client.observeMany(observations);
    let advanced = false;
    if (canAdvance) {
      if (headEnd !== stored) await client.advance(headEnd, stored);
      advanced = true;
    }

    const notAdvanced: string[] = [];
    if (!canAdvance) {
      for (const r of results)
        if (r.outcome === "error")
          notAdvanced.push(`error: ${r.task}${r.problem ? ` (${r.problem})` : ""}`);
      if (dirty) notAdvanced.push("the worktree is dirty at the end of the run");
      if (headEnd !== head0.head) notAdvanced.push("HEAD moved during the run");
    }
    const failed = results.some((r) => r.outcome === "fail");
    const exit = !advanced ? 7 : failed ? 1 : 0;

    return {
      mode: opts.all ? "all" : "run",
      root,
      stored,
      base: cs?.baseline ?? null,
      head: head0.head,
      headEnd,
      dirty,
      changes: cs?.changes ?? [],
      plan,
      fallback:
        plan?.fallback ??
        (runAll && plan === null ? { action: "run_all", reason: "git_source" } : null),
      selected,
      discovered,
      results,
      observed: observations.length,
      advanced,
      notAdvanced,
      exit,
    };
  } finally {
    await client.close();
  }
}

interface ParsedArgs {
  opts: RunOptions;
  json: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (cmd !== "run")
    throw new UsageError(
      "usage: incremental-playwright run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS] [--playwright CLI]",
    );
  const opts: RunOptions = { root: process.cwd(), store: "", all: false, timeoutMs: 600_000 };
  let json = false;
  let storeGiven = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    const value = (): string => {
      const v = rest[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === "--base") {
      opts.base = value();
    } else if (a === "--json") {
      json = true;
    } else if (a === "--all") {
      opts.all = true;
    } else if (a === "--store") {
      opts.store = value();
      storeGiven = true;
    } else if (a === "--root") {
      opts.root = value();
    } else if (a === "--playwright") {
      opts.playwright = value();
    } else if (a === "--timeout") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new UsageError("--timeout needs a positive integer");
      opts.timeoutMs = n;
    } else {
      throw new UsageError(`unknown option ${a}`);
    }
  }
  opts.root = path.resolve(opts.root);
  if (!storeGiven)
    opts.store = process.env.INCREMENTAL_STORE || path.join(opts.root, ".incremental");
  return { opts, json };
}

function printText(r: RunReport): void {
  const counts: Record<Outcome, number> = { pass: 0, fail: 0, error: 0, none: 0 };
  for (const t of r.results) counts[t.outcome]++;
  const dirtyCount = r.results.filter((t) => t.dirty).length;
  const lines = [
    `incremental playwright ${r.mode}: stored ${r.stored ?? "none"}, query ${r.base ?? "none"}, head ${r.headEnd}${r.dirty ? " (dirty)" : ""}`,
  ];
  if (r.fallback !== null) lines.push(`fallback: ${r.fallback.reason}`);
  else if (r.plan !== null)
    lines.push(
      `plan: ${r.plan.tasks.length} invalid of ${r.plan.total_tasks}, confidence ${r.plan.confidence}`,
    );
  lines.push(
    `ran ${r.results.length}: pass ${counts.pass}, fail ${counts.fail}, error ${counts.error}, dirty ${dirtyCount}`,
  );
  for (const t of r.results)
    if (t.outcome !== "pass" || t.dirty)
      lines.push(
        `  ${t.outcome}${t.dirty ? " dirty" : ""} ${t.task}${t.problem ? ` (${t.problem})` : ""}`,
      );
  lines.push(r.advanced ? `advanced to ${r.headEnd}` : `not advanced: ${r.notAdvanced.join("; ")}`);
  lines.push(`exit ${r.exit}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  try {
    const report = await runAdapter(parsed.opts);
    if (parsed.json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else printText(report);
    return report.exit;
  } catch (e) {
    const code =
      e instanceof UsageError ? "invalid_params" : isIncrementalError(e) ? e.code : "internal";
    const message = e instanceof Error ? e.message : String(e);
    if (parsed.json)
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    process.stderr.write(`incremental playwright: ${message}\n`);
    return e instanceof UsageError ? 2 : 4;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

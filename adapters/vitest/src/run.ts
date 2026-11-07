#!/usr/bin/env node
// `incremental-vitest run`: the Vitest adapter loop (PLAN 10.4, 11.3).
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (incremental-git)
//   plan = affected(ch, context, env, declared tests)
//   forget the deleted test tasks
//   run the selected test files under the recorder, observe each one
//   advance to HEAD only if every selected task ran, the worktree is clean and
//   HEAD did not move; otherwise exit 7 (ran, not advanced).
//
// Exit codes: 0 ok and advanced; 1 a test failed (advanced when allowed);
// 2 usage or engine error; 7 ran but the baseline was not advanced.
import { mkdtempSync } from "node:fs";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  connect,
  defaultEngine,
  isIncrementalError,
  type Change,
  type Fallback,
  type Observation,
  type Outcome,
  type Plan,
} from "@incremental/client";
import { buildObservation, runFile, type FileResult } from "./record.js";
import {
  contextFor,
  discoverTests,
  envHashes,
  gitChangeSet,
  GitSourceError,
  loadConfig,
  vitestBin,
  vitestVersion,
  selectTests,
  type GitChangeSet,
} from "./planner.js";
import { TEST_FILE } from "./shared.js";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  shadow: boolean;
  jobs: number;
  timeoutMs: number;
  // Test file discovery filters (repo-relative globs). Empty include means all.
  include: string[];
  exclude: string[];
  // Extra `vitest run` arguments, and the Vitest CLI entry to run (default: the
  // adapter's pinned Vitest).
  vitestArgs: string[];
  vitest?: string;
}

export interface TaskRun {
  task: string;
  outcome: Outcome;
  durationMs: number;
  problem: string | null;
}

export interface RunReport {
  mode: "run" | "all" | "shadow";
  root: string;
  stored: string | null;
  base: string | null;
  head: string;
  headEnd: string;
  dirty: boolean;
  changes: Change[];
  plan: Plan | null;
  fallback: Fallback | null;
  gitError: string | null;
  selected: string[];
  // Every test file discovered for this run (after the include and exclude filters).
  discovered: string[];
  wouldSkip: string[];
  results: TaskRun[];
  observed: number;
  advanced: boolean;
  // Why the baseline did not move, when it did not (empty when it moved or
  // in shadow mode).
  notAdvanced: string[];
  exit: number;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}

function ensureStore(store: string): void {
  if (existsSync(store)) return;
  const engine = defaultEngine();
  const r = spawnSync(engine, ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0)
    throw new UsageError(`cannot create the store at ${store}: ${(r.stderr || "").trim()}`);
}

export async function runAdapter(opts: RunOptions): Promise<RunReport> {
  const root = path.resolve(opts.root);
  const store = path.resolve(opts.store);
  ensureStore(store);

  // The environment the tests run in. NODE_ENV defaults to "test", as Vitest
  // would set it, so that the planner and the workers see the same value.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.NODE_ENV) env.NODE_ENV = "test";
  const hashes = envHashes(env);
  const config = loadConfig(root);
  const vitest = opts.vitest !== undefined ? path.resolve(opts.vitest) : vitestBin();
  const context = contextFor(root, vitestVersion(vitest));
  const discovered = selectTests(discoverTests(root), opts.include, opts.exclude);

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
      if (!(e instanceof GitSourceError)) throw e;
      gitError = e.message;
    }
    if (cs === null && (opts.base !== undefined || stored === null)) {
      throw new UsageError(gitError ?? "the git change source failed");
    }
    if (cs !== null && opts.base !== undefined && stored !== null && cs.baseline !== stored) {
      throw new UsageError(
        `--base resolves to ${cs.baseline}, but the store baseline is ${stored}`,
      );
    }

    // The plan is asked even in --all and --shadow mode, for the deleted tasks
    // and for the report of what would be skipped.
    let plan: Plan | null = null;
    if (cs !== null) {
      plan = await client.affected(
        { baseline: cs.baseline, head: cs.head, changes: cs.changes },
        {
          baseline: cs.baseline,
          context,
          env: hashes,
          config,
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
    if (!opts.shadow) for (const t of [...deleted].sort()) await client.forget(t);

    const runAll = opts.all || opts.shadow || plan === null || plan.fallback !== null;
    const planned = new Set((plan?.tasks ?? []).map((t) => t.id));
    const selected = runAll
      ? discovered
      : [...planned].filter((t) => discovered.includes(t)).sort();
    const wouldSkip = plan === null ? [] : discovered.filter((t) => !planned.has(t));

    const workDir = mkdtempSync(path.join(os.tmpdir(), "incremental-vitest-"));
    const preloadPath = fileURLToPath(new URL("./preload.js", import.meta.url));
    const files: FileResult[] = await mapPool(selected, opts.jobs, (task, i) =>
      runFile({
        root,
        task,
        workDir,
        index: i + 1,
        env,
        timeoutMs: opts.timeoutMs,
        vitestBin: vitest,
        preloadPath,
        vitestArgs: opts.vitestArgs,
      }),
    );

    const end = gitChangeSet(root, "HEAD");
    const dirty = end.dirty;
    const headEnd = end.head;
    const allRan = files.every((f) => f.outcome !== "error");
    const canAdvance = !opts.shadow && allRan && !dirty && headEnd === head0.head;

    // Observations are relative to the store baseline. Before a first advance
    // the baseline is null, and the observations name the commit they were
    // taken at, which is the one the first advance will name.
    const obsBaseline = stored ?? headEnd;
    const observations: Observation[] = files.map((f) =>
      buildObservation(f, root, context, obsBaseline, dirty),
    );
    let advanced = false;
    if (!opts.shadow) {
      if (observations.length > 0) await client.observeMany(observations);
      if (canAdvance) {
        if (headEnd === stored) {
          advanced = true;
        } else {
          await client.advance(headEnd, stored);
          advanced = true;
        }
      }
    }

    const notAdvanced: string[] = [];
    if (!opts.shadow && !canAdvance) {
      for (const f of files)
        if (f.outcome === "error")
          notAdvanced.push(`error: ${f.task}${f.problem ? ` (${f.problem})` : ""}`);
      if (dirty) notAdvanced.push("the worktree is dirty at the end of the run");
      if (headEnd !== head0.head) notAdvanced.push("HEAD moved during the run");
    }
    const failed = files.some((f) => f.outcome === "fail");
    const errored = files.some((f) => f.outcome === "error");
    let exit: number;
    if (opts.shadow) exit = failed || errored ? 1 : 0;
    else if (!advanced) exit = 7;
    else exit = failed ? 1 : 0;

    return {
      mode: opts.shadow ? "shadow" : opts.all ? "all" : "run",
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
      gitError,
      selected,
      discovered,
      wouldSkip,
      results: files.map((f) => ({
        task: f.task,
        outcome: f.outcome,
        durationMs: f.durationMs,
        problem: f.problem,
      })),
      observed: opts.shadow ? 0 : observations.length,
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
      "usage: incremental-vitest run [--base REF] [--json] [--all] [--jobs N] [--shadow] [--store DIR] [--root DIR] [--include GLOB]... [--exclude GLOB]... [--vitest-arg ARG]... [--vitest FILE]",
    );
  const opts: RunOptions = {
    root: process.cwd(),
    store: "",
    all: false,
    shadow: false,
    jobs: os.availableParallelism(),
    timeoutMs: 600_000,
    include: [],
    exclude: [],
    vitestArgs: [],
  };
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
    } else if (a === "--shadow") {
      opts.shadow = true;
    } else if (a === "--jobs") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new UsageError("--jobs needs a positive integer");
      opts.jobs = n;
    } else if (a === "--store") {
      opts.store = value();
      storeGiven = true;
    } else if (a === "--root") {
      opts.root = value();
    } else if (a === "--include") {
      opts.include.push(value());
    } else if (a === "--exclude") {
      opts.exclude.push(value());
    } else if (a === "--vitest-arg") {
      opts.vitestArgs.push(value());
    } else if (a === "--vitest") {
      opts.vitest = value();
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
  const lines = [
    `incremental vitest ${r.mode}: stored ${r.stored ?? "none"}, query ${r.base ?? "none"}, head ${r.headEnd}${r.dirty ? " (dirty)" : ""}`,
  ];
  if (r.fallback !== null) lines.push(`fallback: ${r.fallback.reason}`);
  else if (r.plan !== null)
    lines.push(
      `plan: ${r.plan.tasks.length} invalid of ${r.plan.total_tasks}, confidence ${r.plan.confidence}`,
    );
  if (r.gitError !== null) lines.push(`git: ${r.gitError}`);
  lines.push(
    `ran ${r.results.length}: pass ${counts.pass}, fail ${counts.fail}, error ${counts.error}`,
  );
  if (r.mode === "shadow")
    lines.push(`would skip ${r.wouldSkip.length}: ${r.wouldSkip.join(", ")}`);
  for (const t of r.results)
    if (t.outcome !== "pass")
      lines.push(`  ${t.outcome} ${t.task}${t.problem ? ` (${t.problem})` : ""}`);
  lines.push(
    r.advanced
      ? `advanced to ${r.headEnd}`
      : `not advanced: ${r.notAdvanced.join("; ") || "shadow mode"}`,
  );
  lines.push(`exit ${r.exit}`);
  process.stdout.write(lines.join("\n") + "\n");
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
    if (parsed.json) process.stdout.write(JSON.stringify(report) + "\n");
    else printText(report);
    return report.exit;
  } catch (e) {
    const code =
      e instanceof UsageError ? "invalid_params" : isIncrementalError(e) ? e.code : "internal";
    const message = e instanceof Error ? e.message : String(e);
    if (parsed.json)
      process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + "\n");
    process.stderr.write(`incremental vitest: ${message}\n`);
    return e instanceof UsageError ? 2 : 4;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

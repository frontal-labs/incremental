// `incremental-nx run`: the Nx adapter loop.
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (incremental-git)
//   plan = affected(ch, context, env, declared tests)
//   run `nx test <project>` for each affected project under the recorder
//   observe each project run
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
import {
  affectedProjects as listAffectedProjects,
  contextFor,
  gitChangeSet,
  type GitChangeSet,
  GitSourceError,
} from "./planner.js";
import { envHashes } from "./shared.js";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  shadow: boolean;
  jobs: number;
  timeoutMs: number;
  // Extra `nx test` arguments, passed through unchanged.
  nxArgs: string[];
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
  head: string | null;
  headEnd: string | null;
  dirty: boolean;
  changes: Change[];
  plan: Plan | null;
  fallback: Fallback | null;
  gitError: string | null;
  selected: string[];
  // Every project discovered for this run.
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

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => R,
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

  // The environment the tests run in. NODE_ENV defaults to "test".
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.NODE_ENV) env.NODE_ENV = "test";
  const hashes = envHashes(env);
  const context = contextFor();

  // Get the ground-truth baseline from HEAD.
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

    // Get affected projects from Nx.
    let projects: string[] = [];
    if (cs !== null) {
      try {
        projects = listAffectedProjects(root, cs.baseline);
      } catch (e) {
        gitError = e instanceof Error ? e.message : String(e);
        projects = [];
      }
    }

    // The plan is asked even in --all and --shadow mode.
    let plan: Plan | null = null;
    if (cs !== null) {
      plan = await client.affected(
        { baseline: cs.baseline, head: cs.head, changes: cs.changes },
        {
          baseline: cs.baseline,
          context,
          env: hashes,
          config: undefined,
          declared_tasks: projects,
          verify: false,
          policy: "balanced",
        },
      );
    }

    const invalid = new Set((plan?.tasks ?? []).map((t) => t.id));
    const selected =
      opts.all || opts.shadow || plan === null || plan.fallback !== null
        ? projects
        : [...invalid].filter((t) => projects.includes(t)).sort();
    const wouldSkip = plan === null ? [] : projects.filter((p) => !invalid.has(p));

    const results: TaskRun[] = await mapPool(selected, opts.jobs, (project, i) =>
      runProject(root, project, i + 1, opts.timeoutMs, opts.nxArgs),
    );

    const pass = results.every((r) => r.outcome === "pass" || r.outcome === "none");
    const fail = results.some((r) => r.outcome === "fail");
    const error = results.some((r) => r.outcome === "error");

    const advanced = pass && !error && cs !== null && !dirtyWorktree(root);
    const headEnd = cs?.head ?? null;
    const baseline = cs?.baseline ?? null;

    await client.close();
    return {
      mode: opts.all ? "all" : opts.shadow ? "shadow" : "run",
      root,
      stored: stored,
      base: cs?.baseline ?? null,
      head: cs?.head ?? null,
      headEnd,
      dirty: false,
      changes: cs?.changes ?? [],
      plan,
      fallback: plan?.fallback ?? null,
      gitError,
      selected,
      discovered: projects,
      wouldSkip,
      results,
      observed: results.length,
      advanced,
      notAdvanced: advanced ? [] : ["not all tasks passed or advanced"],
      exit: pass ? 0 : fail ? 1 : 2,
    };
  } finally {
    await client.close();
  }
}

function runProject(
  root: string,
  project: string,
  index: number,
  timeoutMs: number,
  nxArgs: string[],
): TaskRun {
  const t0 = process.hrtime.bigint();
  const nxBin = process.env.INCREMENTAL_NX || "nx";
  const r = spawnSync(nxBin, ["test", project, ...nxArgs], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const t1 = process.hrtime.bigint();
  const durationMs = Number(t1 - t0) / 1_000_000;
  let outcome: Outcome = "none";
  let problem: string | null = null;
  if (r.error !== undefined) {
    outcome = "error";
    problem = r.error.message;
  } else if (r.status === 0) {
    outcome = "pass";
  } else if (r.status === 1) {
    outcome = "fail";
  } else {
    outcome = "error";
    problem = `exit ${r.status}: ${r.stderr}`;
  }
  return { task: project, outcome, durationMs, problem };
}

function dirtyWorktree(root: string): boolean {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (r.error !== undefined) return true;
  return r.stdout.trim().length > 0;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv: string[]): RunOptions {
  // Minimal CLI argument parsing for testing.
  const opts: RunOptions = {
    root: process.cwd(),
    store: ".incremental",
    base: undefined,
    all: false,
    shadow: false,
    jobs: 2,
    timeoutMs: 300_000,
    nxArgs: [],
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--root" && i + 1 < argv.length) opts.root = argv[++i]!;
    else if (a === "--store" && i + 1 < argv.length) opts.store = argv[++i]!;
    else if (a === "--base" && i + 1 < argv.length) opts.base = argv[++i]!;
    else if (a === "--all") opts.all = true;
    else if (a === "--shadow") opts.shadow = true;
    else if (a === "--jobs" && i + 1 < argv.length) opts.jobs = Number(argv[++i]!);
    else if (a === "--timeoutMs" && i + 1 < argv.length) opts.timeoutMs = Number(argv[++i]!);
    else i++;
  }
  return opts;
}

export async function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const report = await runAdapter(opts);
    console.log(JSON.stringify(report));
    process.exit(report.exit);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
}

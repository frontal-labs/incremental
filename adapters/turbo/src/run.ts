// `incremental-turbo run`: the Turborepo adapter loop.
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (incremental-git)
//   plan = affected(ch, context, env, declared packages)
//   run `turbo run test --filter=<package>` for each invalid package
//   observe each run, with the package's declared inputs (before and after the run)
//   advance to HEAD only if every selected package passed, the worktree is clean at the end
//   and HEAD did not move
//
// Exit codes: 0 ok and advanced (or --shadow); 1 a test failed; 2 usage or engine error;
// 7 ran but the baseline was not advanced.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  connect,
  defaultEngine,
  type Change,
  type Fallback,
  type Input,
  type Observation,
  type Outcome,
  type Plan,
} from "@incremental/client";
import {
  contextFor,
  gitChangeSet,
  GitSourceError,
  type GitChangeSet,
  packageGraph,
  type PackageGraph,
  turboBin,
} from "./planner.js";
import { envHashes, VOLATILE_ENV } from "./shared.js";
import { buildObservation, type FileResult, type TraceEvent } from "@incremental/vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  shadow: boolean;
  jobs: number;
  timeoutMs: number;
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
  changes: Change[];
  plan: Plan | null;
  fallback: Fallback | null;
  gitError: string | null;
  selected: string[];
  // Every package with a test script (the tasks of this workspace).
  discovered: string[];
  wouldSkip: string[];
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
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
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
  // The workspace's own binaries come first for the test commands. The plan's environment and the
  // tests' environment are the same map, so a PATH entry does not look like a change.
  env.PATH = `${path.join(root, "node_modules", ".bin")}${path.delimiter}${env.PATH ?? ""}`;
  const hashes = envHashes(env);
  const context = contextFor(root);

  // The worktree must be a git repository with a HEAD before anything runs.
  try {
    gitChangeSet(root, "HEAD");
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

    const graph: PackageGraph = packageGraph(root);
    let plan: Plan | null = null;
    if (cs !== null) {
      plan = await client.affected(
        { baseline: cs.baseline, head: cs.head, changes: cs.changes },
        {
          baseline: cs.baseline,
          context,
          env: hashes,
          config: undefined,
          declared_tasks: graph.tested,
          verify: false,
          policy: "balanced",
        },
      );
    }

    const invalid = new Set((plan?.tasks ?? []).map((t) => t.id));
    const fallback = plan === null || plan.fallback !== null;
    // --all, a fallback, or no plan runs every package with a test script.
    const selected = opts.shadow
      ? []
      : opts.all || fallback
        ? graph.tested
        : graph.tested.filter((p) => invalid.has(p));
    const wouldSkip = fallback ? [] : graph.tested.filter((p) => !invalid.has(p));

    // Shadow mode plans and reports, without running a task or writing to the store.
    const observing = cs !== null && !opts.shadow;

    // Each selected package runs under the recorder: every file its test processes read is traced
    // (adapters/vitest/src/preload.ts). The trace is the package's observation.
    const traceDir = mkdtempSync(path.join(os.tmpdir(), "incremental-turbo-trace-"));
    const results: RunOut[] = await mapPool(selected, opts.jobs, (pkg, i) =>
      runPackage(root, pkg, traceDir, i + 1, env, opts.timeoutMs),
    );
    rmSync(traceDir, { recursive: true, force: true });

    const dirtyEnd = dirtyWorktree(root);
    const observations: Observation[] = [];
    if (observing && cs !== null) {
      // The baseline the observations belong to: the store's, or the start commit on a first run.
      const obsBaseline = stored ?? cs.baseline;
      for (const r of results) {
        const fr: FileResult = {
          task: r.task,
          outcome: r.outcome,
          durationMs: r.durationMs,
          events: r.events,
          problem: r.problem,
          exitCode: r.exitCode,
        };
        observations.push(
          scopeToPlanEnv(buildObservation(fr, root, context, obsBaseline, dirtyEnd), hashes),
        );
      }
    }
    if (observations.length > 0) await client.observeMany(observations);

    const pass = results.every((r) => r.outcome === "pass" || r.outcome === "none");
    const fail = results.some((r) => r.outcome === "fail");
    const error = results.some((r) => r.outcome === "error");
    const advanced = !opts.shadow && pass && !error && cs !== null && !dirtyEnd;
    if (advanced && cs !== null && cs.head !== stored) await client.advance(cs.head, stored);

    const notAdvanced: string[] = [];
    if (!advanced && !opts.shadow) {
      for (const r of results)
        if (r.outcome === "error")
          notAdvanced.push(`error: ${r.task}${r.problem ? ` (${r.problem})` : ""}`);
      if (fail) notAdvanced.push("a test failed");
      if (dirtyEnd) notAdvanced.push("the worktree is dirty at the end of the run");
      if (cs === null) notAdvanced.push("no ChangeSet");
    }

    const exit = error ? 2 : fail ? 1 : !advanced && !opts.shadow ? 7 : 0;
    return {
      mode: opts.all ? "all" : opts.shadow ? "shadow" : "run",
      root,
      stored,
      base: cs?.baseline ?? null,
      head: cs?.head ?? null,
      headEnd: cs?.head ?? null,
      changes: cs?.changes ?? [],
      plan,
      fallback: plan?.fallback ?? null,
      gitError,
      selected,
      discovered: graph.tested,
      wouldSkip,
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

interface RunOut extends TaskRun {
  events: TraceEvent[];
  exitCode: number | null;
}

// The recorder's preload file, from the installed @incremental/vitest package.
function preloadPath(): string {
  const req = createRequire(import.meta.url);
  return path.join(
    path.dirname(req.resolve("@incremental/vitest/package.json")),
    "dist",
    "src",
    "preload.js",
  );
}

// `turbo run test --filter=<package>` with the recorder preloaded into the node processes it starts.
// --force turns off Turborepo's cache (the adapter decides what to skip), --env-mode=loose passes
// the environment through to the tasks (strict mode would drop NODE_OPTIONS), and --output-logs
// keeps the output short.
function runPackage(
  root: string,
  pkg: string,
  traceDir: string,
  index: number,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): RunOut {
  const t0 = process.hrtime.bigint();
  const trace = path.join(traceDir, `${index}.jsonl`);
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (!VOLATILE_ENV.has(name) && value !== undefined) childEnv[name] = value;
  }
  childEnv.NODE_OPTIONS = [env.NODE_OPTIONS, `--import ${preloadPath()}`].filter(Boolean).join(" ");
  childEnv.INCREMENTAL_TRACE_OUT = trace;
  childEnv.INCREMENTAL_TRACE_ROOT = root;
  const r = spawnSync(
    turboBin(),
    [
      "run",
      "test",
      `--filter=${pkg}`,
      "--force",
      "--no-daemon",
      "--env-mode=loose",
      "--output-logs=errors-only",
    ],
    { cwd: root, encoding: "utf8", env: childEnv, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
  );
  const durationMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  let outcome: Outcome = "none";
  let problem: string | null = null;
  if (r.error !== undefined) {
    outcome = "error";
    problem = r.error.message;
  } else if (/No tasks were executed/.test(output)) {
    // Turborepo ran nothing, so a pass would be false.
    outcome = "error";
    problem = "turbo ran no task for this package";
  } else if (r.status === 0) {
    outcome = "pass";
  } else if (r.status === 1) {
    outcome = "fail";
  } else {
    outcome = "error";
    problem = `exit ${r.status}: ${(r.stderr ?? "").trim().slice(-300)}`;
  }
  return { task: pkg, outcome, durationMs, problem, events: readTrace(trace), exitCode: r.status };
}

// The environment the recorder saw, reduced to the names the plan has (envHashes). The shell and
// its package-manager shims add variables to the test process (PWD, SHLVL, NODE_PATH, ...). They
// are not inputs, and the plan would otherwise count them as changed.
function scopeToPlanEnv(o: Observation, hashes: Record<string, string>): Observation {
  const inputs: Input[] = o.inputs.flatMap((i): Input[] => {
    if (i.kind === "env") return i.name in hashes ? [i] : [];
    if (i.kind === "env_all")
      return [
        {
          kind: "env_all",
          snapshot: Object.fromEntries(
            Object.entries(i.snapshot ?? {}).filter(([n]) => n in hashes),
          ),
        },
      ];
    return [i];
  });
  return { ...o, inputs };
}

// The trace lines the preload wrote. A torn final line is ignored.
function readTrace(file: string): TraceEvent[] {
  if (!existsSync(file)) return [];
  const events: TraceEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line) as TraceEvent);
    } catch {
      // ignored
    }
  }
  return events;
}

function dirtyWorktree(root: string): boolean {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (r.error !== undefined) return true;
  return r.stdout.trim().length > 0;
}

export function parseArgs(argv: string[]): RunOptions {
  const opts: RunOptions = {
    root: process.cwd(),
    store: path.join(os.tmpdir(), "incremental-turbo-store"),
    base: undefined,
    all: false,
    shadow: false,
    jobs: 2,
    timeoutMs: 300_000,
  };
  const args = argv[0] === "run" ? argv.slice(1) : argv;
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--root" && i + 1 < args.length) opts.root = args[++i]!;
    else if (a === "--store" && i + 1 < args.length) opts.store = args[++i]!;
    else if (a === "--base" && i + 1 < args.length) opts.base = args[++i]!;
    else if (a === "--json") {
      // The report is always JSON; the flag is accepted for the other adapters.
    } else if (a === "--all") opts.all = true;
    else if (a === "--shadow") opts.shadow = true;
    else if (a === "--jobs" && i + 1 < args.length) opts.jobs = Number(args[++i]!);
    else if (a === "--timeoutMs" && i + 1 < args.length) opts.timeoutMs = Number(args[++i]!);
    else throw new UsageError(`unknown argument: ${a}`);
    i++;
  }
  return opts;
}

export async function main(): Promise<void> {
  let opts: RunOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error(
      "usage: incremental-turbo run [--base REF] [--all] [--shadow] [--store DIR] [--root DIR]",
    );
    process.exit(2);
  }
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
  void main();
}

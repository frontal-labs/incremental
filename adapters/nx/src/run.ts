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
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  connect,
  defaultEngine,
  isIncrementalError,
  type Change,
  type Fallback,
  type Input,
  type Observation,
  type Outcome,
  type Plan,
} from "@frontal-labs/incremental-client";
import {
  affectedProjects as listAffectedProjects,
  contextFor,
  gitChangeSet,
  type GitChangeSet,
  GitSourceError,
} from "./planner.js";
import { envHashes, VOLATILE_ENV } from "./shared.js";
import { projectGraph, testCommand } from "./inputs.js";
import {
  buildObservation,
  type FileResult,
  type TraceEvent,
} from "@frontal-labs/incremental-vitest";

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
  // The workspace's own binaries come first, for the test commands. The plan's environment and
  // the tests' environment are the same map, so a PATH entry does not look like a change.
  env.PATH = `${path.join(root, "node_modules", ".bin")}${path.delimiter}${env.PATH ?? ""}`;
  const hashes = envHashes(env);
  const context = contextFor(root);
  const nxBin = process.env.INCREMENTAL_NX || "nx";

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

    const graph = projectGraph(root, nxBin);
    const allProjects = Object.keys(graph.roots).sort();
    const invalid = new Set((plan?.tasks ?? []).map((t) => t.id));
    // --all, a fallback, or no plan runs every project (names from the Nx graph).
    // Shadow runs the git-affected ones.
    const selected = opts.shadow
      ? projects
      : opts.all || plan === null || plan.fallback !== null
        ? allProjects
        : [...invalid].filter((t) => projects.includes(t)).sort();
    // A fallback skips nothing: every project runs.
    const wouldSkip =
      plan === null || plan.fallback !== null ? [] : allProjects.filter((p) => !invalid.has(p));

    // Each selected project runs under the recorder: every file its test processes read is
    // traced (see adapters/vitest/src/preload.ts). The trace is the project's observation.
    const traceDir = mkdtempSync(path.join(os.tmpdir(), "incremental-nx-trace-"));
    const results: RunOut[] = await mapPool(selected, opts.jobs, (project, i) =>
      runProject(
        root,
        project,
        graph.roots[project] ?? project,
        traceDir,
        i + 1,
        env,
        opts.timeoutMs,
      ),
    );
    rmSync(traceDir, { recursive: true, force: true });

    const dirtyEnd = dirtyWorktree(root);
    const observations: Observation[] = [];
    if (cs !== null && !opts.shadow) {
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

    const advanced = pass && !error && cs !== null && !dirtyEnd;
    if (advanced && cs !== null && cs.head !== stored) await client.advance(cs.head, stored);
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
      exit: error ? 2 : fail ? 1 : !advanced && !opts.shadow ? 7 : 0,
    };
  } finally {
    await client.close();
  }
}

// The recorder's preload file, from the installed @frontal-labs/incremental-vitest package.
function preloadPath(): string {
  const req = createRequire(import.meta.url);
  return path.join(
    path.dirname(req.resolve("@frontal-labs/incremental-vitest/package.json")),
    "dist",
    "src",
    "preload.js",
  );
}

interface RunOut extends TaskRun {
  events: TraceEvent[];
  exitCode: number | null;
}

// The project's test command, run in the project directory with the recorder preloaded into
// every node process it starts. The adapter does not go through `nx test`: Nx's own processes
// (plugin workers, run-command shells) are subprocesses that the recorder cannot tell apart
// from task processes, which would mark every observation dirty. Nx still supplies the graph and
// the affected set. A test that needs Nx's dependsOn builds is not covered (see the README).
function runProject(
  root: string,
  project: string,
  projectRoot: string,
  traceDir: string,
  index: number,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): RunOut {
  const t0 = process.hrtime.bigint();
  const trace = path.join(traceDir, `${index}.jsonl`);
  const { command, cwd } = testCommand(root, projectRoot);
  // The child's environment is the plan's environment, plus the recorder's own variables
  // (untracked by name). The shell's volatile variables are left out.
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (!VOLATILE_ENV.has(name) && value !== undefined) childEnv[name] = value;
  }
  childEnv.NODE_OPTIONS = [env.NODE_OPTIONS, `--import ${preloadPath()}`].filter(Boolean).join(" ");
  childEnv.INCREMENTAL_TRACE_OUT = trace;
  childEnv.INCREMENTAL_TRACE_ROOT = root;
  // A plain command (words only) runs without a shell, so the shell adds no variables.
  const words = command.trim().split(/\s+/);
  const plain = /^[\w./:@=,+-]+$/.test(words.join(""));
  const r = plain
    ? spawnSync(words[0] as string, words.slice(1), {
        cwd,
        encoding: "utf8",
        env: childEnv,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      })
    : spawnSync("sh", ["-c", command], {
        cwd,
        encoding: "utf8",
        env: childEnv,
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
  return {
    task: project,
    outcome,
    durationMs,
    problem,
    events: readTrace(trace),
    exitCode: r.status,
  };
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

// The trace lines the preload wrote. A torn final line (the process died mid-write) is ignored.
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

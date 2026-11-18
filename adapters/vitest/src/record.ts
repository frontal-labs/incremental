// Runs one test file under the recorder and turns its trace into an
// observation (PLAN 11.2, 11.6, 9.5). Each file gets its own Vitest process,
// and Vitest forks one worker for it (D-12), so the trace belongs to one task.
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Context, Input, Observation, Outcome } from "@incremental/client";

export interface TraceEvent {
  k: string;
  p?: string;
  h?: string;
  n?: string;
  s?: Record<string, string>;
  why?: string;
  pid: number;
  tid: number;
}

export interface FileResult {
  task: string;
  outcome: Outcome;
  durationMs: number;
  events: TraceEvent[];
  // Set when the trace or the report is missing, or the run was killed.
  problem: string | null;
  exitCode: number | null;
}

export interface RunFileOptions {
  root: string;
  task: string;
  workDir: string;
  index: number;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  vitestBin: string;
  preloadPath: string;
  // Extra arguments for `vitest run`, such as --configLoader runner or
  // --project unit, passed through unchanged (PLAN 11.3 adapter pass-through).
  vitestArgs?: readonly string[];
}

interface JsonReport {
  testResults?: Array<{
    status?: string;
    name?: string;
    message?: string;
    assertionResults?: Array<{ status?: string }>;
  }>;
  unhandledErrors?: unknown[];
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
}

function readEvents(file: string): TraceEvent[] {
  if (!existsSync(file)) return [];
  const events: TraceEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.length !== 0) {
      try {
        events.push(JSON.parse(line) as TraceEvent);
      } catch {
        // A torn final line (the process died mid-write) is ignored.
      }
    }
  }
  return events;
}

function readReport(file: string): JsonReport | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as JsonReport;
  } catch {
    return null;
  }
}

// Finds the nearest vitest.config.* file walking up from the test file's
// directory to the repo root. Returns the absolute path, or null when no
// package-level config exists (the root config is used instead).
export function findNearestConfig(root: string, task: string): string | null {
  let dir = path.dirname(path.join(root, task));
  const rootReal = path.resolve(root);
  while (true) {
    for (const name of [
      "vitest.config.ts",
      "vitest.config.mts",
      "vitest.config.js",
      "vitest.config.mjs",
      "vitest.config.cjs",
      "vitest.config.cts",
    ]) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir || parent === rootReal || !dir.startsWith(rootReal)) break;
    dir = parent;
  }
  return null;
}

// Runs one test file in its own Vitest process with the recorder preloaded.
export function runFile(opts: RunFileOptions): Promise<FileResult> {
  mkdirSync(opts.workDir, { recursive: true });
  const base = path.join(opts.workDir, String(opts.index));
  const reportFile = `${base}.report.json`;
  const traceFile = `${base}.trace.ndjson`;
  const logFile = `${base}.log`;
  rmSync(reportFile, { force: true });
  rmSync(traceFile, { force: true });

  // In a monorepo each package ships its own vitest.config.* with the right
  // include patterns, environment and aliases. The root config usually only
  // covers repo-level tests, so a domain test file is invisible to it. Find
  // the nearest package-level config and run Vitest from that directory so
  // its include patterns resolve correctly (PLAN 11.3 adapter pass-through).
  const config = findNearestConfig(opts.root, opts.task);

  let cwd: string;
  let taskArg: string;
  let rootArg: string;
  if (config !== null) {
    // Run from the package directory that owns the config so that the
    // include globs (e.g. "tests/**/*.test.ts") resolve relative to it.
    cwd = path.dirname(config);
    taskArg = path.relative(cwd, path.join(opts.root, opts.task));
    rootArg = cwd;
  } else {
    // No package-level config: use the repo root as before.
    cwd = opts.root;
    taskArg = opts.task;
    rootArg = opts.root;
  }

  const args = vitestArgsFor(opts.vitestBin, taskArg, rootArg, reportFile, opts.vitestArgs);
  const preloadUrl = pathToFileURL(opts.preloadPath).href;
  const nodeOptions = [opts.env.NODE_OPTIONS, `--import ${preloadUrl}`].filter(Boolean).join(" ");
  const env: NodeJS.ProcessEnv = {
    ...opts.env,
    NODE_OPTIONS: nodeOptions,
    INCREMENTAL_TRACE_OUT: traceFile,
    INCREMENTAL_TRACE_ROOT: opts.root,
  };

  const started = Date.now();
  return new Promise<FileResult>((resolve) => {
    const fd = openSync(logFile, "w");
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", fd, fd] });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      closeSync(fd);
      resolve(finish(null, killed, true));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      closeSync(fd);
      resolve(finish(code, killed, false));
    });

    function finish(code: number | null, timedOut: boolean, spawnFailed: boolean): FileResult {
      const durationMs = Date.now() - started;
      const events = readEvents(traceFile);
      const report = readReport(reportFile);
      const [outcome, problem] = deriveOutcome({
        code,
        timedOut,
        spawnFailed,
        report,
        tr: report?.testResults?.[0],
        traceMissing: events.length === 0 && !existsSync(traceFile),
        hasFallbackSummary:
          report !== null &&
          (report.testResults?.length ?? 0) === 0 &&
          code === 0 &&
          (report.success ?? false) &&
          (report.numTotalTests ?? 0) > 0,
        codeIsFailForThis: true,
      });
      return { task: opts.task, outcome, durationMs, events, problem, exitCode: code };
    }
  });
}

function matchEntry(
  report: JsonReport | null,
  root: string,
  cwd: string,
  task: string,
):
  | { kind: "summary" }
  | { kind: "entry"; entry: NonNullable<JsonReport["testResults"]>[number] }
  | { kind: "none" } {
  if (report === null) return { kind: "none" };
  const results = report.testResults ?? [];
  if (results.length === 0) {
    return (
      report.success === true && (report.numTotalTests ?? 0) > 0
        ? { kind: "summary" }
        : { kind: "none" }
    );
  }
  const absTask = path.resolve(root, task);
  for (const e of results) {
    const cand = e.name;
    if (cand === undefined) continue;
    // The name may be absolute or relative to the vitest root (the cwd the
    // batch was spawned from). Try cwd first; a relative name that is not
    // under cwd may still be relative to the repo root.
    if (path.resolve(cwd, cand) === absTask) return { kind: "entry", entry: e };
    if (path.resolve(root, cand) === absTask) return { kind: "entry", entry: e };
    if (path.basename(cand) === path.basename(absTask)) return { kind: "entry", entry: e };
  }
  return { kind: "none" };
}

// Derives the per-file outcome from a report entry (shared by runFile and
// runBatch). `code` is the spawn exit code; for a batch, a nonzero code with
// an all-passed entry still counts as a pass for that file (another file in
// the batch failed), which the caller handles via its `hardFail` flag.
function deriveOutcome(args: {
  code: number | null;
  timedOut: boolean;
  spawnFailed: boolean;
  report: JsonReport | null;
  tr?: NonNullable<JsonReport["testResults"]>[number];
  traceMissing: boolean;
  hasFallbackSummary: boolean;
  // A nonzero exit code that is not attributable to this file (batch mode,
  // another file failed) is not a fail for this file.
  codeIsFailForThis: boolean;
}): [Outcome, string | null] {
  let problem: string | null = null;
  if (args.spawnFailed) problem = "the test process could not start";
  else if (args.timedOut) problem = "the task timed out";
  else if (args.traceMissing) problem = "no trace was written";

  let outcome: Outcome;
  if (args.report === null) {
    outcome = "error";
    problem ??= "no report was written (the test process crashed)";
  } else if (args.tr !== undefined) {
    if (args.tr.status === "passed" && (args.code === 0 || !args.codeIsFailForThis)) {
      outcome = "pass";
    } else if (args.tr.assertionResults?.some((a) => a.status === "failed")) {
      outcome = "fail";
    } else {
      outcome = "error";
      problem ??=
        `the test file failed without test results: ${args.tr.message ?? "no message"}`.slice(
          0,
          500,
        );
    }
  } else if (args.hasFallbackSummary) {
    outcome = "pass";
  } else if (args.code !== 0 || (args.report.success ?? true) === false) {
    outcome = "fail";
    problem ??= `vitest exited ${args.code}: ${JSON.stringify(args.report).slice(0, 300)}`;
  } else {
    outcome = "error";
    problem ??= "the test file produced no results";
  }
  if (args.timedOut || args.spawnFailed) outcome = "error";
  return [outcome, problem];
}

function vitestArgsFor(
  vitestBin: string,
  taskArgs: string | string[],
  rootArg: string,
  reportFile: string,
  extra: readonly string[] | undefined,
): string[] {
  const tasks = Array.isArray(taskArgs) ? taskArgs : [taskArgs];
  return [
    vitestBin,
    "run",
    ...tasks,
    "--root",
    rootArg,
    "--pool=forks",
    "--reporter=json",
    `--outputFile=${reportFile}`,
    ...(extra ?? []),
  ];
}

// T-07 shared-pool prototype: runs a batch of test files in ONE Vitest spawn
// instead of one spawn per file. The forks pool still gives every file its
// own worker, and each process appends to <traceDir>/<pid>.ndjson, so each
// file's trace (and therefore its observation) stays its own. The shared
// cost per spawn (Vite config load, Vitest boot) is paid once per batch
// instead of once per file. Observations are built per file from that file's
// worker trace and its entry in the single-run JSON report.
export interface RunBatchOptions extends RunFileOptions {
  tasks: readonly string[];
}

export function runBatch(opts: RunBatchOptions): Promise<FileResult[]> {
  const tasks = opts.tasks;
  mkdirSync(opts.workDir, { recursive: true });
  const base = path.join(opts.workDir, `batch-${opts.index}`);
  const reportFile = `${base}.report.json`;
  const traceDir = `${base}.traces`;
  const logFile = `${base}.log`;
  rmSync(reportFile, { force: true });
  // force: true suppresses ENOENT for the missing-directory case; recursive
  // removes the directory tree from a previous batch.
  rmSync(traceDir, { recursive: true, force: true });
  mkdirSync(traceDir, { recursive: true });

  // One batch shares one cwd/config. Batch only when every task resolves to
  // the same nearest config (the common single-config case, e.g. the
  // benchmark fixture). Heterogeneous monorepos fall back to one file per
  // spawn via the caller, which detects this through the returned length.
  const configs = new Set(tasks.map((t) => findNearestConfig(opts.root, t) ?? ""));
  if (configs.size !== 1) {
    // Caller falls back to per-file runs.
    throw new Error("runBatch: mixed configs in a batch; fall back to runFile per task");
  }
  const config = tasks[0] === undefined ? null : findNearestConfig(opts.root, tasks[0]);

  let cwd: string;
  let rootArg: string;
  const taskArgs: string[] = [];
  if (config !== null) {
    cwd = path.dirname(config);
    for (const t of tasks)
      taskArgs.push(path.relative(cwd, path.join(opts.root, t)));
    rootArg = cwd;
  } else {
    cwd = opts.root;
    for (const t of tasks) taskArgs.push(t);
    rootArg = opts.root;
  }

  const args = vitestArgsFor(opts.vitestBin, taskArgs, rootArg, reportFile, opts.vitestArgs);
  const preloadUrl = pathToFileURL(opts.preloadPath).href;
  const nodeOptions = [opts.env.NODE_OPTIONS, `--import ${preloadUrl}`].filter(Boolean).join(" ");
  const env: NodeJS.ProcessEnv = {
    ...opts.env,
    NODE_OPTIONS: nodeOptions,
    INCREMENTAL_TRACE_OUT: traceDir,
    INCREMENTAL_TRACE_ROOT: opts.root,
  };

  const started = Date.now();
  return new Promise<FileResult[]>((resolve) => {
    const fd = openSync(logFile, "w");
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", fd, fd] });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      closeSync(fd);
      resolve(all(tasks, "error", "the test process could not start", Date.now() - started, null, []));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      closeSync(fd);
      const report = readReport(reportFile);
      const byPid = readTracesByPid(traceDir);
      resolve(
        tasks.map((task) => {
          const m = matchEntry(report, opts.root, cwd, task);
          const events = pidEventsFor(byPid, task);
          const [outcome, problem] = deriveOutcome({
            code,
            timedOut: killed,
            spawnFailed: false,
            report,
            tr: m.kind === "entry" ? m.entry : undefined,
            traceMissing: events.length === 0,
            hasFallbackSummary:
              m.kind === "summary" &&
              code === 0 &&
              (report?.success ?? false) &&
              (report?.numTotalTests ?? 0) > 0,
            codeIsFailForThis: code !== 0 && m.kind === "entry" && m.entry.status === "passed",
          });
          return {
            task,
            outcome,
            durationMs: Date.now() - started,
            events,
            problem,
            exitCode: code,
          };
        }),
      );
    });
  });
}

function all(tasks: readonly string[], outcome: Outcome, problem: string, durationMs: number, code: number | null, events: TraceEvent[]): FileResult[] {
  return tasks.map((task) => ({ task, outcome, durationMs, events, problem, exitCode: code }));
}

// Reads every <pid>.ndjson trace in the directory, grouped by pid.
function readTracesByPid(traceDir: string): Map<number, TraceEvent[]> {
  const byPid = new Map<number, TraceEvent[]>();
  if (!existsSync(traceDir)) return byPid;
  for (const name of readdirSync(traceDir)) {
    if (!name.endsWith(".ndjson")) continue;
    const pid = Number(name.slice(0, -".ndjson".length));
    if (!Number.isInteger(pid)) continue;
    byPid.set(pid, readEvents(path.join(traceDir, name)));
  }
  return byPid;
}

// Returns the events of the worker process that ran a given test file. Every
// worker reads the test file itself, so the set of pids with a "file" event
// for the task are the candidate workers. With exactly one candidate the
// attribution is exact. With several (a test file whose path string is also
// recorded as an input of a sibling batch file, or shared resolution noise)
// or none, the union of the task-process traces is the safe over-approximation
// (PLAN 11.1: extra inputs only ever skip less, never skip more).
function pidEventsFor(byPid: Map<number, TraceEvent[]>, task: string): TraceEvent[] {
  const taskPids = new Set<number>();
  for (const [pid, events] of byPid) {
    if (events.some((ev) => ev.k === "file" && ev.p === task)) taskPids.add(pid);
  }
  if (taskPids.size === 1) {
    const [only] = taskPids;
    return only === undefined ? [] : byPid.get(only) ?? [];
  }
  const union = new Map<string, TraceEvent>();
  for (const [pid, events] of byPid) {
    // The Vitest main process (not a fork) writes the config-load trace; it is
    // shared boot cost, not an input of any single task, so it is excluded
    // from the per-file observations. A main-process trace contains no "file"
    // event for a test file.
    if (!taskPids.has(pid) && !events.some((ev) => ev.k === "file" && ev.p?.endsWith(".test.")))
      continue;
    for (const ev of events) {
      const key = `${ev.k}:${ev.p ?? ev.n ?? ""}:${ev.h ?? ""}`;
      if (!union.has(key)) union.set(key, ev);
    }
  }
  return [...union.values()];
}

// Builds the observation for a finished task (PLAN 9.5). Inputs are the
// recorded accesses, deduplicated and sorted. The task is recorded dirty when
// the worktree is dirty at the end of the run, when a subprocess or an
// unobserved require() ran, when a worker thread ran (its probes and listings
// are not in the trace), or when the trace is missing (PLAN 11.1 rule 4).
export function buildObservation(
  r: FileResult,
  root: string,
  ctx: Context,
  baseline: string,
  worktreeDirty: boolean,
): Observation {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const probes = new Set<string>();
  const envs = new Map<string, string>();
  let envAll: Record<string, string> | null = null;
  const incomplete = new Set<string>();
  let worker = false;

  for (const ev of r.events) {
    if (ev.k === "file") {
      // A file that no longer exists after the run was a transient artifact
      // (for example Vite's timestamped copy of the config). It can never
      // change again, so it is not an input.
      if (
        ev.p !== undefined &&
        ev.h !== undefined &&
        !files.has(ev.p) &&
        existsSync(path.join(root, ev.p))
      ) {
        files.set(ev.p, ev.h);
      }
    } else if (ev.k === "dir") {
      if (ev.p !== undefined) dirs.add(ev.p);
    } else if (ev.k === "probe") {
      if (ev.p !== undefined) probes.add(ev.p);
    } else if (ev.k === "env") {
      if (ev.n !== undefined && ev.h !== undefined && !envs.has(ev.n)) envs.set(ev.n, ev.h);
    } else if (ev.k === "env_all") {
      envAll ??= ev.s ?? {};
    } else if (ev.k === "incomplete") {
      incomplete.add(ev.why ?? "unknown");
    } else if (ev.k === "worker") {
      worker = true;
    }
  }
  if (r.problem !== null && r.events.length === 0) incomplete.add("no-trace");

  const inputs: Input[] = [];
  for (const p of [...files.keys()].sort())
    inputs.push({ kind: "file", path: p, hash: files.get(p) as string });
  for (const p of [...dirs].sort()) inputs.push({ kind: "dir", path: p });
  for (const p of [...probes].sort()) inputs.push({ kind: "probe", path: p });
  for (const n of [...envs.keys()].sort())
    inputs.push({ kind: "env", name: n, value_hash: envs.get(n) as string });
  if (envAll !== null) inputs.push({ kind: "env_all", snapshot: envAll });

  const dirty = worktreeDirty || incomplete.size > 0 || worker;
  return {
    task: r.task,
    baseline,
    dirty,
    context: ctx,
    inputs,
    outputs: [],
    outcome: r.outcome,
    duration_ms: r.durationMs,
  };
}

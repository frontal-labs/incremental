// Runs one test file under the recorder and turns its trace into an
// observation (PLAN 11.2, 11.6, 9.5). Each file gets its own Vitest process,
// and Vitest forks one worker for it (D-12), so the trace belongs to one task.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Context, Input, Observation, Outcome } from "@frontal-labs/incremental-client";

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
    message?: string;
    assertionResults?: Array<{ status?: string }>;
  }>;
  unhandledErrors?: unknown[];
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

// Runs one test file in its own Vitest process with the recorder preloaded.
export function runFile(opts: RunFileOptions): Promise<FileResult> {
  mkdirSync(opts.workDir, { recursive: true });
  const base = path.join(opts.workDir, String(opts.index));
  const reportFile = base + ".report.json";
  const traceFile = base + ".trace.ndjson";
  const logFile = base + ".log";
  rmSync(reportFile, { force: true });
  rmSync(traceFile, { force: true });

  const args = [
    opts.vitestBin,
    "run",
    opts.task,
    "--root",
    opts.root,
    "--pool=forks",
    "--reporter=json",
    `--outputFile=${reportFile}`,
    ...(opts.vitestArgs ?? []),
  ];
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
    const child = spawn(process.execPath, args, { cwd: opts.root, env, stdio: ["ignore", fd, fd] });
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
      const tr = report?.testResults?.[0];
      let outcome: Outcome;
      let problem: string | null = null;
      if (spawnFailed) problem = "the test process could not start";
      else if (timedOut) problem = "the task timed out";
      else if (events.length === 0 && !existsSync(traceFile)) problem = "no trace was written";
      if (report === null || tr === undefined) {
        outcome = "error";
        problem ??= "no report was written (the test process crashed)";
      } else if (
        tr.status === "passed" &&
        code === 0 &&
        (report.unhandledErrors?.length ?? 0) === 0
      ) {
        outcome = "pass";
      } else if (tr.assertionResults?.some((a) => a.status === "failed")) {
        outcome = "fail";
      } else {
        outcome = "error";
        problem ??=
          `the test file failed without test results: ${tr.message ?? "no message"}`.slice(0, 500);
      }
      if (timedOut || spawnFailed) outcome = "error";
      return { task: opts.task, outcome, durationMs, events, problem, exitCode: code };
    }
  });
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

// @frontal-labs/incremental-process: runs named commands as tasks and records their outcome
// (spec/adapters/process.md, PLAN 10.4). Declared inputs are recorded by
// @frontal-labs/incremental-fs. The outcome is pass (exit 0), fail (non-zero exit) or error
// (the command could not run, was killed, or timed out).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  connect,
  defaultEngine,
  type incremental,
  type Outcome,
} from "@frontal-labs/incremental-client";
import {
  recordFiles,
  recordOracle,
  type CheckResult,
  type FileTask,
  type OracleFileTask,
  type OracleRun,
} from "@frontal-labs/incremental-fs";

export interface TaskConfig {
  // argv, not a shell line. The first entry is the program.
  command: string[];
  // Working directory, relative to the repository root. Default: the root.
  cwd?: string;
  // Repo-relative input paths the command is known to read.
  declared?: string[];
  // The caller asserts that `declared` is complete (see @frontal-labs/incremental-fs).
  complete?: boolean;
  // Run the command under the strace oracle and record its observed files,
  // dirs and probes instead of relying on declared inputs. Linux only;
  // ignored on other platforms (see @frontal-labs/incremental-fs oracleContext).
  oracle?: boolean;
}

export interface ProcessConfig {
  tasks: Record<string, TaskConfig>;
}

export interface TaskRun {
  task: string;
  outcome: Outcome;
  durationMs: number;
  problem: string | null;
  dirty: boolean;
}

export const CONFIG_FILE = "incremental-process.json";

// Reads `<root>/incremental-process.json`. Throws with a message on bad shape.
export function loadConfig(root: string): ProcessConfig {
  const file = path.join(root, CONFIG_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const tasks = (raw as { tasks?: unknown }).tasks;
  if (typeof tasks !== "object" || tasks === null || Array.isArray(tasks)) {
    throw new Error(`${file} needs a "tasks" object`);
  }
  for (const [name, t] of Object.entries(tasks)) {
    const c = (t as { command?: unknown }).command;
    if (!Array.isArray(c) || c.length === 0 || !c.every((x) => typeof x === "string")) {
      throw new Error(`task ${name} needs a non-empty "command" array of strings`);
    }
  }
  return raw as ProcessConfig;
}

// Runs argv with no shell. Output goes to the caller's terminal.
export function runCommand(
  command: readonly string[],
  cwd: string,
  timeoutMs: number,
): CheckResult {
  const started = Date.now();
  const [program, ...args] = command;
  if (program === undefined) return { outcome: "error", durationMs: 0, problem: "empty command" };
  const r = spawnSync(program, args, {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    timeout: timeoutMs,
  });
  const durationMs = Date.now() - started;
  if (r.error !== undefined) {
    const timedOut = (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return {
      outcome: "error",
      durationMs,
      problem: timedOut ? `timed out after ${timeoutMs} ms` : r.error.message,
    };
  }
  if (r.signal !== null) return { outcome: "error", durationMs, problem: `killed by ${r.signal}` };
  if (r.status === 0) return { outcome: "pass", durationMs, problem: null };
  return { outcome: "fail", durationMs, problem: `exit ${r.status}` };
}

// Runs one task and observes it. Throws when a declared path cannot be hashed
// or lies outside the root. No observation is recorded in that case.
export async function runTask(
  client: incremental,
  root: string,
  name: string,
  cfg: TaskConfig,
  opts: { baseline: string; timeoutMs: number },
  runOracle?: OracleRun,
): Promise<TaskRun> {
  if (cfg.oracle === true) {
    if (process.platform !== "linux") throw new Error("the strace oracle is Linux-only");
    if (runOracle === undefined) throw new Error("oracle: no strace runner wired to runTasks");
    const spec: OracleFileTask = {
      task: name,
      root,
      declared: [],
      complete: true,
      command: cfg.command,
      cwd: cfg.cwd,
      timeoutMs: opts.timeoutMs,
    };
    const rec = await recordOracle(client, spec, opts.baseline, runOracle);
    return {
      task: name,
      outcome: rec.result.outcome,
      durationMs: rec.result.durationMs,
      problem: rec.result.problem,
      dirty: rec.dirty,
    };
  }
  const spec: FileTask = {
    task: name,
    root,
    declared: cfg.declared ?? [],
    complete: cfg.complete === true,
  };
  const cwd = path.resolve(root, cfg.cwd ?? ".");
  const rec = await recordFiles(client, spec, opts.baseline, () =>
    runCommand(cfg.command, cwd, opts.timeoutMs),
  );
  return {
    task: name,
    outcome: rec.result.outcome,
    durationMs: rec.result.durationMs,
    problem: rec.result.problem,
    dirty: rec.dirty,
  };
}

export interface RunOptions {
  root: string;
  store: string;
  // Task names to run. Default: every task in the config.
  names?: string[];
  timeoutMs: number;
  // The strace oracle runner (PLAN §11.5). Required when a task sets
  // `oracle: true`; only used on Linux.
  runOracle?: OracleRun;
}

// Connects to the engine, runs the selected tasks in config order, and closes.
// A task that cannot be prepared is reported as an error, not observed.
export async function runTasks(opts: RunOptions): Promise<TaskRun[]> {
  const root = path.resolve(opts.root);
  const store = path.resolve(opts.store);
  const config = loadConfig(root);
  const names = opts.names ?? Object.keys(config.tasks);
  for (const n of names) {
    if (config.tasks[n] === undefined) throw new Error(`no task named ${n} in ${CONFIG_FILE}`);
  }
  const client = await connect({
    store,
    root,
    command: [defaultEngine(), "serve"],
    timeoutMs: 60_000,
  });
  try {
    const baseline = (await client.baseline()).baseline ?? headOf(root);
    const results: TaskRun[] = [];
    for (const name of names) {
      const cfg = config.tasks[name];
      if (cfg !== undefined) {
        try {
          results.push(
            await runTask(
              client,
              root,
              name,
              cfg,
              { baseline, timeoutMs: opts.timeoutMs },
              opts.runOracle,
            ),
          );
        } catch (e) {
          results.push({
            task: name,
            outcome: "error",
            durationMs: 0,
            problem: e instanceof Error ? e.message : String(e),
            dirty: true,
          });
        }
      }
    }
    return results;
  } finally {
    await client.close();
  }
}

// HEAD of the repository, used as the baseline before the store has one.
function headOf(root: string): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error("the store has no baseline and the repository has no HEAD");
  return r.stdout.trim();
}

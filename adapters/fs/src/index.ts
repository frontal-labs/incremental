// @incremental/fs: the generic file-read recorder (spec/adapters/fs.md, PLAN 11.1).
//
// There is no syscall tracer on macOS, so this recorder observes only the
// declared inputs of a task. Reads that are not declared are not observed. The
// observation is therefore dirty unless the caller asserts that the declaration
// is complete, and the context declares that probes, directory listings and
// environment reads are not recorded (caps false).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { incremental, Context, Input, Observation, Outcome } from "@incremental/client";

export const FS_VERSION = "0.1.0";

export type DeclaredInput = Extract<Input, { kind: "declared" }>;

export interface FileTask {
  // Stable task id (PLAN D-2). Never a path or a pid.
  task: string;
  // Repository root. Declared paths are relative to it.
  root: string;
  // Repo-relative paths the task is known to read.
  declared: string[];
  // The caller asserts that `declared` lists every file the task reads. The
  // recorder cannot check this. Without the assertion the observation is dirty.
  complete?: boolean;
}

export interface CheckResult {
  outcome: Outcome;
  durationMs: number;
  problem: string | null;
}

export interface Recorded {
  observation: Observation;
  dirty: boolean;
  result: CheckResult;
}

// The signature of a strace oracle runner, injected by the caller so that
// @incremental/fs has no hard dependency on @incremental/strace (the oracle is
// Linux-only). The runner observes one command and returns the paths it
// touched under the configured roots (PLAN §11.5).
export interface OracleRunOptions {
  roots: string[]; // absolute repo roots; observed paths must live under one
  cwd: string; // absolute cwd the command ran in
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}
export interface OracleResult {
  files: string[]; // repo-relative, sorted, unique
  dirs: string[];
  probes: string[];
  execs: string[];
}
export type OracleRun = (command: string[], opts: OracleRunOptions) => Promise<OracleResult>;

export interface OracleFileTask extends FileTask {
  // argv, not a shell line. Run under the strace oracle on Linux instead of
  // the `check` callback; `declared` is then redundant and ignored.
  command: string[];
  // Working directory, relative to the repository root. Default: the root.
  cwd?: string;
  timeoutMs?: number;
}

// Context of an oracle observation: strace sees files, dirs and probes, but
// not environment reads (PLAN 11.5).
export function oracleContext(): Context {
  return {
    lockfile: "none",
    tsconfig: "none",
    pkgjson: "none",
    runner: `incremental-fs@${FS_VERSION}`,
    node: process.version,
    fmt: 1,
    caps: { probes: true, dirs: true, env: false },
  };
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// The context of a file-read observation. Reserved tool keys are "none" because
// the declared list is the whole configuration. Probes, dirs and env are not
// recorded (PLAN 8.4).
export function contextFor(): Context {
  return {
    lockfile: "none",
    tsconfig: "none",
    pkgjson: "none",
    runner: `incremental-fs@${FS_VERSION}`,
    node: process.version,
    fmt: 1,
    caps: { probes: false, dirs: false, env: false },
  };
}

// Hashes each declared path now. A missing file is "absent" and is still an
// input, so creating it later invalidates the task. Throws for a path outside
// root or a path that cannot be read.
export function declaredInputs(root: string, declared: readonly string[]): DeclaredInput[] {
  const seen = new Map<string, DeclaredInput>();
  for (const rel of declared) {
    const abs = path.resolve(root, rel);
    const repoRel = path.relative(root, abs).split(path.sep).join("/");
    if (
      repoRel === "" ||
      repoRel === ".." ||
      repoRel.startsWith("../") ||
      path.isAbsolute(repoRel)
    ) {
      throw new Error(`declared path is outside the repository: ${rel}`);
    }
    const hash = existsSync(abs) ? sha256(readFileSync(abs)) : "absent";
    seen.set(repoRel, { kind: "declared", path: repoRel, hash });
  }
  return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Runs `check` once, between two hashings of the declared inputs. The observation
// records the hashes from before the check (the content the task was given). If
// any declared input changed while the check ran, or the caller did not assert
// completeness, the observation is dirty. Observes it through the client.
export async function recordFiles(
  client: incremental,
  spec: FileTask,
  baseline: string,
  check: () => CheckResult,
): Promise<Recorded> {
  const root = realpathSync(spec.root);
  const before = declaredInputs(root, spec.declared);
  const result = check();
  const after = declaredInputs(root, spec.declared);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  const dirty = changed || spec.complete !== true;
  const observation: Observation = {
    task: spec.task,
    baseline,
    dirty,
    context: contextFor(),
    inputs: before,
    outputs: [],
    outcome: result.outcome,
    duration_ms: result.durationMs,
  };
  await client.observe(observation);
  return { observation, dirty, result };
}

// Runs `command` under the strace oracle and records what it touched as the
// task's inputs (PLAN §11.5). Linux-only: the runner throws
// StraceUnavailableError on other platforms, which surfaces as an error
// observation. The observation is not dirty: the filesystem was fully
// observed; environment reads are not observable, hence caps.env false.
export async function recordOracle(
  client: incremental,
  spec: OracleFileTask,
  baseline: string,
  runOracle: OracleRun,
): Promise<Recorded> {
  const root = realpathSync(spec.root);
  const cwd = spec.cwd === undefined ? root : path.resolve(root, spec.cwd);
  const started = Date.now();
  let outcome: Outcome = "pass";
  let problem: string | null = null;
  let oracle: OracleResult = { files: [], dirs: [], probes: [], execs: [] };
  try {
    oracle = await runOracle(spec.command, { roots: [root], cwd, timeoutMs: spec.timeoutMs });
  } catch (e) {
    outcome = "error";
    problem = e instanceof Error ? e.message : String(e);
  }
  const durationMs = Date.now() - started;

  const files = new Map<string, string>();
  for (const rel of oracle.files) {
    const abs = path.join(root, rel);
    let hash = "absent";
    if (existsSync(abs)) {
      try {
        hash = sha256(readFileSync(abs));
      } catch {
        hash = "unreadable";
      }
    }
    files.set(rel, hash);
  }

  const inputs: Input[] = [];
  for (const p of [...files.keys()].sort())
    inputs.push({ kind: "file", path: p, hash: files.get(p) as string });
  for (const p of oracle.dirs) inputs.push({ kind: "dir", path: p });
  for (const p of oracle.probes) inputs.push({ kind: "probe", path: p });

  const observation: Observation = {
    task: spec.task,
    baseline,
    dirty: false,
    context: oracleContext(),
    inputs,
    outputs: [],
    outcome,
    duration_ms: durationMs,
  };
  await client.observe(observation);
  return { observation, dirty: false, result: { outcome, durationMs, problem } };
}

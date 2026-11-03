// @backplane/fs: the generic file-read recorder (spec/adapters/fs.md, PLAN 11.1).
//
// There is no syscall tracer on macOS, so this recorder observes only the
// declared inputs of a task. Reads that are not declared are not observed. The
// observation is therefore dirty unless the caller asserts that the declaration
// is complete, and the context declares that probes, directory listings and
// environment reads are not recorded (caps false).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { backplane, Context, Input, Observation, Outcome } from "@backplane/client";

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
    runner: `backplane-fs@${FS_VERSION}`,
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
    if (repoRel === "" || repoRel === ".." || repoRel.startsWith("../") || path.isAbsolute(repoRel)) {
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
  client: backplane,
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

// The env adapter runner. It records one observation per task with the env inputs of its
// allowlist, and queries the plan with the hash map of every name the tasks recorded.
// The process environment is passed in, so a test never mutates process.env.
import type { incremental, Change, Context, Observation, Outcome, Plan } from "@incremental/client";
import { type Env, envInputs, queryEnv } from "./env.js";

export interface EnvTask {
  id: string;
  // Environment variable names this task's observation depends on (the allowlist).
  names: string[];
  // Also record a snapshot of every variable (D-E1-02).
  envAll?: boolean;
  outcome?: Outcome;
}

export interface EnvRunOptions {
  baseline: string;
  context: Context;
  env: Env;
  tasks: EnvTask[];
}

export function observationsFor(opts: EnvRunOptions): Observation[] {
  return opts.tasks.map((t) => ({
    task: t.id,
    baseline: opts.baseline,
    dirty: false,
    context: opts.context,
    inputs: envInputs(opts.env, t.names, t.envAll === true),
    outputs: [],
    outcome: t.outcome ?? "pass",
    duration_ms: 0,
  }));
}

export async function recordTasks(client: incremental, opts: EnvRunOptions): Promise<number> {
  const observations = observationsFor(opts);
  if (observations.length === 0) return 0;
  return (await client.observeMany(observations)).accepted;
}

// The affected query for the given changes (possibly none) with the env hash map. A
// variable that the tasks did not record is never compared by the engine (P2b).
export async function planEnv(
  client: incremental,
  opts: Omit<EnvRunOptions, "tasks"> & { tasks: EnvTask[]; changes?: Change[] },
): Promise<Plan> {
  const names = opts.tasks.flatMap((t) => t.names);
  const envAll = opts.tasks.some((t) => t.envAll === true);
  return client.affected(
    { baseline: opts.baseline, changes: opts.changes ?? [] },
    { baseline: opts.baseline, context: opts.context, env: queryEnv(opts.env, names, envAll) },
  );
}

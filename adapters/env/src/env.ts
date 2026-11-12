// The env adapter's hashing (spec/adapters/env.md, PLAN 8.4, D-E1-02). Each allowlisted
// variable becomes an `env` input with value_hash, and "unset" for a missing variable.
// env_all records a snapshot of every variable. Values are hashed, never stored.
import { createHash } from "node:crypto";
import type { Context, Input } from "@incremental/client";

export const ENV_RUNNER = "env@0.1.0";
export const UNSET = "unset";

export type Env = Record<string, string | undefined>;

export function valueHash(value: string | undefined): string {
  return value === undefined ? UNSET : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// Hash map of the variables that are set, for the names given (the query's `env`).
export function hashNames(env: Env, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...new Set(names)].sort()) {
    const value = env[name];
    if (value !== undefined) out[name] = valueHash(value);
  }
  return out;
}

// Hash map of every variable that is set (the env_all snapshot).
export function hashAll(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(env).sort()) {
    const value = env[name];
    if (value !== undefined) out[name] = valueHash(value);
  }
  return out;
}

// Inputs for one observation: one `env` input per allowlisted name, plus an `env_all`
// snapshot when requested. Names are sorted so observations are stable.
export function envInputs(env: Env, names: readonly string[], envAll: boolean): Input[] {
  const inputs: Input[] = [...new Set(names)]
    .sort()
    .map((name) => ({ kind: "env", name, value_hash: valueHash(env[name]) }));
  if (envAll) inputs.push({ kind: "env_all", snapshot: hashAll(env) });
  return inputs;
}

// The `env` map of an affected query: every hashed variable the plan may compare.
export function queryEnv(
  env: Env,
  names: readonly string[],
  envAll: boolean,
): Record<string, string> {
  return envAll ? hashAll(env) : hashNames(env, names);
}

// The context (PLAN 8.4). caps.env is true only when env_all is in use, because only then
// is every variable the task could see compared. Reads of unlisted variables are never
// observed (see README.md), so caps.env is not a claim about individual reads.
export function contextFor(envAll: boolean): Context {
  return {
    lockfile: "absent",
    tsconfig: "absent",
    pkgjson: "absent",
    runner: ENV_RUNNER,
    node: process.version,
    fmt: 1,
    caps: { probes: false, dirs: false, env: envAll },
  };
}

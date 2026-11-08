// Context and hashing for affected_tasks (plans/PLAN.md 6.2, 8.4, 11.8).
// The server sends the same context on every query, so context_missing never
// fires through MCP. Hashes use the adapter convention "sha256:" + hex.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Context } from "@frontal-labs/incremental-client";

// Value used for a repo file that does not exist.
export const ABSENT = "absent";
// The runner the MCP path records and queries with (PLAN 11.8).
export const RUNNER = "vitest@4.1.12";
// Lockfiles in the order the server looks for them (PLAN 6.7 globalInputs).
export const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"] as const;

export function sha256(data: string | Uint8Array): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

// Hash of a repo file, or ABSENT when it does not exist.
export function hashRepoFile(root: string, rel: string): string {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return ABSENT;
  return sha256(fs.readFileSync(file));
}

// The context of a query at the repo root: lockfile, tsconfig.json and
// package.json hashes, the fixed runner, the node version, fmt 1 and caps.
export function buildContext(root: string): Context {
  const lockfile = LOCKFILES.find((f) => fs.existsSync(path.join(root, f)));
  return {
    lockfile: lockfile === undefined ? ABSENT : hashRepoFile(root, lockfile),
    tsconfig: hashRepoFile(root, "tsconfig.json"),
    pkgjson: hashRepoFile(root, "package.json"),
    runner: RUNNER,
    node: process.version,
    fmt: 1,
    caps: { probes: true, dirs: true, env: true },
  };
}

// The client's environment as a hash map {NAME: value_hash} (POLICY section 1).
export function envHashes(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string") out[name] = sha256(value);
  }
  return out;
}

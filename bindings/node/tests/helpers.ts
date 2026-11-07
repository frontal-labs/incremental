// Shared helpers for the binding tests. Compiled to dist/tests/helpers.js.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connect,
  defaultEngine,
  type incremental,
  type Change,
  type Context,
  type Plan,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> repository root (four levels up).
export const REPO = path.resolve(here, "..", "..", "..", "..");
export const ENGINE = defaultEngine();
export const CASES_DIR = path.join(REPO, "conformance", "cases");
export const WORKTREES = path.join(REPO, "conformance", "worktrees");
export const SILENT_ENGINE = path.resolve(
  here,
  "..",
  "..",
  "tests",
  "fixtures",
  "silent-engine.mjs",
);

// Fields of a conformance case that the runner reads (conformance/run.mjs).
export interface SeedMsg {
  method: string;
  params: Record<string, unknown>;
}

export interface QueryFile {
  baseline: string;
  context?: Context;
  env?: Record<string, string>;
  changes: Change[];
  verify?: boolean;
  declared_tasks?: string[];
}

export interface CaseFile {
  id: string;
  desc: string;
  mode?: "balanced" | "conservative";
  store: { from: string; append?: SeedMsg[] };
  config?: Record<string, unknown>;
  worktree?: string;
  query?: QueryFile;
  expect: Record<string, unknown>;
  determinism?: "repeat" | "shuffle" | "cache" | "index";
  action?: SeedMsg & { id?: number };
  raw_lines?: string[];
  post_raw_log?: string;
  kind?: string;
  writers?: number;
  per_writer?: number;
  requires?: string;
}

export function loadCases(): CaseFile[] {
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), "utf8")) as CaseFile);
}

export function worktreeOf(c: CaseFile): string {
  return path.join(WORKTREES, c.worktree ?? "base");
}

export function readJsonl(file: string): SeedMsg[] {
  return fs
    .readFileSync(path.join(REPO, file), "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as SeedMsg);
}

// Seed messages of a case: the store.from file, then store.append.
export function seedsOf(c: CaseFile): SeedMsg[] {
  return [...readJsonl(c.store.from), ...(c.store.append ?? [])];
}

// Applies protocol messages through the client, in order.
export async function replay(client: incremental, msgs: SeedMsg[]): Promise<void> {
  for (const m of msgs) {
    const p = m.params;
    if (m.method === "observe") {
      await client.observe(p.observation as never);
    } else if (m.method === "advance") {
      await client.advance(p.to as string, p.expected as string | null);
    } else {
      throw new Error(`replay: method ${m.method} is not used by the seeds`);
    }
  }
}

export function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `incremental-${label}-`));
}

// A new store directory created by the engine's `init` command.
export function initStore(label: string): string {
  const dir = path.join(tempDir(label), "store");
  const r = spawnSync(ENGINE, ["init", "--store", dir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
  return dir;
}

// Runs fn on a fresh connection and closes it afterwards.
export async function once<T>(
  store: string,
  root: string,
  fn: (c: incremental) => Promise<T>,
): Promise<T> {
  const c = await connect({ store, root });
  try {
    return await fn(c);
  } finally {
    await c.close();
  }
}

export function sameJSON(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Differences between a plan and a case's expect block (conformance/run.mjs comparePlan).
export function comparePlan(plan: Plan, expect: Record<string, unknown>): string[] {
  const diffs: string[] = [];
  const keys = [
    "tasks",
    "unobserved",
    "ignored",
    "deleted_tasks",
    "fallback",
    "confidence",
  ] as const;
  for (const key of keys) {
    if (key in expect) {
      const got = (plan as unknown as Record<string, unknown>)[key];
      if (!sameJSON(got, expect[key])) {
        diffs.push(`${key}: want ${JSON.stringify(expect[key])} got ${JSON.stringify(got)}`);
      }
    }
  }
  return diffs;
}

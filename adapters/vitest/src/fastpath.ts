// T-05 (issue #38): skip-when-clean fast path with store checks.
//
// The original T-05 (PR #32) skipped whenever the worktree was clean and the
// store baseline equaled HEAD, without reading the store. That was unsafe:
//   - env changes (conformance C14/C15) went undetected
//   - dirty observations (worker-thread tests) were silently dropped
//   - stored `fail` outcomes (policy P9) were not invalidated
//   - multi-record baselines were mishandled
//
// This version reads the store log directly (no engine spawn) and only skips
// when the store proves the plan is empty:
//   1. The last `baseline` record's `value` equals the current HEAD
//   2. The worktree is clean
//   3. No observations at the baseline have `dirty: true` or `outcome: "fail"`
//   4. No env/env_all observations at the baseline differ from the current env
//   5. No deleted or renamed test files in the changeset
//
// The store log is JSONL with flattened records:
//   {"r":"hdr","v":1,...}            — header (ignored)
//   {"r":"obs","task":...,"baseline":...,"dirty":...,"outcome":...,"inputs":[...],...}
//   {"r":"baseline","value":"..."}   — advance (last one wins)
//
// Any doubt falls through to the full path — the worst case is no speedup,
// never a wrong skip.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Change, Context } from "@incremental/client";

import { TEST_FILE, isTrackedEnv, sha256 } from "./shared.js";

export interface FastPathCheck {
  root: string;
  store: string;
  head: string;
  dirty: boolean;
  changes: Change[];
  context: Context;
  env: NodeJS.ProcessEnv;
  // The env hashes already computed by the caller (envHashes(env)).
  envHashes: Record<string, string>;
}

export interface FastPathResult {
  skip: boolean;
  reason: string;
}

interface StoreObservation {
  task: string;
  baseline: string;
  dirty: boolean;
  outcome: string;
  inputs: Array<Record<string, unknown>>;
}

interface StoreInput {
  kind: string;
  name?: string;
  value_hash?: string;
  snapshot?: Record<string, string>;
}

// Reads the store log and applies records in order, tracking:
//   - the last `baseline` record's `value` (the effective baseline)
//   - the latest observation per task (the engine keeps the last one)
// Returns null if the store is missing or unreadable.
function readStore(
  store: string,
): { baseline: string | null; latestObservations: Map<string, StoreObservation> } | null {
  const logPath = path.join(store, "tg.log");
  let raw: string;
  try {
    raw = readFileSync(logPath, "utf8");
  } catch {
    return null;
  }

  let baseline: string | null = null;
  const latestObservations = new Map<string, StoreObservation>();

  for (const line of raw.split("\n")) {
    if (line === "") continue;

    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const r = rec.r as string | undefined;
    if (r === "baseline") {
      if (typeof rec.value === "string") baseline = rec.value;
    } else if (r === "obs") {
      const task = rec.task as string | undefined;
      const obsBaseline = rec.baseline as string | undefined;
      const outcome = rec.outcome as string | undefined;
      if (typeof task !== "string" || typeof obsBaseline !== "string" || typeof outcome !== "string")
        continue;

      const inputs = Array.isArray(rec.inputs)
        ? (rec.inputs as Array<Record<string, unknown>>)
        : [];

      latestObservations.set(task, {
        task,
        baseline: obsBaseline,
        dirty: rec.dirty === true,
        outcome,
        inputs,
      });
    }
  }

  return { baseline, latestObservations };
}

function hasDeletedTestFiles(changes: Change[]): boolean {
  for (const c of changes) {
    if (c.status === "deleted" && TEST_FILE.test(c.path)) return true;
    if (
      c.status === "renamed" &&
      c.old_path !== undefined &&
      TEST_FILE.test(c.old_path)
    )
      return true;
  }
  return false;
}

function envMatches(
  observation: StoreObservation,
  currentEnv: NodeJS.ProcessEnv,
): boolean {
  for (const input of observation.inputs) {
    if (input.kind === "env") {
      const name = typeof input.name === "string" ? input.name : null;
      const storedHash = typeof input.value_hash === "string" ? input.value_hash : null;
      if (name === null || storedHash === null) return false;
      if (!isTrackedEnv(name)) continue;
      const current = currentEnv[name];
      if (current === undefined) {
        // The stored hash must indicate "unset" for a missing env var.
        if (storedHash !== "unset" && storedHash !== sha256("")) return false;
      } else {
        if (storedHash !== sha256(current)) return false;
      }
    } else if (input.kind === "env_all") {
      const snapshot = input.snapshot as Record<string, string> | undefined;
      if (snapshot === undefined || typeof snapshot !== "object") return false;
      // Every key in the stored snapshot must match the current env.
      for (const [name, storedHash] of Object.entries(snapshot)) {
        if (!isTrackedEnv(name)) continue;
        const current = currentEnv[name];
        if (current === undefined) {
          if (storedHash !== "unset" && storedHash !== sha256("")) return false;
        } else {
          if (storedHash !== sha256(current)) return false;
        }
      }
      // Every tracked env var in the current env must be in the snapshot.
      for (const name of Object.keys(currentEnv)) {
        if (!isTrackedEnv(name)) continue;
        if (!(name in snapshot)) return false;
      }
    }
  }
  return true;
}

export function fastPathCheck(check: FastPathCheck): FastPathResult {
  // 1. Read the store.
  const storeData = readStore(check.store);
  if (storeData === null) {
    return { skip: false, reason: "store missing or unreadable" };
  }

  // 2. The last advance must equal the current HEAD.
  if (storeData.baseline === null) {
    return { skip: false, reason: "no baseline in store" };
  }
  if (storeData.baseline !== check.head) {
    return { skip: false, reason: `baseline ${storeData.baseline} != head ${check.head}` };
  }

  // 3. The worktree must be clean.
  if (check.dirty) {
    return { skip: false, reason: "worktree is dirty" };
  }

  // 4. No deleted or renamed test files.
  if (hasDeletedTestFiles(check.changes)) {
    return { skip: false, reason: "deleted or renamed test files present" };
  }

  // 5. No observations at the baseline with dirty: true or outcome: "fail".
  //    The engine re-selects dirty tasks and fail outcomes (policy P9) on
  //    every run, so a skip would silently drop them.
  for (const [, obs] of storeData.latestObservations) {
    if (obs.baseline !== check.head) continue;
    if (obs.dirty) {
      return { skip: false, reason: `dirty observation for ${obs.task}` };
    }
    if (obs.outcome === "fail") {
      return { skip: false, reason: `stored fail for ${obs.task}` };
    }
  }

  // 6. Env observations at the baseline must match the current env.
  //    This covers both `env` (tracked vars) and `env_all` (full snapshot)
  //    inputs, matching conformance cases C14 (env changed) and C15
  //    (env_all changed).
  for (const [, obs] of storeData.latestObservations) {
    if (obs.baseline !== check.head) continue;
    if (!obs.inputs.some((i) => i.kind === "env" || i.kind === "env_all")) continue;
    if (!envMatches(obs, check.env)) {
      return { skip: false, reason: `env mismatch for ${obs.task}` };
    }
  }

  return { skip: true, reason: "store proves plan is empty" };
}

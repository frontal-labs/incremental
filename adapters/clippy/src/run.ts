#!/usr/bin/env node
// `incremental-clippy run`: the Cargo/Clippy adapter loop (PLAN 10.4).
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (incremental-git)
//   plan = affected(ch, context, declared tasks)
//   forget the tasks whose Cargo.toml was deleted
//   run `cargo clippy -p <member> --all-targets` for each selected member and observe it
//   advance to HEAD only if every selected task ran, the worktree is clean
//   and HEAD did not move; otherwise exit 7 (ran, not advanced).
//
// Exit codes: 0 ok and advanced; 1 a crate failed clippy or rustc (advanced when
// allowed); 2 usage error; 4 engine or setup error; 7 ran but not advanced.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  connect,
  defaultEngine,
  isIncrementalError,
  repoRoot,
  type Change,
  type Context,
  type Fallback,
  type Observation,
  type Outcome,
  type Plan,
} from "@incremental/client";
import { clippy, CargoError, toolchain, workspaceOf, type ClippyRun } from "./cargo.js";
import { inside, memberTasks, observeTask, sha256, taskId } from "./project.js";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  // Timeout for one clippy run, in milliseconds.
  timeoutMs: number;
  // Cargo target directory. Default: <store>/clippy-target (outside the worktree's tracked files).
  targetDir?: string;
}

export interface ProjectRun {
  task: string;
  outcome: Outcome;
  durationMs: number;
  problem: string | null;
  dirty: boolean;
  reasons: string[];
}

export interface RunReport {
  mode: "run" | "all";
  root: string;
  stored: string | null;
  base: string | null;
  head: string;
  headEnd: string;
  dirty: boolean;
  changes: Change[];
  plan: Plan | null;
  fallback: Fallback | null;
  selected: string[];
  discovered: string[];
  results: ProjectRun[];
  observed: number;
  advanced: boolean;
  notAdvanced: string[];
  exit: number;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

interface GitChangeSet {
  baseline: string;
  head: string;
  dirty: boolean;
  changes: Change[];
}

// The git change source (PLAN 11.7). Throws an Error on failure.
function gitSourcePath(): string {
  return process.env.INCREMENTAL_GIT || path.join(repoRoot(), "adapters", "git", "dist", "incremental-git");
}

function gitChangeSet(root: string, ref: string): GitChangeSet {
  const r = spawnSync(gitSourcePath(), ["changes", "--base", ref, "--root", root], { encoding: "utf8" });
  if (r.error !== undefined) throw new Error(`cannot run the git change source: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git change source failed (exit ${r.status}): ${(r.stdout || r.stderr || "").trim()}`);
  return JSON.parse(r.stdout) as GitChangeSet;
}

function hashOrAbsent(file: string): string {
  return existsSync(file) ? sha256(readFileSync(file)) : "absent";
}

// The context (PLAN 8.4). Cargo reads the toolchain from the environment unless
// rust-toolchain.toml pins it, so the toolchain identity is always in the context.
// The reserved keys tsconfig and node do not apply to Cargo and are fixed to "n/a".
// Environment reads and directory listings are not observed here, so those
// capabilities are false.
export function contextFor(root: string, wsRoot: string): Context {
  return {
    lockfile: hashOrAbsent(path.join(wsRoot, "Cargo.lock")),
    tsconfig: "n/a",
    pkgjson: hashOrAbsent(path.join(wsRoot, "Cargo.toml")),
    runner: toolchain(root),
    node: "n/a",
    fmt: 1,
    caps: { probes: false, dirs: false, env: false },
  };
}

function ensureStore(store: string): void {
  if (existsSync(store)) return;
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0) throw new UsageError(`cannot create the store at ${store}: ${(r.stderr || "").trim()}`);
}

// Outcome of one clippy run. Pass: cargo exits 0. Fail: cargo exits 101 with an
// error-level diagnostic (a deny lint or a rustc error). Error: anything else,
// including a timeout or a run that never produced the diagnostics it should.
export function outcomeOf(run: ClippyRun): { outcome: Outcome; problem: string | null } {
  if (run.error !== null) return { outcome: "error", problem: run.error };
  if (run.signal !== null) return { outcome: "error", problem: `killed by ${run.signal}` };
  if (run.status === 0) return { outcome: "pass", problem: null };
  const errors = run.messages.filter((m) => m.reason === "compiler-message" && (m.message as { level?: string }).level === "error");
  if (run.status === 101 && errors.length > 0) {
    const first = (errors[0]?.message as { message?: string } | undefined)?.message ?? "error";
    return { outcome: "fail", problem: `cargo clippy reported errors: ${first}` };
  }
  return { outcome: "error", problem: `cargo exited ${run.status}: ${run.stderr.trim().split("\n").pop() ?? ""}`.trim() };
}

export async function runAdapter(opts: RunOptions): Promise<RunReport> {
  // Canonical paths: cargo reports realpaths (on macOS /var is /private/var), and
  // the input paths must match them.
  const root = realpathSync(path.resolve(opts.root));
  const store = path.resolve(opts.store);
  ensureStore(store);
  const targetDir = path.resolve(opts.targetDir ?? path.join(realpathSync(store), "clippy-target"));

  let ws;
  try {
    ws = workspaceOf(root);
  } catch (e) {
    throw e instanceof CargoError ? e : new UsageError(e instanceof Error ? e.message : String(e));
  }
  if (!inside(root, ws.root)) throw new UsageError(`the cargo workspace ${ws.root} is outside the repository`);
  const members = memberTasks(ws, root);
  const discovered = members.map((m) => m.task);
  const context = contextFor(root, ws.root);

  let head0: GitChangeSet;
  try {
    head0 = gitChangeSet(root, "HEAD");
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }

  const client = await connect({ store, root, command: [defaultEngine(), "serve"], timeoutMs: 60_000 });
  try {
    const stored = (await client.baseline()).baseline;

    let cs: GitChangeSet | null = null;
    let gitError: string | null = null;
    try {
      cs = gitChangeSet(root, opts.base ?? stored ?? "HEAD");
    } catch (e) {
      gitError = e instanceof Error ? e.message : String(e);
    }
    if (cs === null && (opts.base !== undefined || stored === null)) {
      throw new UsageError(gitError ?? "the git change source failed");
    }
    if (cs !== null && opts.base !== undefined && stored !== null && cs.baseline !== stored) {
      throw new UsageError(`--base resolves to ${cs.baseline}, but the store baseline is ${stored}`);
    }

    let plan: Plan | null = null;
    if (cs !== null) {
      plan = await client.affected(
        { baseline: cs.baseline, head: cs.head, changes: cs.changes },
        { baseline: cs.baseline, context, declared_tasks: discovered, verify: false, policy: "balanced" },
      );
    }

    // A deleted Cargo.toml removes its task (the crate left the workspace or the repository).
    const deleted = new Set<string>(plan?.deleted_tasks ?? []);
    const taskOfManifest = (p: string): string => taskId(root, path.join(root, path.posix.dirname(p)));
    for (const c of cs?.changes ?? []) {
      if (c.status === "deleted" && path.posix.basename(c.path) === "Cargo.toml") deleted.add(taskOfManifest(c.path));
      if (c.status === "renamed" && c.old_path !== undefined && path.posix.basename(c.old_path) === "Cargo.toml") {
        deleted.add(taskOfManifest(c.old_path));
      }
    }
    for (const t of [...deleted].sort()) await client.forget(t);

    const runAll = opts.all || plan === null || plan.fallback !== null;
    const planned = new Set((plan?.tasks ?? []).map((t) => t.id));
    const selectedMembers = runAll ? members : members.filter((m) => planned.has(m.task));
    const selected = selectedMembers.map((m) => m.task);

    const results: ProjectRun[] = [];
    const observations: Observation[] = [];
    const obsBaseline = stored ?? head0.head;
    for (const { task, member } of selectedMembers) {
      const run = clippy(root, member.name, targetDir, opts.timeoutMs);
      const { outcome, problem } = outcomeOf(run);
      const seen = observeTask({ root, ws, member, messages: run.messages, targetDir });
      results.push({ task, outcome, durationMs: run.durationMs, problem, dirty: seen.dirty, reasons: seen.reasons });
      observations.push({
        task,
        baseline: obsBaseline,
        dirty: seen.dirty,
        context,
        inputs: seen.inputs,
        outputs: [],
        outcome,
        duration_ms: run.durationMs,
      });
    }

    const end = gitChangeSet(root, "HEAD");
    const dirty = end.dirty;
    const headEnd = end.head;
    if (dirty) for (const o of observations) o.dirty = true;

    const allRan = results.every((r) => r.outcome !== "error");
    const canAdvance = allRan && !dirty && headEnd === head0.head;
    if (observations.length > 0) await client.observeMany(observations);
    let advanced = false;
    if (canAdvance) {
      if (headEnd !== stored) await client.advance(headEnd, stored);
      advanced = true;
    }

    const notAdvanced: string[] = [];
    if (!canAdvance) {
      for (const r of results) if (r.outcome === "error") notAdvanced.push(`error: ${r.task}${r.problem ? ` (${r.problem})` : ""}`);
      if (dirty) notAdvanced.push("the worktree is dirty at the end of the run");
      if (headEnd !== head0.head) notAdvanced.push("HEAD moved during the run");
    }
    const failed = results.some((r) => r.outcome === "fail");
    const exit = !advanced ? 7 : failed ? 1 : 0;

    return {
      mode: opts.all ? "all" : "run",
      root,
      stored,
      base: cs?.baseline ?? null,
      head: head0.head,
      headEnd,
      dirty,
      changes: cs?.changes ?? [],
      plan,
      fallback: plan?.fallback ?? (runAll && plan === null ? { action: "run_all", reason: "git_source" } : null),
      selected,
      discovered,
      results,
      observed: observations.length,
      advanced,
      notAdvanced,
      exit,
    };
  } finally {
    await client.close();
  }
}

interface ParsedArgs {
  opts: RunOptions;
  json: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [cmd, ...rest] = argv;
  if (cmd !== "run") {
    throw new UsageError("usage: incremental-clippy run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--target-dir DIR] [--timeout MS]");
  }
  const opts: RunOptions = { root: process.cwd(), store: "", all: false, timeoutMs: 600_000 };
  let json = false;
  let storeGiven = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    const value = (): string => {
      const v = rest[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "--base": opts.base = value(); break;
      case "--json": json = true; break;
      case "--all": opts.all = true; break;
      case "--store": opts.store = value(); storeGiven = true; break;
      case "--root": opts.root = value(); break;
      case "--target-dir": opts.targetDir = value(); break;
      case "--timeout": {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) throw new UsageError("--timeout needs a positive integer");
        opts.timeoutMs = n;
        break;
      }
      default: throw new UsageError(`unknown option ${a}`);
    }
  }
  opts.root = path.resolve(opts.root);
  if (!storeGiven) opts.store = process.env.INCREMENTAL_STORE || path.join(opts.root, ".incremental");
  return { opts, json };
}

function printText(r: RunReport): void {
  const counts: Record<Outcome, number> = { pass: 0, fail: 0, error: 0, none: 0 };
  for (const t of r.results) counts[t.outcome]++;
  const lines = [
    `incremental clippy ${r.mode}: stored ${r.stored ?? "none"}, query ${r.base ?? "none"}, head ${r.headEnd}${r.dirty ? " (dirty)" : ""}`,
  ];
  if (r.fallback !== null) lines.push(`fallback: ${r.fallback.reason}`);
  else if (r.plan !== null) lines.push(`plan: ${r.plan.tasks.length} invalid of ${r.plan.total_tasks}, confidence ${r.plan.confidence}`);
  lines.push(`checked ${r.results.length}: pass ${counts.pass}, fail ${counts.fail}, error ${counts.error}`);
  for (const t of r.results) {
    if (t.outcome !== "pass") lines.push(`  ${t.outcome} ${t.task}${t.problem ? ` (${t.problem})` : ""}`);
    if (t.dirty) lines.push(`  dirty ${t.task}: ${t.reasons.join("; ")}`);
  }
  lines.push(r.advanced ? `advanced to ${r.headEnd}` : `not advanced: ${r.notAdvanced.join("; ")}`);
  lines.push(`exit ${r.exit}`);
  process.stdout.write(lines.join("\n") + "\n");
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  try {
    const report = await runAdapter(parsed.opts);
    if (parsed.json) process.stdout.write(JSON.stringify(report) + "\n");
    else printText(report);
    return report.exit;
  } catch (e) {
    const code = e instanceof UsageError ? "invalid_params" : isIncrementalError(e) ? e.code : "internal";
    const message = e instanceof Error ? e.message : String(e);
    if (parsed.json) process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + "\n");
    process.stderr.write(`incremental clippy: ${message}\n`);
    return e instanceof UsageError ? 2 : 4;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

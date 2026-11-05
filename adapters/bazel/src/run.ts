#!/usr/bin/env node
// `incremental-bazel run`: the Bazel adapter loop (PLAN 10.4). Tasks are test targets.
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (incremental-git)
//   plan = affected(ch, context, declared test targets)
//   forget the targets that are gone (deleted, or no longer tests)
//   run each selected target with `bazel test --nocache_test_results` and observe it
//   advance to HEAD only if every selected target ran, the worktree is clean
//   and HEAD did not move; otherwise exit 7 (ran, not advanced).
//
// Exit codes: 0 ok and advanced; 1 a target failed (advanced when allowed);
// 2 usage error; 4 engine or setup error; 7 ran but not advanced.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  type Input,
  type Observation,
  type Outcome,
  type Plan,
} from "@incremental/client";
import {
  bazelBin,
  bazelVersion,
  DECLARED_FILES,
  discoverTests,
  hashOrAbsent,
  remoteEnabled,
  runTest,
  sha256,
  taskInputs,
} from "./bazel.js";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  // Timeout for one bazel command, in milliseconds.
  timeoutMs: number;
}

export interface TargetRun {
  task: string;
  outcome: Outcome;
  durationMs: number;
  problem: string | null;
}

export interface RunReport {
  mode: "run" | "all";
  root: string;
  stored: string | null;
  base: string | null;
  head: string;
  headEnd: string;
  dirty: boolean;
  remote: string[];
  changes: Change[];
  plan: Plan | null;
  fallback: Fallback | null;
  selected: string[];
  discovered: string[];
  results: TargetRun[];
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

// The git change source (PLAN 11.7). Throws on failure.
function gitSourcePath(): string {
  return process.env.INCREMENTAL_GIT || path.join(repoRoot(), "adapters", "git", "dist", "incremental-git");
}

function gitChangeSet(root: string, ref: string): GitChangeSet {
  const r = spawnSync(gitSourcePath(), ["changes", "--base", ref, "--root", root], { encoding: "utf8" });
  if (r.error !== undefined) throw new Error(`cannot run the git change source: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git change source failed (exit ${r.status}): ${(r.stdout || r.stderr || "").trim()}`);
  return JSON.parse(r.stdout) as GitChangeSet;
}

// The context (PLAN 8.4). This adapter does not observe environment reads or
// directory listings (glob expansion is not recorded), so those capabilities are
// false. The reserved tsconfig and pkgjson keys do not apply to Bazel.
export function contextFor(root: string): Context {
  return {
    lockfile: hashOrAbsent(path.join(root, "MODULE.bazel.lock")),
    tsconfig: "absent",
    pkgjson: "absent",
    runner: `bazel@${bazelVersion(root)}`,
    node: process.version,
    fmt: 1,
    caps: { probes: false, dirs: false, env: false },
  };
}

function ensureStore(store: string): void {
  if (existsSync(store)) return;
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0) throw new UsageError(`cannot create the store at ${store}: ${(r.stderr || "").trim()}`);
}

type FileInput = Extract<Input, { kind: "file" }>;
type DeclaredInput = Extract<Input, { kind: "declared" }>;

function declaredInputs(root: string): DeclaredInput[] {
  return DECLARED_FILES.filter((f) => existsSync(path.join(root, f))).map((f) => ({
    kind: "declared",
    path: f,
    hash: sha256(readFileSync(path.join(root, f))),
  }));
}

// Observes one target before it runs. Returns the inputs and whether the
// observation is dirty: an external repository is read but the lockfile does
// not pin it, or some input could not be named repo-relative.
function observeTarget(root: string, label: string, timeoutMs: number, declared: DeclaredInput[]): { inputs: Input[]; dirty: boolean } {
  const ti = taskInputs(root, label, timeoutMs);
  const lockPinned = existsSync(path.join(root, "MODULE.bazel.lock"));
  const dirty = ti.unobservable.length > 0 || (ti.external.length > 0 && !lockPinned);
  const files: FileInput[] = ti.files.map((p) => {
    const abs = path.join(root, p);
    return { kind: "file", path: p, hash: sha256(readFileSync(abs)) };
  });
  return { inputs: [...files, ...declared], dirty };
}

export async function runAdapter(opts: RunOptions): Promise<RunReport> {
  const root = path.resolve(opts.root);
  const store = path.resolve(opts.store);
  ensureStore(store);

  const context = contextFor(root);
  const remote = remoteEnabled(root, ["--nocache_test_results"], opts.timeoutMs);
  const declared = declaredInputs(root);
  const discovered = discoverTests(root, opts.timeoutMs);

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
        {
          baseline: cs.baseline,
          context,
          declared_tasks: discovered,
          verify: false,
          policy: "balanced",
          config: { globalInputs: DECLARED_FILES },
        },
      );
    }

    // Targets the plan names that are no longer tests (deleted, or the BUILD file
    // changed their kind) are forgotten, so a stale observation cannot stand.
    const discoveredSet = new Set(discovered);
    const gone = new Set<string>(plan?.deleted_tasks ?? []);
    for (const t of plan?.tasks ?? []) if (!discoveredSet.has(t.id)) gone.add(t.id);
    for (const t of [...gone].sort()) await client.forget(t);

    const runAll = opts.all || plan === null || plan.fallback !== null;
    const planned = new Set((plan?.tasks ?? []).map((t) => t.id));
    const selected = runAll ? discovered : discovered.filter((t) => planned.has(t));

    const results: TargetRun[] = [];
    const observations: Observation[] = [];
    const obsBaseline = stored ?? head0.head;
    for (const task of selected) {
      let obs: { inputs: Input[]; dirty: boolean };
      try {
        obs = observeTarget(root, task, opts.timeoutMs, declared);
      } catch (e) {
        const problem = e instanceof Error ? e.message : String(e);
        results.push({ task, outcome: "error", durationMs: 0, problem });
        continue;
      }
      const run = runTest(root, task, opts.timeoutMs);
      results.push({ task, outcome: run.outcome, durationMs: run.durationMs, problem: run.problem });
      observations.push({
        task,
        baseline: obsBaseline,
        dirty: obs.dirty || remote.length > 0,
        context,
        inputs: obs.inputs,
        outputs: [],
        outcome: run.outcome,
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
      if (dirty) notAdvanced.push(`the worktree is dirty at the end of the run (${end.changes.map((c) => c.path).join(", ")})`);
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
      remote,
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
  if (cmd !== "run") throw new UsageError("usage: incremental-bazel run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]");
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
    `incremental bazel ${r.mode}: stored ${r.stored ?? "none"}, query ${r.base ?? "none"}, head ${r.headEnd}${r.dirty ? " (dirty)" : ""}`,
  ];
  if (r.remote.length > 0) lines.push(`remote execution configured, observations dirty: ${r.remote.join(" ")}`);
  if (r.fallback !== null) lines.push(`fallback: ${r.fallback.reason}`);
  else if (r.plan !== null) lines.push(`plan: ${r.plan.tasks.length} invalid of ${r.plan.total_tasks}, confidence ${r.plan.confidence}`);
  lines.push(`checked ${r.results.length}: pass ${counts.pass}, fail ${counts.fail}, error ${counts.error}`);
  for (const t of r.results) if (t.outcome !== "pass") lines.push(`  ${t.outcome} ${t.task}${t.problem ? ` (${t.problem})` : ""}`);
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
    process.stderr.write(`incremental bazel (${bazelBin()}): ${message}\n`);
    return e instanceof UsageError ? 2 : 4;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

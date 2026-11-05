#!/usr/bin/env node
// `incremental-biome run`: the Biome adapter loop (PLAN 10.4), one task per file.
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (incremental-git)
//   plan = affected(ch, context, declared tasks)
//   forget the tasks whose file was deleted
//   check each selected file with biome, and observe it
//   advance to HEAD only if every selected file ran, nothing was dirty,
//   and HEAD did not move; otherwise exit 7 (ran, not advanced).
//
// Exit codes: 0 ok and advanced; 1 a file failed biome check (advanced when
// allowed); 2 usage error; 4 engine or setup error; 7 ran but not advanced.
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
  biomeVersion,
  checkDiagnostics,
  configInputs,
  declaredRootFiles,
  lockfile,
  processedFiles,
  sha256,
  sha256File,
  type Diagnostic,
} from "./biome.js";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  // Timeout for one biome invocation, in milliseconds.
  timeoutMs: number;
}

export interface FileRun {
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
  changes: Change[];
  plan: Plan | null;
  fallback: Fallback | null;
  selected: string[];
  discovered: string[];
  results: FileRun[];
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

// A task id (PLAN D-2): the command and the repo-relative file it checks.
export const taskId = (rel: string): string => `biome check ${rel}`;

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
  return existsSync(file) ? sha256File(file) : "absent";
}

// The context (PLAN 8.4). Biome does not read tsconfig. Environment reads and
// directory listings are not observed, so those capabilities are false.
export function contextFor(root: string): Context {
  const lock = lockfile(root);
  return {
    lockfile: lock === null ? "absent" : hashOrAbsent(path.join(root, lock)),
    tsconfig: "not-read",
    pkgjson: hashOrAbsent(path.join(root, "package.json")),
    runner: `@biomejs/biome@${biomeVersion()}`,
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

type DeclaredInput = Extract<Input, { kind: "file" | "declared" }>;

// The inputs of one file, hashed now (before biome runs): the file, every config
// that can apply to it, and the root files Biome reads but does not report.
// Package-named extends and plugins are covered by the lockfile; without one,
// the observation is dirty.
function inputsFor(root: string, rel: string, lock: string | null): { inputs: DeclaredInput[]; dirty: boolean } {
  const abs = path.join(root, rel);
  const cfg = configInputs(root, abs);
  const inputs = new Map<string, DeclaredInput>();
  for (const f of [...cfg.files, ...declaredRootFiles(root)]) {
    if (f === rel) continue;
    inputs.set(f, { kind: "declared", path: f, hash: sha256File(path.join(root, f)) });
  }
  inputs.set(rel, { kind: "file", path: rel, hash: sha256File(abs) });
  return {
    inputs: [...inputs.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    dirty: cfg.unhashable.length > 0 && lock === null,
  };
}

// True when every input still has the hash it had before the run.
function unchangedSince(root: string, inputs: DeclaredInput[]): boolean {
  return inputs.every((i) => {
    const abs = path.join(root, i.path);
    return existsSync(abs) && sha256(readFileSync(abs)) === i.hash;
  });
}

interface Pending {
  task: string;
  rel: string;
  inputs: DeclaredInput[];
  dirty: boolean;
}

const CHUNK = 200;

// Outcome of one file from biome's diagnostics. Diagnostics that name no file of
// the batch (configuration problems) apply to every file in it.
function outcomeOf(rel: string, processed: Set<string>, batch: Set<string>, diags: Diagnostic[]): { outcome: Outcome; problem: string | null } {
  if (!processed.has(rel)) return { outcome: "error", problem: "biome did not check this file" };
  const mine = diags.filter((d) => d.path === rel || d.path === null || !batch.has(d.path));
  if (mine.some((d) => d.category.startsWith("internalError"))) return { outcome: "error", problem: "biome reported an internal error" };
  if (mine.some((d) => d.severity === "error")) return { outcome: "fail", problem: "biome reported errors" };
  return { outcome: "pass", problem: null };
}

export async function runAdapter(opts: RunOptions): Promise<RunReport> {
  const root = path.resolve(opts.root);
  const store = path.resolve(opts.store);
  ensureStore(store);

  const context = contextFor(root);
  const lock = lockfile(root);
  // Biome's own list of the files it checks is the task set (spec 11.1 rule 1).
  const discoveredFiles = processedFiles(root, ["."], opts.timeoutMs);
  const discovered = discoveredFiles.map(taskId).sort();

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

    const deleted = new Set<string>(plan?.deleted_tasks ?? []);
    for (const c of cs?.changes ?? []) {
      if (c.status === "deleted") deleted.add(taskId(c.path));
      if (c.status === "renamed" && c.old_path !== undefined) deleted.add(taskId(c.old_path));
    }
    for (const t of [...deleted].sort()) await client.forget(t);

    const runAll = opts.all || plan === null || plan.fallback !== null;
    const planned = new Set((plan?.tasks ?? []).map((t) => t.id));
    const selected = runAll ? discovered : discovered.filter((t) => planned.has(t));
    const selectedFiles = selected.map((t) => t.slice("biome check ".length));

    const results: FileRun[] = [];
    const pending: Pending[] = [];
    for (const rel of selectedFiles) {
      try {
        const { inputs, dirty } = inputsFor(root, rel, lock);
        pending.push({ task: taskId(rel), rel, inputs, dirty });
      } catch (e) {
        results.push({ task: taskId(rel), outcome: "error", durationMs: 0, problem: e instanceof Error ? e.message : String(e) });
      }
    }

    const observations: Observation[] = [];
    const obsBaseline = stored ?? head0.head;
    for (let i = 0; i < pending.length; i += CHUNK) {
      const batch = pending.slice(i, i + CHUNK);
      const files = batch.map((p) => p.rel);
      const started = Date.now();
      let processed: Set<string>;
      let diags: Diagnostic[];
      try {
        processed = new Set(processedFiles(root, files, opts.timeoutMs));
        diags = checkDiagnostics(root, files, opts.timeoutMs);
      } catch (e) {
        const problem = e instanceof Error ? e.message : String(e);
        for (const p of batch) results.push({ task: p.task, outcome: "error", durationMs: 0, problem });
        continue;
      }
      const durationMs = Math.round((Date.now() - started) / batch.length);
      const names = new Set(files);
      for (const p of batch) {
        const { outcome, problem } = outcomeOf(p.rel, processed, names, diags);
        results.push({ task: p.task, outcome, durationMs, problem });
        observations.push({
          task: p.task,
          baseline: obsBaseline,
          dirty: p.dirty,
          context,
          inputs: p.inputs,
          outputs: [],
          outcome,
          duration_ms: durationMs,
        });
      }
    }

    // Inputs that changed while biome ran make the observation dirty.
    const endFiles = new Map(pending.map((p) => [p.task, p.inputs]));
    for (const o of observations) {
      if (!unchangedSince(root, endFiles.get(o.task) ?? [])) o.dirty = true;
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
  if (cmd !== "run") throw new UsageError("usage: incremental-biome run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]");
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
    `incremental biome ${r.mode}: stored ${r.stored ?? "none"}, query ${r.base ?? "none"}, head ${r.headEnd}${r.dirty ? " (dirty)" : ""}`,
  ];
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
    process.stderr.write(`incremental biome: ${message}\n`);
    return e instanceof UsageError ? 2 : 4;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

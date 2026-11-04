#!/usr/bin/env node
// `backplane-turbopack run`: the Turbopack adapter loop (PLAN 10.4).
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (backplane-git)
//   plan = affected(ch, context, declared apps)
//   forget the apps whose package.json was deleted
//   build each selected app with `next build --turbopack` and observe it
//   advance to HEAD only if every selected app ran, the worktree is clean
//   and HEAD did not move; otherwise exit 7 (ran, not advanced).
//
// Every observation is dirty: no module graph is recorded, so no run is
// complete (spec/adapters/turbopack.md, PLAN 11.1 rule 4). The engine
// therefore re-runs every app on each query until the graph capability exists.
//
// Exit codes: 0 ok and advanced; 1 a build failed (advanced when allowed);
// 2 usage error; 4 engine or setup error; 7 ran but not advanced.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  connect,
  defaultEngine,
  isBackplaneError,
  repoRoot,
  type Change,
  type Context,
  type Fallback,
  type Input,
  type Observation,
  type Outcome,
  type Plan,
} from "@backplane/client";
import {
  allPackageJsons,
  buildApp,
  envHashes,
  repoInputs,
  discoverApps,
  LOCKFILES,
  nextPackage,
  sha256,
  type DeclaredInput,
} from "./project.js";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  // Timeout for one `next build`, in milliseconds.
  timeoutMs: number;
}

export interface AppRun {
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
  results: AppRun[];
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
  return process.env.BACKPLANE_GIT || path.join(repoRoot(), "adapters", "git", "dist", "backplane-git");
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

// The context (PLAN 8.4). `runner` names the next version the apps build with.
// Probes, directory listings and environment reads are not observed, and the
// module graph is not recorded (`graph: false`).
// Hashes of the tracked environment, as observation inputs (kind env), so a change
// to a tracked variable invalidates the apps that recorded it.
function envInputs(): Input[] {
  return Object.entries(envHashes(process.env)).map(([name, value_hash]) => ({ kind: "env" as const, name, value_hash }));
}

function sameInputs(a: readonly DeclaredInput[], b: readonly DeclaredInput[]): boolean {
  return a.length === b.length && a.every((x, i) => x.path === b[i]?.path && x.hash === b[i]?.hash);
}

export function contextFor(root: string, runner: string): Context {
  const lock = LOCKFILES.find((f) => existsSync(path.join(root, f)));
  const pkgs = allPackageJsons(root);
  const pkgjson =
    pkgs.length === 0 ? "absent" : sha256(pkgs.map((rel) => `${rel}\0${hashOrAbsent(path.join(root, rel))}`).join("\n"));
  return {
    lockfile: lock === undefined ? "absent" : hashOrAbsent(path.join(root, lock)),
    tsconfig: hashOrAbsent(path.join(root, "tsconfig.json")),
    pkgjson,
    runner,
    node: process.version,
    fmt: 1,
    caps: { probes: false, dirs: false, env: false },
    graph: false,
  };
}

// The next version of each discovered app that resolves it. Apps that do not
// resolve next are reported as errors when they run. All resolved versions
// must agree, because the context names one runner.
function runnerFor(root: string, apps: string[]): string {
  const versions = new Set<string>();
  for (const task of apps) {
    try {
      versions.add(nextPackage(path.join(root, task)).version);
    } catch {
      // reported per app when it runs
    }
  }
  if (versions.size === 0) return "next@none";
  if (versions.size > 1) throw new Error(`apps resolve different next versions: ${[...versions].sort().join(", ")}`);
  return `next@${[...versions][0]}`;
}

function ensureStore(store: string): void {
  if (existsSync(store)) return;
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0) throw new UsageError(`cannot create the store at ${store}: ${(r.stderr || "").trim()}`);
}

// The task of a deleted package.json, if it was an app directory.
function deletedApp(c: Change): string | null {
  if (c.status !== "deleted" || !c.path.endsWith("package.json")) return null;
  return path.posix.dirname(c.path) === "." ? "." : path.posix.dirname(c.path);
}

export async function runAdapter(opts: RunOptions): Promise<RunReport> {
  const root = path.resolve(opts.root);
  const store = path.resolve(opts.store);
  ensureStore(store);

  const discovered = discoverApps(root);
  const context = contextFor(root, runnerFor(root, discovered));

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
        { baseline: cs.baseline, context, env: envHashes(process.env), declared_tasks: discovered, verify: false, policy: "balanced" },
      );
    }

    const deleted = new Set<string>(plan?.deleted_tasks ?? []);
    for (const c of cs?.changes ?? []) {
      const app = deletedApp(c);
      if (app !== null && !discovered.includes(app)) deleted.add(app);
    }
    for (const t of [...deleted].sort()) await client.forget(t);

    const runAll = opts.all || plan === null || plan.fallback !== null;
    const planned = new Set((plan?.tasks ?? []).map((t) => t.id));
    const selected = runAll ? discovered : discovered.filter((t) => planned.has(t));

    const results: AppRun[] = [];
    const observations: Observation[] = [];
    const obsBaseline = stored ?? head0.head;
    for (const task of selected) {
      const appAbs = path.join(root, task);
      let nextDir: string;
      let before: DeclaredInput[];
      try {
        nextDir = nextPackage(appAbs).dir;
        before = repoInputs(root);
      } catch (e) {
        const problem = e instanceof Error ? e.message : String(e);
        results.push({ task, outcome: "error", durationMs: 0, problem });
        continue;
      }
      const build = buildApp(appAbs, nextDir, opts.timeoutMs);
      results.push({ task, outcome: build.outcome, durationMs: build.durationMs, problem: build.problem });
      // The inputs are read after the build, because the build may write some of
      // them (next-env.d.ts, a rewritten tsconfig.json). If it changed any file,
      // this build did not read the state it records, so the observation is dirty.
      const after = repoInputs(root);
      const rewritten = !sameInputs(before, after);
      const inputs = [...after, ...envInputs()];
      observations.push({
        task,
        baseline: obsBaseline,
        dirty: rewritten,
        context,
        inputs,
        outputs: [],
        outcome: build.outcome,
        duration_ms: build.durationMs,
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
      if (dirty) notAdvanced.push("the worktree is dirty at the end of the run (next build writes .next and may rewrite tsconfig.json)");
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
  if (cmd !== "run") throw new UsageError("usage: backplane-turbopack run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]");
  const opts: RunOptions = { root: process.cwd(), store: "", all: false, timeoutMs: 1_200_000 };
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
  if (!storeGiven) opts.store = process.env.BACKPLANE_STORE || path.join(opts.root, ".backplane");
  return { opts, json };
}

function printText(r: RunReport): void {
  const counts: Record<Outcome, number> = { pass: 0, fail: 0, error: 0, none: 0 };
  for (const t of r.results) counts[t.outcome]++;
  const lines = [
    `backplane turbopack ${r.mode}: stored ${r.stored ?? "none"}, query ${r.base ?? "none"}, head ${r.headEnd}${r.dirty ? " (dirty)" : ""}`,
  ];
  if (r.fallback !== null) lines.push(`fallback: ${r.fallback.reason}`);
  else if (r.plan !== null) lines.push(`plan: ${r.plan.tasks.length} invalid of ${r.plan.total_tasks}, confidence ${r.plan.confidence}`);
  lines.push(`built ${r.results.length}: pass ${counts.pass}, fail ${counts.fail}, error ${counts.error}`);
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
    const code = e instanceof UsageError ? "invalid_params" : isBackplaneError(e) ? e.code : "internal";
    const message = e instanceof Error ? e.message : String(e);
    if (parsed.json) process.stdout.write(JSON.stringify({ ok: false, error: { code, message } }) + "\n");
    process.stderr.write(`backplane turbopack: ${message}\n`);
    return e instanceof UsageError ? 2 : 4;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

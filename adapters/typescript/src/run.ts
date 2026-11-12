#!/usr/bin/env node
// `incremental-typescript run`: the TypeScript adapter loop (PLAN 10.4).
//
//   B    = store baseline
//   ch   = ChangeSet from B to the worktree (incremental-git)
//   plan = affected(ch, context, declared projects)
//   forget the projects whose tsconfig was deleted
//   check each selected project with tsc --noEmit and observe it
//   advance to HEAD only if every selected project ran, the worktree is clean
//   and HEAD did not move; otherwise exit 7 (ran, not advanced).
//
// Exit codes: 0 ok and advanced; 1 a project failed to type check (advanced when
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
  allPackageJsons,
  checkProject,
  configChain,
  discoverProjects,
  packageJsonsFor,
  relPath,
  sha256,
  TS_PACKAGE_DIR,
  typescriptVersion,
} from "./project.js";

export interface RunOptions {
  root: string;
  store: string;
  base?: string;
  all: boolean;
  // Timeout for one tsc run, in milliseconds.
  timeoutMs: number;
}

export interface ProjectRun {
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

// The git change source (PLAN 11.7). Throws UsageError-compatible Error on failure.
function gitSourcePath(): string {
  return (
    process.env.INCREMENTAL_GIT ||
    path.join(repoRoot(), "adapters", "git", "dist", "incremental-git")
  );
}

function gitChangeSet(root: string, ref: string): GitChangeSet {
  const r = spawnSync(gitSourcePath(), ["changes", "--base", ref, "--root", root], {
    encoding: "utf8",
  });
  if (r.error !== undefined)
    throw new Error(`cannot run the git change source: ${r.error.message}`);
  if (r.status !== 0)
    throw new Error(
      `git change source failed (exit ${r.status}): ${(r.stdout || r.stderr || "").trim()}`,
    );
  return JSON.parse(r.stdout) as GitChangeSet;
}

function hashOrAbsent(file: string): string {
  return existsSync(file) ? sha256(readFileSync(file)) : "absent";
}

// The context (PLAN 8.4). Environment reads and directory listings are not
// observed by this adapter, so those capabilities are false.
export function contextFor(root: string): Context {
  const lock = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].find((f) =>
    existsSync(path.join(root, f)),
  );
  const pkgs = allPackageJsons(root);
  const pkgjson =
    pkgs.length === 0
      ? "absent"
      : sha256(pkgs.map((rel) => `${rel}\0${hashOrAbsent(path.join(root, rel))}`).join("\n"));
  return {
    lockfile: lock === undefined ? "absent" : hashOrAbsent(path.join(root, lock)),
    tsconfig: hashOrAbsent(path.join(root, "tsconfig.json")),
    pkgjson,
    runner: `typescript@${typescriptVersion()}`,
    node: process.version,
    fmt: 1,
    caps: { probes: false, dirs: false, env: false },
  };
}

function ensureStore(store: string): void {
  if (existsSync(store)) return;
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0)
    throw new UsageError(`cannot create the store at ${store}: ${(r.stderr || "").trim()}`);
}

// Inputs of one project: every file tsc reads (hashed under root), its extends
// chain, and the package.json files on its paths. Files inside the TypeScript
// package are covered by the runner version in the context. Anything else
// outside root cannot be named repo-relative, so the observation is dirty.
type FileInput = Extract<Input, { kind: "file" }>;

function inputsFor(
  root: string,
  configAbs: string,
  listed: readonly string[],
): { inputs: FileInput[]; dirty: boolean } {
  const chain = configChain(configAbs);
  let dirty = chain.references || chain.unhashable.length > 0;
  const files = new Set<string>(chain.files);
  for (const f of listed) {
    if (!f.startsWith(TS_PACKAGE_DIR + path.sep)) {
      if (f.startsWith(root + path.sep)) {
        files.add(f);
      } else {
        dirty = true;
      }
    }
  }
  const all = [...files, ...packageJsonsFor(root, [...files]).map((rel) => path.join(root, rel))];
  const inputs = new Map<string, FileInput>();
  for (const abs of all) {
    const rel = relPath(root, abs);
    inputs.set(rel, { kind: "file", path: rel, hash: sha256(readFileSync(abs)) });
  }
  return {
    inputs: [...inputs.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    dirty,
  };
}

export async function runAdapter(opts: RunOptions): Promise<RunReport> {
  const root = path.resolve(opts.root);
  const store = path.resolve(opts.store);
  ensureStore(store);

  const context = contextFor(root);
  const discovered = discoverProjects(root);

  let head0: GitChangeSet;
  try {
    head0 = gitChangeSet(root, "HEAD");
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }

  const client = await connect({
    store,
    root,
    command: [defaultEngine(), "serve"],
    timeoutMs: 60_000,
  });
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
      throw new UsageError(
        `--base resolves to ${cs.baseline}, but the store baseline is ${stored}`,
      );
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
        },
      );
    }

    const deleted = new Set<string>(plan?.deleted_tasks ?? []);
    for (const c of cs?.changes ?? []) {
      if (c.status === "deleted" && c.path.endsWith("tsconfig.json")) deleted.add(c.path);
      if (
        c.status === "renamed" &&
        c.old_path !== undefined &&
        c.old_path.endsWith("tsconfig.json")
      )
        deleted.add(c.old_path);
    }
    for (const t of [...deleted].sort()) await client.forget(t);

    const runAll = opts.all || plan === null || plan.fallback !== null;
    const planned = new Set((plan?.tasks ?? []).map((t) => t.id));
    const selected = runAll ? discovered : discovered.filter((t) => planned.has(t));

    const results: ProjectRun[] = [];
    const observations: Observation[] = [];
    const obsBaseline = stored ?? head0.head;
    for (const task of selected) {
      const configAbs = path.join(root, task);
      const check = checkProject(configAbs, opts.timeoutMs);
      results.push({
        task,
        outcome: check.outcome,
        durationMs: check.durationMs,
        problem: check.problem,
      });
      if (check.outcome !== "error") {
        let inputs: FileInput[];
        let dirtyInputs: boolean;
        try {
          ({ inputs, dirty: dirtyInputs } = inputsFor(root, configAbs, check.files));
          observations.push({
            task,
            baseline: obsBaseline,
            dirty: dirtyInputs,
            context,
            inputs,
            outputs: [],
            outcome: check.outcome,
            duration_ms: check.durationMs,
          });
        } catch (e) {
          const problem = e instanceof Error ? e.message : String(e);
          results[results.length - 1] = {
            task,
            outcome: "error",
            durationMs: check.durationMs,
            problem,
          };
        }
      }
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
      for (const r of results)
        if (r.outcome === "error")
          notAdvanced.push(`error: ${r.task}${r.problem ? ` (${r.problem})` : ""}`);
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
      fallback:
        plan?.fallback ??
        (runAll && plan === null ? { action: "run_all", reason: "git_source" } : null),
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
  if (cmd !== "run")
    throw new UsageError(
      "usage: incremental-typescript run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]",
    );
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
    if (a === "--base") {
      opts.base = value();
    } else if (a === "--json") {
      json = true;
    } else if (a === "--all") {
      opts.all = true;
    } else if (a === "--store") {
      opts.store = value();
      storeGiven = true;
    } else if (a === "--root") {
      opts.root = value();
    } else if (a === "--timeout") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new UsageError("--timeout needs a positive integer");
      opts.timeoutMs = n;
    } else {
      throw new UsageError(`unknown option ${a}`);
    }
  }
  opts.root = path.resolve(opts.root);
  if (!storeGiven)
    opts.store = process.env.INCREMENTAL_STORE || path.join(opts.root, ".incremental");
  return { opts, json };
}

function printText(r: RunReport): void {
  const counts: Record<Outcome, number> = { pass: 0, fail: 0, error: 0, none: 0 };
  for (const t of r.results) counts[t.outcome]++;
  const lines = [
    `incremental typescript ${r.mode}: stored ${r.stored ?? "none"}, query ${r.base ?? "none"}, head ${r.headEnd}${r.dirty ? " (dirty)" : ""}`,
  ];
  if (r.fallback !== null) lines.push(`fallback: ${r.fallback.reason}`);
  else if (r.plan !== null)
    lines.push(
      `plan: ${r.plan.tasks.length} invalid of ${r.plan.total_tasks}, confidence ${r.plan.confidence}`,
    );
  lines.push(
    `checked ${r.results.length}: pass ${counts.pass}, fail ${counts.fail}, error ${counts.error}`,
  );
  for (const t of r.results)
    if (t.outcome !== "pass")
      lines.push(`  ${t.outcome} ${t.task}${t.problem ? ` (${t.problem})` : ""}`);
  lines.push(r.advanced ? `advanced to ${r.headEnd}` : `not advanced: ${r.notAdvanced.join("; ")}`);
  lines.push(`exit ${r.exit}`);
  process.stdout.write(`${lines.join("\n")}\n`);
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
    if (parsed.json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else printText(report);
    return report.exit;
  } catch (e) {
    const code =
      e instanceof UsageError ? "invalid_params" : isIncrementalError(e) ? e.code : "internal";
    const message = e instanceof Error ? e.message : String(e);
    if (parsed.json)
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    process.stderr.write(`incremental typescript: ${message}\n`);
    return e instanceof UsageError ? 2 : 4;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

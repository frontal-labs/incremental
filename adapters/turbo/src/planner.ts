// Planner inputs for Turborepo: the packages and their graph (`turbo ls`, each package.json),
// the ChangeSet from the git change source, and the context.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot, type ChangeSet, type Context } from "@incremental/client";
import { ABSENT, hashOrAbsent } from "./shared.js";

export function turboBin(): string {
  return process.env.INCREMENTAL_TURBO || "turbo";
}

export interface PackageGraph {
  // package name -> directory, relative to the workspace root
  roots: Record<string, string>;
  // package name -> the workspace packages it depends on directly, sorted
  deps: Record<string, string[]>;
  // the packages that have a `test` script: the tasks the adapter runs
  tested: string[];
}

// The workspace packages from `turbo ls`, and their dependencies on each other (the
// dependencies and devDependencies that name another workspace package).
export function packageGraph(root: string): PackageGraph {
  const r = spawnSync(turboBin(), ["ls", "--output=json"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`turbo ls failed (exit ${r.status}): ${(r.stderr || r.stdout).trim()}`);
  const listed = (JSON.parse(r.stdout).packages?.items ?? []) as { name: string; path: string }[];
  const roots: Record<string, string> = {};
  const manifests: Record<string, { scripts?: Record<string, string>; deps: string[] }> = {};
  for (const p of listed) {
    roots[p.name] = p.path;
    const pkg = JSON.parse(readFileSync(path.join(root, p.path, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    manifests[p.name] = {
      scripts: pkg.scripts,
      deps: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})],
    };
  }
  const names = new Set(Object.keys(roots));
  const deps: Record<string, string[]> = {};
  for (const name of names) {
    deps[name] = [...new Set(manifests[name]!.deps)]
      .filter((d) => names.has(d) && d !== name)
      .sort();
  }
  const tested = [...names].filter((n) => manifests[n]!.scripts?.test !== undefined).sort();
  return { roots, deps, tested };
}

// Changes from ref to the worktree (incremental-git changes --base REF --root DIR).
export interface GitChangeSet extends ChangeSet {
  head: string;
  dirty: boolean;
}

export class GitSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitSourceError";
  }
}

export function gitSourcePath(): string {
  return (
    process.env.INCREMENTAL_GIT ||
    path.join(repoRoot(), "adapters", "git", "dist", "incremental-git")
  );
}

// Throws GitSourceError when the git source fails (for example, the ref is not in the history).
export function gitChangeSet(root: string, ref: string): GitChangeSet {
  const r = spawnSync(gitSourcePath(), ["changes", "--base", ref, "--root", root], {
    encoding: "utf8",
  });
  if (r.error !== undefined)
    throw new GitSourceError(`cannot run the git change source: ${r.error.message}`);
  if (r.status !== 0) {
    let message = (r.stdout || r.stderr || "").trim();
    try {
      const parsed = JSON.parse(message) as { error?: { message?: string } };
      message = parsed.error?.message ?? message;
    } catch {
      // not JSON: keep the raw text
    }
    throw new GitSourceError(`git change source failed (exit ${r.status}): ${message}`);
  }
  return JSON.parse(r.stdout) as GitChangeSet;
}

// turbo reports the local or the global install, depending on the directory: run it in the workspace.
function turboVersion(root: string): string {
  const r = spawnSync(turboBin(), ["--version"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "unknown";
}

// The context (PLAN 8.4, 9.5): the files the runner's result depends on. A change to any of
// them makes the plan fall back to running every task.
export function contextFor(root: string): Context {
  const lockfile = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]
    .map((f) => path.join(root, f))
    .find((f) => hashOrAbsent(f) !== ABSENT);
  return {
    lockfile: lockfile ? hashOrAbsent(lockfile) : ABSENT,
    tsconfig: hashOrAbsent(path.join(root, "tsconfig.json")),
    pkgjson: hashOrAbsent(path.join(root, "package.json")),
    runner: `turbo@${turboVersion(root)}`,
    node: process.version,
    fmt: 1,
    caps: { probes: true, dirs: true, env: true },
  };
}

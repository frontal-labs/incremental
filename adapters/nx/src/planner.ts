// Planner inputs for Nx (PLAN 11.3, 10.4, 11.7, 9.5): project discovery,
// the ChangeSet from the git change source, the context, the environment map
// and the optional incremental.config.json.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot, type ChangeSet, type Config, type Context } from "@incremental/client";
import { envHashes } from "./shared.js";

export function discoverProjects(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const name = entry.name;
          if (
            name !== "node_modules" &&
            name !== ".git" &&
            name !== ".incremental" &&
            name !== ".nx" &&
            name !== "dist"
          ) {
            visit(abs);
          }
        } else if (entry.isFile()) {
          if (entry.name === "project.json" || entry.name === "project.ts") {
            const rel = path.relative(root, abs).split(path.sep).join("/");
            const projectDir = path.dirname(rel);
            if (!out.includes(projectDir)) out.push(projectDir);
          }
        }
      }
    }
  };
  visit(root);
  return out.sort();
}

// Runs `nx show projects --affected --base=` and returns the affected
// project names, sorted.
export function affectedProjects(root: string, ref: string): string[] {
  const nxBin = process.env.INCREMENTAL_NX || "nx";
  const r = spawnSync(
    nxBin,
    ["show", "projects", "--affected", "--base", ref, "--output", "json"],
    { cwd: root, encoding: "utf8", timeout: 120_000 },
  );
  if (r.error !== undefined) throw new Error(`nx show projects failed: ${r.error.message}`);
  if (r.status !== 0) {
    let message = (r.stdout || r.stderr || "").trim();
    try {
      const parsed = JSON.parse(message);
      message = parsed.message ?? message;
    } catch {
      // not JSON: keep the raw text
    }
    throw new Error(`nx show projects failed (exit ${r.status}): ${message}`);
  }
  try {
    const parsed = JSON.parse(r.stdout);
    if (Array.isArray(parsed)) return parsed as string[];
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.projects))
      return parsed.projects as string[];
    return [];
  } catch {
    return r.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .sort();
  }
}

// The git change source (PLAN 11.7): incremental-git changes --base REF --root DIR.
export function gitSourcePath(): string {
  return (
    process.env.INCREMENTAL_GIT ||
    path.join(repoRoot(), "adapters", "git", "dist", "incremental-git")
  );
}

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

// Changes from ref to the worktree. Throws GitSourceError when the git source
// fails (for example, the ref is not in a shallow clone's history).
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

// The context (PLAN 8.4, 9.5): the environment the runner gave the Nx CLI,
// before Nx writes MODE, DEV, PROD, TEST, BASE_URL and FORCE_TTY.
// Reads of names Nx injected count as unset.
export function contextFor(): Context {
  return {
    lockfile: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    tsconfig: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    pkgjson: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    runner: "nx@unknown",
    node: process.version,
    fmt: 1,
    caps: { probes: true, dirs: true, env: true },
  };
}

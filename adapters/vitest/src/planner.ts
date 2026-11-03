// Planner inputs (PLAN 11.3, 10.4, 11.7, 9.5): test discovery, the ChangeSet
// from the git change source, the context, the environment map and the
// optional backplane.config.json.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { repoRoot, type ChangeSet, type Config, type Context } from "@backplane/client";
import { EXCLUDED_DIRS, TEST_FILE, VITEST_VERSION, isTrackedEnv, sha256 } from "./shared.js";

// Repo-relative paths of the files under root that satisfy the predicate,
// sorted. Excluded directories and symlinks are not followed.
export function walkFiles(root: string, match: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.includes(entry.name)) visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (match(rel)) out.push(rel);
    }
  };
  visit(root);
  return out.sort();
}

export function discoverTests(root: string): string[] {
  return walkFiles(root, (rel) => TEST_FILE.test(rel));
}

// The git change source (PLAN 11.7): backplane-git changes --base REF --root DIR.
export function gitSourcePath(): string {
  return process.env.BACKPLANE_GIT || path.join(repoRoot(), "adapters", "git", "dist", "backplane-git");
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
  const r = spawnSync(gitSourcePath(), ["changes", "--base", ref, "--root", root], { encoding: "utf8" });
  if (r.error !== undefined) throw new GitSourceError(`cannot run the git change source: ${r.error.message}`);
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

function hashOrAbsent(file: string): string {
  return existsSync(file) ? sha256(readFileSync(file)) : "absent";
}

// The context (PLAN 8.4, 6.2): lockfile, tsconfig and package.json hashes, the
// runner, the Node version, the format, and the capabilities of this recorder.
// Probes, directory listings and environment reads are all captured, so the
// capabilities are true (PLAN 11.2, proven on the fixture in E4).
export function contextFor(root: string): Context {
  const lock = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].find((f) => existsSync(path.join(root, f)));
  const pkgs = walkFiles(root, (rel) => rel === "package.json" || rel.endsWith("/package.json"));
  const pkgjson =
    pkgs.length === 0
      ? "absent"
      : sha256(pkgs.map((rel) => `${rel}\0${hashOrAbsent(path.join(root, rel))}`).join("\n"));
  return {
    lockfile: lock === undefined ? "absent" : hashOrAbsent(path.join(root, lock)),
    tsconfig: hashOrAbsent(path.join(root, "tsconfig.json")),
    pkgjson,
    runner: `vitest@${VITEST_VERSION}`,
    node: process.version,
    fmt: 1,
    caps: { probes: true, dirs: true, env: true },
  };
}

// The environment the tests run in (PLAN 6.7 env map): one hash per tracked name.
export function envHashes(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(env)) {
    if (!isTrackedEnv(name)) continue;
    const value = env[name];
    if (value !== undefined) out[name] = sha256(value);
  }
  return out;
}

// backplane.config.json at the repo root (PLAN 6.7). Missing fields take the
// engine defaults, so only the fields the file sets are passed on.
export function loadConfig(root: string): Config | undefined {
  const file = path.join(root, "backplane.config.json");
  if (!existsSync(file)) return undefined;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Config;
  const out: Config = {};
  if (raw.ignore !== undefined) out.ignore = raw.ignore;
  if (raw.globalInputs !== undefined) out.globalInputs = raw.globalInputs;
  if (raw.fallbackContextKeys !== undefined) out.fallbackContextKeys = raw.fallbackContextKeys;
  return out;
}

// The Vitest CLI entry of the pinned version (run with the node binary).
export function vitestBin(): string {
  const req = createRequire(import.meta.url);
  return path.join(path.dirname(req.resolve("vitest/package.json")), "vitest.mjs");
}

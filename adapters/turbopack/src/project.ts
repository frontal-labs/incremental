// One Next.js app as a task (spec/adapters/turbopack.md). The task id is the
// repo-relative path of the app directory, "." for the root (PLAN D-2). The
// task is `next build --turbopack` run in that directory with the app's own
// `next`. No module graph is recorded: the declared inputs below are the only
// inputs, and every observation is dirty (PLAN 11.1, rule 4).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Directories the input walk never enters. node_modules is covered by the
// lockfile in the context. dist is not skipped: a dependent app reads its
// workspace dependency's build output. .next is the app's own build output.
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".incremental", ".toolchain"]);
export const NEXT_CONFIGS = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
  "next.config.mts",
  "next.config.cts",
];
// Env files `next build` reads in production mode (from the app directory).
export const ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"];
export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

export interface DeclaredInput {
  kind: "declared";
  path: string;
  hash: string;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

// The task id of an app directory: repo-relative, "." for the root.
export function taskOf(root: string, dirAbs: string): string {
  return relPath(root, dirAbs) || ".";
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function dependsOnNext(pkgFile: string): boolean {
  const pkg = readJson(pkgFile);
  const deps = {
    ...(pkg.dependencies as object | undefined),
    ...(pkg.devDependencies as object | undefined),
  };
  return "next" in deps;
}

// Repo-relative task ids of every directory with a package.json that depends on
// next, sorted. Walks the repo; symbolic links are not followed.
export function discoverApps(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg) && dependsOnNext(pkg)) out.push(taskOf(root, dir));
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink() && entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        visit(path.join(dir, entry.name));
      }
    }
  };
  visit(root);
  return out.sort();
}

// Repo-relative paths of every package.json under root, sorted (context hash).
export function allPackageJsons(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) visit(abs);
        } else if (entry.isFile() && entry.name === "package.json") {
          out.push(relPath(root, abs));
        }
      }
    }
  };
  visit(root);
  return out.sort();
}

// The `next` package the app resolves, from its own node_modules. Throws when
// the app does not have next installed.
export function nextPackage(appAbs: string): { dir: string; version: string } {
  const req = createRequire(path.join(appAbs, "package.json"));
  const file = req.resolve("next/package.json");
  return { dir: path.dirname(file), version: (readJson(file).version as string) ?? "unknown" };
}

// Files `next build` writes itself. Their content is fixed by the Next version in
// the context, so they are not inputs (recording them would make the first build dirty).
export const GENERATED = new Set(["next-env.d.ts"]);

// Every file under root that a build of one app can read, hashed now
// (spec/adapters/turbopack.md). `next build` reads source modules anywhere in the
// repository, and no module graph is recorded, so the inputs are the repository
// minus SKIP_DIRS and minus `excluded`: the directories of the other apps. An app
// is a leaf: it does not import from another app's directory (see README).
// Paths are repo-relative and sorted. Symbolic links are not followed.
export function repoInputs(
  root: string,
  excluded: ReadonlySet<string> = new Set(),
): DeclaredInput[] {
  const out: DeclaredInput[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !excluded.has(relPath(root, abs))) visit(abs);
        } else if (entry.isFile() && !GENERATED.has(entry.name)) {
          out.push({ kind: "declared", path: relPath(root, abs), hash: sha256(readFileSync(abs)) });
        }
      }
    }
  };
  visit(root);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// The environment a build reads that the adapter records: NEXT_* variables and
// NODE_ENV, as hashes. Other variables are not observed (stated in the README).
export const TRACKED_ENV = (name: string): boolean =>
  name.startsWith("NEXT_") || name === "NODE_ENV";

export function envHashes(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(env).sort()) {
    const value = env[name];
    if (TRACKED_ENV(name) && value !== undefined) out[name] = sha256(value);
  }
  return out;
}

export interface BuildResult {
  outcome: "pass" | "fail" | "error";
  durationMs: number;
  problem: string | null;
}

// Runs `next build --turbopack` in the app directory with the app's own next
// binary. Telemetry is off. Exit 0 is pass; exit 1 is fail (Next exits 1 for a
// failed compile, type check or prerender); anything else, or a timeout, is error.
export function buildApp(appAbs: string, nextDir: string, timeoutMs: number): BuildResult {
  const started = Date.now();
  const r = spawnSync(
    process.execPath,
    [path.join(nextDir, "dist", "bin", "next"), "build", "--turbopack"],
    {
      cwd: appAbs,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    },
  );
  const durationMs = Date.now() - started;
  if (r.error !== undefined || r.signal !== null) {
    return { outcome: "error", durationMs, problem: r.error?.message ?? `killed by ${r.signal}` };
  }
  if (r.status === 0) return { outcome: "pass", durationMs, problem: null };
  if (r.status === 1) return { outcome: "fail", durationMs, problem: "next build failed (exit 1)" };
  return { outcome: "error", durationMs, problem: `next build exited ${r.status}` };
}

// Workspace packages and their scripts as tasks (spec/adapters/pnpm.md). The task
// id is `<package path>#<script>`, repo-relative; the root package is ".". The
// workspace graph comes from `pnpm list`, and dependency edges from the manifests
// (no install is needed).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Context, Input } from "@frontal-labs/incremental-client";

// Directories the walk never enters. Build output (dist) is not skipped: a
// dependent reads its dependency's output.
const SKIP_DIRS = new Set(["node_modules", ".git", ".incremental", ".toolchain"]);
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export type DeclaredInput = Extract<Input, { kind: "declared" }>;

interface Manifest {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface Pkg {
  // Empty when the manifest has no name.
  name: string;
  // Repo-relative directory; "." for the root package.
  rel: string;
  scripts: string[];
  // Repo-relative directories of the workspace packages this one depends on, directly.
  deps: string[];
}

export interface TaskDef {
  task: string;
  pkg: Pkg;
  script: string;
}

export function pnpmBin(): string {
  return process.env.INCREMENTAL_PNPM || "pnpm";
}

export function pnpmVersion(): string {
  const r = spawnSync(pnpmBin(), ["--version"], { encoding: "utf8" });
  if (r.error !== undefined || r.status !== 0) throw new Error(`cannot run ${pnpmBin()} --version`);
  return r.stdout.trim();
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

export function hashOrAbsent(file: string): string {
  return existsSync(file) ? sha256(readFileSync(file)) : "absent";
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;
}

// The workspace packages, from `pnpm -r list --depth -1 --json`, with their
// direct workspace dependencies. A dependency counts when its name is a
// workspace package name, which over-approximates the links pnpm makes.
export function workspacePackages(root: string): Pkg[] {
  // pnpm reports realpaths, so the repo-relative paths are taken from the realpath.
  const real = realpathSync(root);
  const r = spawnSync(pnpmBin(), ["-r", "list", "--depth", "-1", "--json"], {
    cwd: real,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error !== undefined || r.status !== 0) {
    const detail = (r.stderr || r.stdout || r.error?.message || "no output").trim();
    throw new Error(`pnpm list failed: ${detail}`);
  }
  const listed = JSON.parse(r.stdout) as Array<{ path: string }>;
  const raw = listed.map((p) => {
    const rel = relPath(real, p.path) || ".";
    const m = readManifest(path.join(real, rel));
    const depNames = DEP_FIELDS.flatMap((f) => Object.keys(m[f] ?? {}));
    return { name: m.name ?? "", rel, scripts: Object.keys(m.scripts ?? {}).sort(), depNames };
  });
  const byName = new Map(raw.filter((p) => p.name !== "").map((p) => [p.name, p.rel]));
  return raw
    .map((p) => {
      const deps = new Set<string>();
      for (const n of p.depNames) {
        const target = byName.get(n);
        if (target !== undefined && target !== p.rel) deps.add(target);
      }
      return { name: p.name, rel: p.rel, scripts: p.scripts, deps: [...deps].sort() };
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

// The package and every workspace package it depends on, transitively, sorted.
export function closure(pkgs: Pkg[], rel: string): string[] {
  const byRel = new Map(pkgs.map((p) => [p.rel, p]));
  const seen = new Set<string>();
  const stack = [rel];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (!seen.has(next)) {
      seen.add(next);
      for (const d of byRel.get(next)?.deps ?? []) stack.push(d);
    }
  }
  return [...seen].sort();
}

export function tasksOf(pkgs: Pkg[]): TaskDef[] {
  const out: TaskDef[] = [];
  for (const pkg of pkgs)
    for (const script of pkg.scripts) out.push({ task: `${pkg.rel}#${script}`, pkg, script });
  return out.sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));
}

// Repo-relative paths of every file under a directory, skipping SKIP_DIRS and symlinks.
function filesUnder(root: string, rel: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) visit(abs);
        } else if (entry.isFile()) {
          out.push(relPath(root, abs));
        }
      }
    }
  };
  visit(path.join(root, rel));
  return out;
}

// The files a package owns: everything under its directory, except the
// directories of the other workspace packages (which matters for the root package).
export function ownFiles(root: string, pkgs: Pkg[], rel: string): string[] {
  const others = pkgs.map((p) => p.rel).filter((r) => r !== rel && r !== ".");
  return filesUnder(root, rel).filter((f) => !others.some((o) => f === o || f.startsWith(`${o}/`)));
}

// The task ids that the repo declares confined in incremental-pnpm.json, a file
// at the root of the form {"confined": ["packages/lib#build"]}. A confined
// task's script is declared to read nothing outside its declared inputs (its
// package and workspace dependencies), so the observation is not dirty. The
// adapter cannot verify that claim; the file is the user's statement of it.
export function confinedTasks(root: string): Set<string> {
  const file = path.join(root, "incremental-pnpm.json");
  if (!existsSync(file)) return new Set();
  const raw = JSON.parse(readFileSync(file, "utf8")) as { confined?: unknown };
  if (!Array.isArray(raw.confined) || raw.confined.some((t) => typeof t !== "string")) {
    throw new Error("incremental-pnpm.json: confined must be an array of task ids");
  }
  return new Set(raw.confined as string[]);
}

// The declared inputs of one task (spec/adapters/pnpm.md): the root manifest and
// workspace files, the task package's own files, and every file of each workspace
// dependency (transitively), so a change in a dependency reaches its dependents.
export function declaredInputs(root: string, pkgs: Pkg[], rel: string): DeclaredInput[] {
  const files = new Set<string>(["package.json", "pnpm-workspace.yaml", ".npmrc"]);
  for (const f of ownFiles(root, pkgs, rel)) files.add(f);
  for (const dep of closure(pkgs, rel)) {
    if (dep === rel || dep === ".") {
      files.add(path.posix.join(dep, "package.json"));
    } else {
      for (const f of filesUnder(root, dep)) files.add(f);
    }
  }
  return [...files]
    .sort()
    .map((p) => ({ kind: "declared" as const, path: p, hash: hashOrAbsent(path.join(root, p)) }));
}

// The context (PLAN 8.4). `lockfile` is the root pnpm-lock.yaml. `pkgjson` hashes
// every workspace manifest. This adapter reads no tsconfig, so `tsconfig` is the
// constant "absent". Environment reads and directory listings are not observed.
export function contextFor(root: string, pkgs: Pkg[]): Context {
  const manifests = pkgs
    .map((p) => `${p.rel}\0${hashOrAbsent(path.join(root, p.rel, "package.json"))}`)
    .sort()
    .join("\n");
  return {
    lockfile: hashOrAbsent(path.join(root, "pnpm-lock.yaml")),
    tsconfig: "absent",
    pkgjson: sha256(manifests),
    runner: `pnpm@${pnpmVersion()}`,
    node: process.version,
    fmt: 1,
    caps: { probes: false, dirs: false, env: false },
  };
}

export interface ScriptResult {
  outcome: "pass" | "fail" | "error";
  durationMs: number;
  problem: string | null;
}

// Runs one script with `pnpm --filter <name> run <script>` (a path filter when the
// package has no name). pnpm exits with the script's status.
export function runScript(root: string, t: TaskDef, timeoutMs: number): ScriptResult {
  const started = Date.now();
  const filter = t.pkg.name !== "" ? t.pkg.name : `./${t.pkg.rel}`;
  const r = spawnSync(pnpmBin(), ["--filter", filter, "run", t.script], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  if (r.error !== undefined || r.signal !== null) {
    return { outcome: "error", durationMs, problem: r.error?.message ?? `killed by ${r.signal}` };
  }
  if (r.status === 0) return { outcome: "pass", durationMs, problem: null };
  return { outcome: "fail", durationMs, problem: `script exited ${r.status}` };
}

// Config for the engine: every path that no confined task reads is ignored
// (P11, dropped before any rule). A confined task is declared to read only its
// declared inputs, so a change elsewhere cannot make it stale. Unconfined tasks
// are dirty and rerun on every query whatever the ignore list says. The list is
// directory globs where a whole directory holds no input, and file paths otherwise.
// incremental-pnpm.json is always an input: it decides which tasks are confined.
export function ignoreOutside(root: string, pkgs: Pkg[], confined: Set<string>): string[] {
  const inputs = new Set<string>(["incremental-pnpm.json"]);
  for (const t of tasksOf(pkgs)) {
    if (confined.has(t.task)) {
      for (const d of declaredInputs(root, pkgs, t.pkg.rel)) inputs.add(d.path);
    }
  }
  const hasInputUnder = (rel: string): boolean => {
    for (const f of inputs) if (f.startsWith(`${rel}/`)) return true;
    return false;
  };
  const out: string[] = [];
  const visit = (rel: string): void => {
    const dir = path.join(root, rel);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink() && !SKIP_DIRS.has(entry.name)) {
        const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (hasInputUnder(childRel)) visit(childRel);
          else out.push(`${childRel}/**`);
        } else if (!inputs.has(childRel)) {
          out.push(childRel);
        }
      }
    }
  };
  visit("");
  return out.sort();
}

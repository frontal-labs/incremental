// One TypeScript project as a task (spec/adapters/typescript.md). The task id is
// the repo-relative path of its tsconfig.json (PLAN D-2). Its inputs are the
// files tsc reads for the program, the package.json files on their paths, and
// the tsconfig extends chain. Everything read is hashed at observation time.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

// Directories the walk never enters. Matches the Vitest walker's intent.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".incremental", ".toolchain"]);

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

const req = createRequire(import.meta.url);

// The TypeScript package this adapter runs. The version is part of the context
// (PLAN 8.4), so it names the compiler that actually ran the project.
export const TS_PACKAGE_DIR = path.dirname(req.resolve("typescript/package.json"));

export function tscEntry(): string {
  return path.join(TS_PACKAGE_DIR, "bin", "tsc");
}

export function typescriptVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(TS_PACKAGE_DIR, "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

// Repo-relative paths of every tsconfig.json under root, sorted.
export function discoverProjects(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(abs);
        continue;
      }
      if (entry.isFile() && entry.name === "tsconfig.json") out.push(relPath(root, abs));
    }
  };
  visit(root);
  return out.sort();
}

// The files tsc reads for a project, from `tsc -p <config> --listFilesOnly`.
// Absolute paths. Throws ProjectError when tsc cannot load the project.
export function programFiles(configAbs: string): string[] {
  const r = spawnSync(process.execPath, [tscEntry(), "-p", configAbs, "--listFilesOnly"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error !== undefined || r.status !== 0) {
    const detail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() || (r.error?.message ?? "no output");
    throw new ProjectError(`tsc --listFilesOnly failed for ${configAbs}: ${detail}`);
  }
  return r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => path.normalize(line));
}

export interface ConfigChain {
  // Absolute paths of the config and every config it extends (relative extends only).
  files: string[];
  // Extends targets that are not relative paths (package names). Cannot be hashed.
  unhashable: string[];
  // The config declares project references. Their outputs are read by tsc but
  // are not in this project's listing, so the observation is not complete.
  references: boolean;
}

// The tsconfig and its extends chain. Read with the TypeScript parser, so the
// comments and trailing commas that tsconfig allows are accepted.
export function configChain(configAbs: string): ConfigChain {
  const files: string[] = [];
  const unhashable: string[] = [];
  let references = false;
  const visit = (file: string): void => {
    if (files.includes(file)) return;
    files.push(file);
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error !== undefined) {
      throw new ProjectError(`cannot read ${file}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`);
    }
    const config = read.config as { extends?: string | string[]; references?: unknown[] };
    if (Array.isArray(config.references) && config.references.length > 0) references = true;
    const ext = config.extends === undefined ? [] : Array.isArray(config.extends) ? config.extends : [config.extends];
    for (const target of ext) {
      if (!target.startsWith(".") && !path.isAbsolute(target)) {
        unhashable.push(target);
        continue;
      }
      let abs = path.resolve(path.dirname(file), target);
      if (!existsSync(abs) && existsSync(`${abs}.json`)) abs = `${abs}.json`;
      if (!existsSync(abs)) {
        unhashable.push(target);
        continue;
      }
      visit(abs);
    }
  };
  visit(configAbs);
  return { files, unhashable, references };
}

// Repo-relative paths of every package.json under root, sorted. Used for the
// context hash, as the Vitest adapter does.
export function allPackageJsons(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(abs);
        continue;
      }
      if (entry.isFile() && entry.name === "package.json") out.push(relPath(root, abs));
    }
  };
  visit(root);
  return out.sort();
}

// Every package.json on the path from each input file up to root, plus the
// project's own directory chain. tsc reads these to resolve imports and to
// read "types", "exports" and "type" fields, and does not list them.
export function packageJsonsFor(root: string, files: readonly string[]): string[] {
  const found = new Set<string>();
  const dirs = new Set<string>();
  for (const file of files) {
    let dir = path.dirname(file);
    while (dir.startsWith(root) && !dirs.has(dir)) {
      dirs.add(dir);
      if (dir === root) break;
      dir = path.dirname(dir);
    }
  }
  dirs.add(root);
  for (const dir of dirs) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) found.add(relPath(root, pkg));
  }
  return [...found].sort();
}

// Runs `tsc --noEmit --listFiles` for one project: one process gives both the
// check and the list of files it read (the list is what the inputs are made
// from). Incremental and composite output are turned off so the run writes
// nothing into the worktree.
export interface CheckResult {
  outcome: "pass" | "fail" | "error";
  durationMs: number;
  problem: string | null;
  // Absolute paths of the program's files (empty when tsc printed no list).
  files: string[];
}

// The file lines of `--listFiles` output. Diagnostics also start with a path,
// but they carry "(line,col): error" and are skipped.
export function parseListFiles(stdout: string): string[] {
  const files: string[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || !line.startsWith("/") || /\(\d+,\d+\): (error|warning)/.test(line)) continue;
    files.push(path.normalize(line));
  }
  return files;
}

export function checkProject(configAbs: string, timeoutMs: number): CheckResult {
  const started = Date.now();
  const r = spawnSync(
    process.execPath,
    [tscEntry(), "-p", configAbs, "--noEmit", "--listFiles", "--incremental", "false", "--composite", "false"],
    { cwd: path.dirname(configAbs), encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 },
  );
  const durationMs = Date.now() - started;
  if (r.error !== undefined || r.signal !== null) {
    return { outcome: "error", durationMs, problem: r.error?.message ?? `killed by ${r.signal}`, files: [] };
  }
  const files = parseListFiles(r.stdout ?? "");
  // A failed load (for example an unreadable config) prints no file list. That
  // is an error, not a type error: the project was never checked.
  if (r.status !== 0 && files.length === 0) {
    return { outcome: "error", durationMs, problem: `tsc could not load the project (exit ${r.status})`, files };
  }
  if (r.status === 0) return { outcome: "pass", durationMs, problem: null, files };
  return { outcome: "fail", durationMs, problem: `tsc reported errors (exit ${r.status})`, files };
}

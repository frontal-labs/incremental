// One Playwright test file as a task (spec/adapters/playwright.md). The task id is
// the repo-relative path of the test file (PLAN D-2). Tasks come from
// `playwright test --list`, so the runner's own testMatch and testIgnore decide
// the set. Inputs are the test file, the relative imports it reaches (a static
// scan), and the playwright config with its relative imports. Anything the scan
// cannot name, and any test that may reach a live server, is recorded dirty.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Context, Outcome } from "@incremental/client";

// Directories the walk never enters. Matches the TypeScript and Vitest walkers.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".incremental",
  ".toolchain",
  "test-results",
  "playwright-report",
]);

// Playwright's default testMatch: **/*.@(spec|test).?(c|m)[jt]s?(x)
export const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;
const CONFIG_FILES = [
  "playwright.config.ts",
  "playwright.config.mts",
  "playwright.config.cts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs",
];
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
// Static import forms: import/export ... from, import "x", require("x"), import("x").
const SPECIFIER =
  /(?:\bimport\s+(?:[^'"`;]*?\sfrom\s+)?|\bexport\s+[^'"`;]*?\sfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;
// A require() or import() whose argument is not a string literal.
const DYNAMIC = /\b(?:require|import)\s*\(\s*(?!['"`])/;
// Code that can reach a server: browser and request fixtures, fetch, and the
// network modules. A match makes the task dirty (PLAN 11.1 rule 4).
const LIVE =
  /\b(page|context|browser|request|baseURL|webServer|goto|fetch|http|https|net|tls|undici)\b/;
const CONFIG_LIVE = /\b(webServer|baseURL)\b/;
const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.mjs",
];

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

const req = createRequire(import.meta.url);

// The Playwright CLI this adapter runs by default: the pinned @playwright/test.
export function defaultPlaywright(): string {
  return path.join(path.dirname(req.resolve("@playwright/test/package.json")), "cli.js");
}

export function playwrightVersion(cli: string): string {
  const pkg = JSON.parse(readFileSync(path.join(path.dirname(cli), "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

// Repo-relative paths of every package.json under root, sorted (context pkgjson).
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

// The test tasks: the files `playwright test --list` reports, repo-relative, sorted.
// Runs in root, so Playwright's paths are repo-relative (the config lives there).
export function discoverTasks(root: string, cli: string): string[] {
  const r = spawnSync(process.execPath, [cli, "test", "--list", "--reporter=json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error !== undefined)
    throw new ProjectError(`playwright test --list failed: ${r.error.message}`);
  let report: PwReport;
  try {
    report = parseReport(r.stdout, "playwright test --list");
  } catch {
    throw new ProjectError(
      `playwright test --list failed (exit ${r.status}): ${(r.stderr || r.stdout).trim().slice(0, 500)}`,
    );
  }
  if (r.status !== 0 || report.errors.length > 0) {
    const message = report.errors[0]?.message ?? (r.stderr || "").trim();
    throw new ProjectError(
      `playwright test --list failed (exit ${r.status}): ${message.slice(0, 1000)}`,
    );
  }
  const files = new Set<string>();
  for (const spec of allSpecs(report.suites)) files.add(spec.file);
  return [...files].sort();
}

export interface PwSpec {
  file: string;
  ok: boolean;
}

interface PwSuite {
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

export interface PwReport {
  suites: PwSuite[];
  errors: Array<{ message?: string }>;
}

export function parseReport(stdout: string, what: string): PwReport {
  try {
    const parsed = JSON.parse(stdout) as Partial<PwReport>;
    return { suites: parsed.suites ?? [], errors: parsed.errors ?? [] };
  } catch {
    throw new ProjectError(`${what} did not print a JSON report`);
  }
}

// Every spec in the report tree, with its file.
export function allSpecs(suites: readonly PwSuite[]): PwSpec[] {
  const out: PwSpec[] = [];
  for (const s of suites) {
    out.push(...(s.specs ?? []));
    out.push(...allSpecs(s.suites ?? []));
  }
  return out;
}

// Outcome of one task from the JSON report: its specs only, since a filter can
// match more files than the one asked for.
export function outcomeOf(
  report: PwReport,
  task: string,
): { outcome: Outcome; problem: string | null } {
  if (report.errors.length > 0)
    return {
      outcome: "error",
      problem: report.errors[0]?.message ?? "playwright reported an error",
    };
  const specs = allSpecs(report.suites).filter((s) => s.file === task);
  if (specs.length === 0) return { outcome: "error", problem: "no tests ran for this file" };
  return specs.every((s) => s.ok)
    ? { outcome: "pass", problem: null }
    : { outcome: "fail", problem: "a test failed" };
}

// Runs one test file with its own Playwright process. Output goes outside the
// worktree (--output), so the run leaves no files behind.
export interface FileRun {
  task: string;
  outcome: Outcome;
  durationMs: number;
  problem: string | null;
}

export function runFile(
  root: string,
  cli: string,
  task: string,
  outDir: string,
  timeoutMs: number,
): FileRun {
  const started = Date.now();
  const r = spawnSync(
    process.execPath,
    [cli, "test", path.join(root, task), "--reporter=json", "--output", outDir],
    {
      cwd: root,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  const durationMs = Date.now() - started;
  if (r.error !== undefined || r.signal !== null) {
    return {
      task,
      outcome: "error",
      durationMs,
      problem: r.error?.message ?? `killed by ${r.signal}`,
    };
  }
  let report: PwReport;
  try {
    report = parseReport(r.stdout, `playwright test ${task}`);
  } catch (e) {
    return {
      task,
      outcome: "error",
      durationMs,
      problem: `${e instanceof Error ? e.message : String(e)}: ${(r.stderr || "").trim().slice(0, 300)}`,
    };
  }
  return { task, ...outcomeOf(report, task), durationMs };
}

// The context (PLAN 8.4). The lockfile and package.json hashes are context
// values. The browser is declared by its executable path, which carries the
// browser revision (the binary's bytes are not hashed).
export function contextFor(root: string, cli: string): Context {
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
    runner: `playwright@${playwrightVersion(cli)}`,
    browser: browserKey(cli),
    node: process.version,
    fmt: 1,
    caps: { probes: false, dirs: false, env: false },
  };
}

function hashOrAbsent(file: string): string {
  return existsSync(file) ? sha256(readFileSync(file)) : "absent";
}

// The chromium executable of the chosen Playwright, and whether it is installed.
function browserKey(cli: string): string {
  const core = createRequire(cli).resolve("playwright-core");
  const r = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(require(process.argv[1]).chromium.executablePath())", core],
    {
      encoding: "utf8",
    },
  );
  const exe = r.status === 0 ? r.stdout.trim() : "";
  if (exe === "") return sha256("no browser path");
  return sha256(`${exe}\0${existsSync(exe) ? "present" : "absent"}`);
}

export function configFile(root: string): string | undefined {
  const found = CONFIG_FILES.find((f) => existsSync(path.join(root, f)));
  return found === undefined ? undefined : path.join(root, found);
}

// Resolves a relative specifier the way the TypeScript emitter does: extensions
// are tried in order, and a .js specifier also names its .ts source.
function resolveRelative(fromAbs: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromAbs), spec);
  const stripped = base.replace(/\.[cm]?jsx?$/, "");
  const bases = stripped === base ? [base] : [base, stripped];
  for (const b of bases) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const candidate = b + suffix;
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

export interface Closure {
  // Absolute paths of the entry and every relative import it reaches.
  files: string[];
  // The walk met something it cannot name: a dynamic import, an unresolved or
  // out-of-repo relative import. The observation is then not complete.
  dirty: boolean;
  // The code matches LIVE, so it may reach a server.
  live: boolean;
}

export function closureOf(root: string, entry: string): Closure {
  const files = new Set<string>();
  let dirty = false;
  let live = false;
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (!files.has(file)) {
      files.add(file);
      if (SOURCE_FILE.test(file)) {
        const text = readFileSync(file, "utf8");
        if (LIVE.test(text)) live = true;
        if (DYNAMIC.test(text)) dirty = true;
        for (const m of text.matchAll(SPECIFIER)) {
          const spec = m[1] ?? m[2] ?? "";
          if (spec.startsWith(".") || spec.startsWith("/")) {
            // packages: the lockfile
            const abs = resolveRelative(file, spec);
            if (abs === null || !abs.startsWith(root + path.sep)) dirty = true;
            else queue.push(abs);
          }
        }
      }
    }
  }
  return { files: [...files], dirty, live };
}

export type FileInput = { kind: "file"; path: string; hash: string };

// Inputs of one task, hashed now (before the run). Dirty when the task may hit a
// live server, or when the scan could not name everything it reads.
export function inputsFor(
  root: string,
  task: string,
  config: Closure | null,
  configLive: boolean,
): { inputs: FileInput[]; dirty: boolean } {
  const closure = closureOf(root, path.join(root, task));
  const files = new Set<string>(closure.files);
  let dirty = closure.dirty || closure.live || configLive;
  if (config !== null) {
    dirty ||= config.dirty;
    for (const f of config.files) files.add(f);
  }
  const inputs = new Map<string, FileInput>();
  for (const abs of files) {
    const rel = relPath(root, abs);
    inputs.set(rel, { kind: "file", path: rel, hash: sha256(readFileSync(abs)) });
  }
  return {
    inputs: [...inputs.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    dirty,
  };
}

// The config analysis: its closure, and whether it names a live server.
export function configAnalysis(root: string): { config: Closure | null; live: boolean } {
  const file = configFile(root);
  if (file === undefined) return { config: null, live: false };
  const config = closureOf(root, file);
  return { config, live: CONFIG_LIVE.test(readFileSync(file, "utf8")) };
}

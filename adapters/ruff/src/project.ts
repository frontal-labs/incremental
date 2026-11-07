// One Python file as a task (spec/adapters/ruff.md). The task id is
// "ruff check <repo-relative path>" (PLAN D-2). Its inputs are the file itself and
// the config files ruff resolved for it: the settings path that
// `ruff check --show-settings` prints, and its `extend` chain. Everything read is
// hashed at observation time.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

export function ruffBinary(): string {
  return process.env.INCREMENTAL_RUFF || "ruff";
}

// The ruff version is part of the context (PLAN 8.4). Plugin rules are not
// observed; the version does not say which plugins are installed.
export function ruffRunner(): string {
  const r = spawnSync(ruffBinary(), ["--version"], { encoding: "utf8" });
  if (r.error !== undefined || r.status !== 0) {
    throw new ProjectError(
      `cannot run ${ruffBinary()} --version: ${r.error?.message ?? (r.stderr || "").trim()}`,
    );
  }
  const version = r.stdout.trim().split(/\s+/)[1];
  if (version === undefined)
    throw new ProjectError(`unexpected output of ${ruffBinary()} --version: ${r.stdout.trim()}`);
  return `ruff@${version}`;
}

export function taskId(rel: string): string {
  return `ruff check ${rel}`;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

// Repo-relative paths of every file `ruff check` would check under root, sorted.
// Ruff applies its own exclude rules and .gitignore here, so the task list is the
// list ruff itself uses. That includes pyproject.toml, which ruff checks for its
// own TOML rules.
export function discoverFiles(root: string): string[] {
  const real = realpathSync(root);
  const r = spawnSync(ruffBinary(), ["check", "--no-cache", "--show-files"], {
    cwd: real,
    encoding: "utf8",
  });
  if (r.error !== undefined || r.status !== 0) {
    throw new ProjectError(
      `ruff --show-files failed: ${(r.stdout || r.stderr || r.error?.message || "").trim()}`,
    );
  }
  return r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => relPath(real, path.resolve(real, line)))
    .sort();
}

// The settings path ruff used for one file, or null when no project config was
// found. Read from `ruff check --show-settings`, whose "Settings path:" line
// names the config file.
export function settingsPath(root: string, rel: string): string | null {
  const r = spawnSync(ruffBinary(), ["check", "--no-cache", "--show-settings", rel], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.error !== undefined || r.status !== 0) {
    const detail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() || (r.error?.message ?? "no output");
    throw new ProjectError(`ruff --show-settings failed for ${rel}: ${detail}`);
  }
  const m = /^Settings path: "(.*)"$/m.exec(r.stdout);
  return m?.[1] ?? null;
}

export interface ConfigChain {
  // Absolute paths of the settings file and every file it extends.
  files: string[];
  // Extends targets that do not exist. Ruff would fail on them, so the run is dirty.
  missing: string[];
}

// The settings file and its `extend` chain. Read as text: the key is a plain
// string, and ruff resolves it relative to the file that names it.
export function configChain(configAbs: string): ConfigChain {
  const files: string[] = [];
  const missing: string[] = [];
  const visit = (file: string): void => {
    if (files.includes(file)) return;
    files.push(file);
    for (const m of readFileSync(file, "utf8").matchAll(/^\s*extend\s*=\s*"([^"]+)"/gm)) {
      const abs = path.resolve(path.dirname(file), m[1] as string);
      if (existsSync(abs)) visit(abs);
      else missing.push(m[1] as string);
    }
  };
  visit(configAbs);
  return { files, missing };
}

// A user-level ruff config outside the repository. Ruff reads it when a file has
// no project config, so a run that has one is not observed completely.
export function userConfig(): string | null {
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  const file = path.join(base, "ruff", "ruff.toml");
  return existsSync(file) ? file : null;
}

export interface CheckResult {
  outcome: "pass" | "fail" | "error";
  durationMs: number;
  problem: string | null;
}

// Runs `ruff check` on one file, with the cache off so nothing is written into
// the worktree. Exit 0 is pass, exit 1 is violations (fail), anything else is an
// error of ruff itself (for example an invalid config, exit 2).
export function checkFile(root: string, rel: string, timeoutMs: number): CheckResult {
  const started = Date.now();
  const finish = (outcome: CheckResult["outcome"], problem: string | null): CheckResult => ({
    outcome,
    durationMs: Date.now() - started,
    problem,
  });
  if (!existsSync(path.join(root, rel))) return finish("error", "file is missing");
  const r = spawnSync(ruffBinary(), ["check", "--no-cache", "--output-format", "json", rel], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error !== undefined || r.signal !== null)
    return finish("error", r.error?.message ?? `killed by ${r.signal}`);
  if (r.status === 0) return finish("pass", null);
  if (r.status === 1) {
    let count = 0;
    try {
      count = (JSON.parse(r.stdout) as unknown[]).length;
    } catch {
      return finish("error", "ruff reported violations but its JSON output did not parse");
    }
    return finish("fail", `ruff reported ${count} violation(s)`);
  }
  const first = (r.stderr || "")
    .split("\n")
    .find((l) => l.trim().length > 0 && !l.startsWith("warning:"));
  return finish("error", `ruff exited ${r.status}${first ? `: ${first.trim()}` : ""}`);
}

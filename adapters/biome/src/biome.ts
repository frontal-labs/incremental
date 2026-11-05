// Biome as a task runner (spec/adapters/biome.md). A task is one file that
// `biome check` processes; its id is "biome check <repo-relative path>" (PLAN D-2).
// Biome has no machine-readable list of files read, so the list comes from the
// text `--verbose` output ("Files processed"), and the diagnostics come from the
// JSON reporter of a second run. Config and ignore files are not in either list,
// so they are declared inputs, resolved here.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

// The engine store lives under the repo. Biome checks it (it is not ignored), but it
// is not a task.
const STORE_DIR = ".incremental";

export class BiomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiomeError";
  }
}

const req = createRequire(import.meta.url);
const BIOME_PKG = path.dirname(req.resolve("@biomejs/biome/package.json"));

export function biomeBin(): string {
  const pkg = JSON.parse(readFileSync(path.join(BIOME_PKG, "package.json"), "utf8")) as { bin: { biome: string } };
  return path.join(BIOME_PKG, pkg.bin.biome);
}

export function biomeVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(BIOME_PKG, "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

function runBiome(root: string, args: string[], timeoutMs: number): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [biomeBin(), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (r.error !== undefined || r.signal !== null) {
    throw new BiomeError(`biome check did not finish: ${r.error?.message ?? `killed by ${r.signal}`}`);
  }
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

// Repo-relative paths that `biome check --verbose` processes under the given
// targets, from the "Files processed" block. Throws when Biome prints no block
// (for example, when its configuration does not load).
export function processedFiles(root: string, targets: string[], timeoutMs: number): string[] {
  const r = runBiome(root, ["check", "--colors=off", "--verbose", ...targets], timeoutMs);
  const lines = r.stdout.split("\n");
  const at = lines.findIndex((l) => l.trim() === "i Files processed:");
  if (at < 0) throw new BiomeError(`biome printed no file list: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("  - ")) out.push(line.slice(4).trim());
    else if (line.trim() !== "") break;
  }
  return out.filter((f) => !f.startsWith(STORE_DIR + "/")).sort();
}

export interface Diagnostic {
  path: string | null;
  severity: string;
  category: string;
}

// Diagnostics of `biome check` over the given files, from the JSON reporter.
// Biome can exit 0 after an internal I/O error, so the diagnostics decide the
// outcome, not the exit status. Throws when the JSON cannot be read.
export function checkDiagnostics(root: string, files: string[], timeoutMs: number): Diagnostic[] {
  const r = runBiome(root, ["check", "--colors=off", "--reporter=json", ...files], timeoutMs);
  const line = r.stdout.split("\n").find((l) => l.startsWith("{"));
  if (line === undefined) throw new BiomeError(`biome printed no report (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 400)}`);
  const report = JSON.parse(line) as { diagnostics: { severity: string; category?: string; location?: { path?: string } }[] };
  return report.diagnostics.map((d) => ({
    path: d.location?.path ?? null,
    severity: d.severity,
    category: d.category ?? "",
  }));
}

// The configuration files that can apply to a file: every biome.json or
// biome.jsonc from the file's directory up to root, and every file their
// "extends" and "plugins" name by relative path. Biome merges nested
// configurations with the root, so the superset is recorded.
export interface ConfigInputs {
  files: string[];          // repo-relative, sorted
  unhashable: string[];     // package names (extends or plugins) read via the lockfile
}

const CONFIG_NAMES = ["biome.json", "biome.jsonc"];
const isRelative = (target: string): boolean => target.startsWith("./") || target.startsWith("../");

export function configInputs(root: string, fileAbs: string): ConfigInputs {
  const files = new Set<string>();
  const unhashable = new Set<string>();
  const visit = (abs: string): void => {
    const rel = relPath(root, abs);
    if (files.has(rel)) return;
    files.add(rel);
    const read = ts.readConfigFile(abs, ts.sys.readFile);
    if (read.error !== undefined) {
      throw new BiomeError(`cannot read ${rel}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`);
    }
    const config = read.config as { extends?: string | string[]; plugins?: string[] };
    const targets = [
      ...(config.extends === undefined ? [] : Array.isArray(config.extends) ? config.extends : [config.extends]),
      ...(config.plugins ?? []),
    ];
    for (const target of targets) {
      if (!isRelative(target)) {
        unhashable.add(target);
        continue;
      }
      const next = path.resolve(path.dirname(abs), target);
      if (!existsSync(next)) throw new BiomeError(`${rel} names ${target}, which does not exist`);
      visit(next);
    }
  };
  let dir = path.dirname(fileAbs);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const abs = path.join(dir, name);
      if (existsSync(abs)) visit(abs);
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return { files: [...files].sort(), unhashable: [...unhashable].sort() };
}

// Repo-relative paths of the root-level files Biome reads when its VCS and
// editorconfig options are on. Declared, since Biome does not report them.
export const ROOT_DECLARED = [".gitignore", ".editorconfig", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

export function declaredRootFiles(root: string): string[] {
  return ROOT_DECLARED.filter((f) => existsSync(path.join(root, f)));
}

export function lockfile(root: string): string | null {
  return ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].find((f) => existsSync(path.join(root, f))) ?? null;
}

export function sha256File(abs: string): string {
  return sha256(readFileSync(abs));
}

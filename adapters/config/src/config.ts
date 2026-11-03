// The config adapter (spec/adapters/config.md). Config files that backplane.config.json
// lists under globalInputs are recorded as `declared` inputs with content hashes (PLAN 9.5).
// The adapter runs no task: it supplies inputs and the config the engine compares.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Config, Context, Input } from "@backplane/client";

export const CONFIG_FILE = "backplane.config.json";
export const CONFIG_RUNNER = "config@0.1.0";

// Directories the walk never enters (PLAN 6.7 default exclude).
const SKIP_DIRS = new Set(["node_modules", ".git", ".backplane"]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function sha256(data: Buffer | string): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

// backplane.config.json at the root (PLAN 6.7). A missing file is an empty config.
export function loadConfig(root: string): Config {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`cannot parse ${CONFIG_FILE}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ConfigError(`${CONFIG_FILE} must be an object`);
  return raw as Config;
}

// The three fields the engine reads from the query (spec/POLICY.md section 1).
export function affectedConfig(config: Config): Config {
  const out: Config = {};
  if (config.ignore !== undefined) out.ignore = config.ignore;
  if (config.globalInputs !== undefined) out.globalInputs = config.globalInputs;
  if (config.fallbackContextKeys !== undefined) out.fallbackContextKeys = config.fallbackContextKeys;
  return out;
}

// Glob to RegExp for `*`, `**` and `?` (PLAN 6.7). `**/` also matches no directory.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function isGlob(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

// Repo-relative paths of every regular file under root, sorted. Symlinks are not followed.
export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(abs);
      } else if (entry.isFile()) {
        out.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  };
  visit(root);
  return out.sort();
}

// The repo-relative config files named by globalInputs. Literal names are kept even
// when absent (hashed as "absent"), so their creation is seen. Globs match files only.
export function globalInputFiles(root: string, config: Config): string[] {
  const names = new Set<string>();
  const files = config.globalInputs !== undefined ? walkFiles(root) : [];
  for (const pattern of config.globalInputs ?? []) {
    if (isGlob(pattern)) {
      const re = globToRegExp(pattern);
      for (const f of files) if (re.test(f)) names.add(f);
    } else {
      names.add(normalize(pattern));
    }
  }
  return [...names].sort();
}

// Normalizes a repo-relative path. Rejects absolute paths and paths that leave the root.
export function normalize(rel: string): string {
  const p = path.posix.normalize(rel.split(path.sep).join("/"));
  if (path.posix.isAbsolute(p) || p === ".." || p.startsWith("../") || p === ".") {
    throw new ConfigError(`not a repo-relative path: ${rel}`);
  }
  return p;
}

// `declared` inputs for repo-relative paths: the content hash at call time, or "absent".
export function declaredInputs(root: string, paths: readonly string[]): Input[] {
  const seen = new Set<string>();
  for (const rel of paths) seen.add(normalize(rel));
  return [...seen].sort().map((rel) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return { kind: "declared", path: rel, hash: "absent" };
    if (!statSync(abs).isFile()) throw new ConfigError(`declared input is not a file: ${rel}`);
    return { kind: "declared", path: rel, hash: sha256(readFileSync(abs)) };
  });
}

// The context (PLAN 8.4). The config adapter does not own lockfile, tsconfig or pkgjson,
// so those are hashed from the root for completeness. caps is the caller's claim: the
// config adapter records no probes or dirs, so the default is all false (see README.md).
export function contextFor(root: string, caps: Context["caps"] = { probes: false, dirs: false, env: false }): Context {
  const hashOf = (rel: string): string => (existsSync(path.join(root, rel)) ? sha256(readFileSync(path.join(root, rel))) : "absent");
  const lock = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].find((f) => existsSync(path.join(root, f)));
  return {
    lockfile: lock === undefined ? "absent" : hashOf(lock),
    tsconfig: hashOf("tsconfig.json"),
    pkgjson: hashOf("package.json"),
    runner: CONFIG_RUNNER,
    node: process.version,
    fmt: 1,
    caps: { ...caps },
  };
}

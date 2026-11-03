// Protobuf targets (spec/adapters/protobuf.md). Every .proto file is a protoc task
// and every buf.yaml is a buf module task; a task id is its repo-relative path (D-2).
// Compiles write only to a scratch directory outside the repo.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Directories the walk never enters. Matches the TypeScript adapter.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".backplane", ".toolchain"]);
const MAX_BUFFER = 256 * 1024 * 1024;

export type Outcome = "pass" | "fail" | "error";

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

export interface Targets {
  // Repo-relative .proto files (protoc tasks).
  protoc: string[];
  // Repo-relative buf.yaml files (buf module tasks).
  buf: string[];
  // Repo-relative buf.lock files (global to the context).
  bufLock: string[];
}

export function discoverTargets(root: string): Targets {
  const out: Targets = { protoc: [], buf: [], bufLock: [] };
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relPath(root, abs);
      if (entry.name.endsWith(".proto")) out.protoc.push(rel);
      else if (entry.name === "buf.yaml") out.buf.push(rel);
      else if (entry.name === "buf.lock") out.bufLock.push(rel);
    }
  };
  visit(root);
  out.protoc.sort();
  out.buf.sort();
  out.bufLock.sort();
  return out;
}

// The absolute path of an executable on PATH (or of a path given with a separator),
// symlinks resolved. Null when it is absent.
export function resolveTool(name: string): string | null {
  if (name.includes(path.sep)) return existsSync(name) ? realpathSync(name) : null;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const abs = path.join(dir, name);
    if (existsSync(abs)) return realpathSync(abs);
  }
  return null;
}

function toolOutput(bin: string, args: string[]): string | null {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return r.status === 0 ? `${r.stdout}${r.stderr}`.trim() : null;
}

function firstLine(text: string | null | undefined): string {
  return (text ?? "").trim().split("\n")[0] ?? "";
}

export function protocBin(): string {
  const bin = resolveTool(process.env.BACKPLANE_PROTOC || "protoc");
  if (bin === null) throw new Error("protoc is not installed or not on PATH (set BACKPLANE_PROTOC)");
  return bin;
}

export function protocVersion(): string {
  const out = toolOutput(protocBin(), ["--version"]);
  if (out === null) throw new Error("protoc --version failed");
  return out.replace(/^libprotoc\s+/, "");
}

// The well-known types come from the protoc install, not the repo. protoc finds
// them at <bin>/../include, so that directory is the one to digest.
export function wellKnownDir(): string {
  const dir = path.resolve(path.dirname(protocBin()), "..", "include");
  if (!existsSync(path.join(dir, "google", "protobuf", "timestamp.proto"))) {
    throw new Error(`no well-known types under ${dir}`);
  }
  return dir;
}

export function wellKnownDigest(): string {
  const dir = path.join(wellKnownDir(), "google", "protobuf");
  const names = readdirSync(dir).filter((n) => n.endsWith(".proto")).sort();
  return sha256(names.map((n) => `${n}\0${sha256(readFileSync(path.join(dir, n)))}`).join("\n"));
}

// The buf version, or null when buf is not installed.
export function bufVersion(): string | null {
  const bin = resolveTool(process.env.BACKPLANE_BUF || "buf");
  return bin === null ? null : toolOutput(bin, ["--version"]);
}

// The directory protoc resolves imports from: the nearest buf module above the
// file (buf imports are module-relative), else the repo root.
export function protoRootFor(root: string, rel: string): string {
  let dir = path.dirname(path.join(root, rel));
  while (dir.startsWith(root + path.sep)) {
    if (existsSync(path.join(dir, "buf.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return root;
}

// protoc's dependency file (--dependency_out): "<target>: <dep> <dep>", with "\ "
// for a space and a backslash before each line break.
export function parseDepFile(text: string): string[] {
  const at = text.indexOf(": ");
  if (at < 0) throw new Error("malformed protoc dependency file");
  return text
    .slice(at + 2)
    .replace(/\\\n/g, " ")
    .split(/(?<!\\)\s+/)
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/\\ /g, " "));
}

export interface Compile {
  outcome: Outcome;
  // Absolute paths protoc read. Empty when protoc wrote no dependency file.
  deps: string[];
  complete: boolean;
  durationMs: number;
  problem: string | null;
}

// Compiles one .proto with protoc. The descriptor set is a scratch output and is
// discarded: generated code is not stored (spec 'What it cannot observe').
export function compileProto(root: string, rel: string, timeoutMs: number): Compile {
  const protoRoot = protoRootFor(root, rel);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "backplane-protoc-"));
  const depFile = path.join(scratch, "deps.d");
  const started = Date.now();
  try {
    const r = spawnSync(
      protocBin(),
      [
        `--proto_path=${protoRoot}`,
        `--dependency_out=${depFile}`,
        `--descriptor_set_out=${path.join(scratch, "out.pb")}`,
        relPath(protoRoot, path.join(root, rel)),
      ],
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: MAX_BUFFER },
    );
    const durationMs = Date.now() - started;
    const complete = existsSync(depFile);
    const deps = complete ? parseDepFile(readFileSync(depFile, "utf8")) : [];
    if (r.error !== undefined || r.signal !== null) {
      return { outcome: "error", deps, complete, durationMs, problem: r.error?.message ?? `killed by ${r.signal}` };
    }
    if (r.status === 0) {
      if (complete) return { outcome: "pass", deps, complete, durationMs, problem: null };
      return { outcome: "error", deps, complete, durationMs, problem: "protoc wrote no dependency file" };
    }
    if (r.status === 1) {
      return { outcome: "fail", deps, complete, durationMs, problem: `protoc reported errors: ${firstLine(r.stderr)}` };
    }
    return { outcome: "error", deps, complete, durationMs, problem: `protoc exited ${r.status}` };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Classifies protoc's reads. Repo files become file inputs (the caller hashes
// them), the well-known types are covered by the context digest, and any other
// path outside the repo cannot be named repo-relative, so the observation is dirty.
export function classifyDeps(root: string, deps: readonly string[]): { files: string[]; dirty: boolean } {
  const wkt = wellKnownDir() + path.sep;
  const files = new Set<string>();
  let dirty = false;
  for (const dep of deps.map((d) => path.normalize(d))) {
    if (dep.startsWith(wkt)) continue;
    if (dep.startsWith(root + path.sep)) files.add(relPath(root, dep));
    else dirty = true;
  }
  return { files: [...files].sort(), dirty };
}

export interface BufCheck {
  outcome: Outcome;
  // Repo-relative files of the module (buf ls-files).
  files: string[];
  durationMs: number;
  problem: string | null;
}

// Checks one buf module: `buf build` of the module directory. Its files come from
// `buf ls-files`. Registry dependencies are identified by buf.lock, not by a read.
export function checkBuf(root: string, bufRel: string, timeoutMs: number): BufCheck {
  const dir = path.dirname(path.join(root, bufRel));
  const started = Date.now();
  const bin = resolveTool(process.env.BACKPLANE_BUF || "buf");
  if (bin === null) {
    return { outcome: "error", files: [], durationMs: 0, problem: "buf is not installed or not on PATH (set BACKPLANE_BUF)" };
  }
  const opts = { cwd: dir, encoding: "utf8" as const, timeout: timeoutMs, maxBuffer: MAX_BUFFER };
  const list = spawnSync(bin, ["ls-files", "."], opts);
  if (list.status !== 0 || list.error !== undefined) {
    const problem = list.error?.message ?? `buf ls-files failed: ${firstLine(list.stderr)}`;
    return { outcome: "error", files: [], durationMs: Date.now() - started, problem };
  }
  const files = list.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((f) => relPath(root, path.join(dir, f)));
  const r = spawnSync(bin, ["build", "."], opts);
  const durationMs = Date.now() - started;
  if (r.error !== undefined || r.signal !== null) {
    return { outcome: "error", files, durationMs, problem: r.error?.message ?? `killed by ${r.signal}` };
  }
  if (r.status === 0) return { outcome: "pass", files, durationMs, problem: null };
  if (r.status === 1) {
    return { outcome: "fail", files, durationMs, problem: `buf build reported errors: ${firstLine(r.stderr)}` };
  }
  return { outcome: "error", files, durationMs, problem: `buf build exited ${r.status}` };
}

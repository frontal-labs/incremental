// Cargo as the recorder uses it: workspace metadata, the clippy run, and the
// toolchain identity for the context (PLAN 8.4). Every call shells out to cargo.
import { spawnSync } from "node:child_process";
import path from "node:path";

export class CargoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CargoError";
  }
}

// A workspace member: one task (spec/adapters/clippy.md). `dir` is the directory
// of its Cargo.toml, absolute. `id` is cargo's package id, as in compiler-artifact.
export interface Member {
  id: string;
  name: string;
  dir: string;
}

export interface Workspace {
  // Directory of the workspace Cargo.toml, absolute.
  root: string;
  members: Member[];
}

export function workspaceOf(repo: string): Workspace {
  const r = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error !== undefined) throw new CargoError(`cannot run cargo: ${r.error.message}`);
  if (r.status !== 0) throw new CargoError(`cargo metadata failed: ${(r.stderr || "").trim()}`);
  const meta = JSON.parse(r.stdout) as {
    packages: { id: string; name: string; manifest_path: string }[];
    workspace_members: string[];
    workspace_root: string;
  };
  const ids = new Set(meta.workspace_members);
  const members = meta.packages
    .filter((p) => ids.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, dir: path.dirname(p.manifest_path) }))
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return { root: meta.workspace_root, members };
}

// rustc, cargo and the clippy component, as one string. Throws when clippy is
// not installed, because the adapter cannot check anything without it.
export function toolchain(cwd: string): string {
  const version = (cmd: string, args: string[]): string => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    if (r.error !== undefined || r.status !== 0) {
      throw new CargoError(`${cmd} ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
    }
    return r.stdout.trim();
  };
  return [version("rustc", ["-V"]), version("cargo", ["-V"]), version("cargo", ["clippy", "--version"])].join(" | ");
}

// One JSON line from cargo --message-format=json. Only the fields the recorder reads are typed.
export type Message = { reason: string } & Record<string, unknown>;

export interface ClippyRun {
  status: number | null;
  signal: NodeJS.Signals | null;
  error: string | null;
  messages: Message[];
  stderr: string;
  durationMs: number;
}

// `cargo clippy -p <name> --all-targets` into targetDir. The run covers the
// package's lib, bin, test, bench and example targets and every unit it depends on.
export function clippy(root: string, pkg: string, targetDir: string, timeoutMs: number): ClippyRun {
  const started = Date.now();
  const r = spawnSync(
    "cargo",
    ["clippy", "-p", pkg, "--all-targets", "--target-dir", targetDir, "--message-format=json"],
    { cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 * 1024 },
  );
  const messages = (r.stdout ?? "")
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Message);
  return {
    status: r.status,
    signal: r.signal,
    error: r.error?.message ?? null,
    messages,
    stderr: r.stderr ?? "",
    durationMs: Date.now() - started,
  };
}

// One cargo package as a task (spec/adapters/clippy.md). The task id is the
// repo-relative directory of its Cargo.toml ("." for a root package, PLAN D-2).
// Its inputs come from the run: every file rustc read for the package and for
// each unit it depends on (dep-info), the files its build script watches, and the
// declared config files on its path. Each file is hashed after the run.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Input } from "@incremental/client";
import { buildScriptWatches, depInfoFor, parseDepInfo } from "./depinfo.js";
import { type Member, type Message, type Workspace } from "./cargo.js";

// Config files cargo and clippy read from a crate's directory up to the root.
const DECLARED_NAMES = [
  "Cargo.toml",
  "clippy.toml",
  ".clippy.toml",
  "rust-toolchain.toml",
  ".cargo/config.toml",
];

export type FileInput = Extract<Input, { kind: "file" }>;
export type DeclaredInput = Extract<Input, { kind: "declared" }>;

export interface Observed {
  inputs: (FileInput | DeclaredInput)[];
  // The observation cannot be complete: the run read something the recorder
  // cannot name repo-relative or cannot see (PLAN 11.1 point 4).
  dirty: boolean;
  reasons: string[];
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

export function inside(dir: string, abs: string): boolean {
  return abs === dir || abs.startsWith(dir + path.sep);
}

// Repo-relative task id for a member directory.
export function taskId(root: string, dir: string): string {
  if (!inside(root, dir)) throw new Error(`workspace member ${dir} is outside the repository`);
  const rel = relPath(root, dir);
  return rel === "" ? "." : rel;
}

// Task ids of every workspace member, sorted. Throws when a member lies outside the repository.
export function memberTasks(ws: Workspace, root: string): { task: string; member: Member }[] {
  return ws.members
    .map((member) => ({ task: taskId(root, member.dir), member }))
    .sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));
}

// Config files on the path from a member's directory up to the repository root.
export function declaredPaths(root: string, dir: string): string[] {
  const out: string[] = [];
  for (let d = dir, atRoot = false; !atRoot && inside(root, d); d = path.dirname(d)) {
    for (const name of DECLARED_NAMES) out.push(path.join(d, name));
    atRoot = d === root;
  }
  return out;
}

// Observe one clippy run of `member`. `messages` is the run's JSON output. It
// lists every unit in the member's build graph, fresh or not, so the closure of
// the member's dependencies is read from it.
export function observeTask(opts: {
  root: string;
  ws: Workspace;
  member: Member;
  messages: Message[];
  targetDir: string;
}): Observed {
  const { root, ws, member, messages, targetDir } = opts;
  const inputs = new Map<string, FileInput | DeclaredInput>();
  const reasons = new Set<string>();
  const byId = new Map(ws.members.map((m) => [m.id, m]));
  const closure = new Set<Member>([member]);

  const addSource = (abs: string): void => {
    if (inside(targetDir, abs)) return; // build products, derived from the sources
    if (!inside(root, abs)) {
      reasons.add(`reads a file outside the repository: ${abs}`);
      return;
    }
    const rel = relPath(root, abs);
    if (!existsSync(abs)) {
      reasons.add(`file read by the run is gone: ${rel}`);
      return;
    }
    inputs.set(`file\0${rel}`, { kind: "file", path: rel, hash: sha256(readFileSync(abs)) });
  };

  for (const m of messages) {
    if (m.reason === "compiler-artifact") {
      const pkgId = String(m.package_id);
      const found = byId.get(pkgId);
      if (found !== undefined) closure.add(found);
      const target = m.target as { kind: string[] };
      const filenames = m.filenames as string[];
      const depFile =
        filenames.map((f) => depInfoFor(f, target.kind)).find((f) => f !== null) ?? null;
      if (depFile !== null) {
        for (const dep of parseDepInfo(readFileSync(depFile, "utf8"))) {
          addSource(path.resolve(ws.root, dep));
        }
      } else {
        reasons.add(`no dep-info for a unit of ${pkgId}`);
      }
    }
  }

  for (const m of messages) {
    if (m.reason === "build-script-executed") {
      const pkgId = String(m.package_id);
      const owner = byId.get(pkgId);
      if (owner !== undefined) {
        const outFile = path.join(path.dirname(String(m.out_dir)), "output");
        if (existsSync(outFile)) {
          const watched = buildScriptWatches(readFileSync(outFile, "utf8"));
          if (watched.files.length === 0)
            reasons.add(`build script of ${owner.name} has no rerun-if-changed line`);
          if (watched.envs.length > 0)
            reasons.add(
              `build script of ${owner.name} reads environment variables, which are not recorded`,
            );
          for (const w of watched.files) {
            const abs = path.resolve(owner.dir, w);
            if (inside(root, abs)) {
              const rel = relPath(root, abs);
              inputs.set(
                `file\0${rel}`,
                existsSync(abs)
                  ? { kind: "file", path: rel, hash: sha256(readFileSync(abs)) }
                  : { kind: "file", path: rel, hash: "absent" },
              );
            } else {
              reasons.add(
                `build script of ${owner.name} watches a file outside the repository: ${abs}`,
              );
            }
          }
        } else {
          reasons.add(`no output for the build script of ${owner.name}`);
        }
      } else {
        reasons.add(`build script of ${pkgId} is outside the workspace`);
      }
    }
  }

  // Declared inputs: the config files on each member's path, and the workspace
  // manifest and lock file. Hashed as "absent" when missing, so creating one counts as a change.
  const declared = [...closure].flatMap((m) => declaredPaths(root, m.dir));
  declared.push(path.join(ws.root, "Cargo.toml"), path.join(ws.root, "Cargo.lock"));
  for (const abs of new Set(declared)) {
    if (inside(root, abs)) {
      const rel = relPath(root, abs);
      inputs.set(`declared\0${rel}`, {
        kind: "declared",
        path: rel,
        hash: existsSync(abs) ? sha256(readFileSync(abs)) : "absent",
      });
    } else {
      reasons.add(`declared file outside the repository: ${abs}`);
    }
  }

  const sorted = [...inputs.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return { inputs: sorted, dirty: reasons.size > 0, reasons: [...reasons].sort() };
}

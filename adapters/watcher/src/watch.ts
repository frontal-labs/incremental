// The file-system watch (spec/adapters/watcher.md). File events only wake the
// caller up. The changes are never read from the events: state() compares a
// fresh stat walk of the tree with the snapshot taken at the start of the window.
// So an event the OS drops (macOS FSEvents can coalesce or lose them silently)
// delays a run but cannot hide a change. A file whose mtime is too close to the
// snapshot to tell a later edit apart (the "racy" case of git) is hashed at
// snapshot time and compared by content.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { Change } from "@incremental/client";

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// Directories the watcher never enters or reports. Task inputs must not lie under them.
export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".incremental", ".toolchain"]);

type Kind = "file" | "dir" | "other";

export interface WatchState {
  changes: Change[];
  // Why the changes cannot be trusted as a complete set, or null.
  lost: string | null;
}

export function relOf(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

// Every entry under dir as repo-relative path to kind, skipping SKIP_DIRS and not
// following symbolic links. Used for the start snapshot and for new directories.
// Stat signature of a file at snapshot time.
export interface Entry {
  kind: Kind;
  size: number;
  mtimeMs: number;
  ino: number;
  // Content hash, taken at snapshot time for a racy file only.
  hash?: string;
}

// A file modified within this many milliseconds before the snapshot is racy:
// a later edit could carry the same timestamp, so its stat cannot be trusted.
const RACY_MS = 2_000;

// Every entry under dir with its stat signature, skipping SKIP_DIRS and not
// following symbolic links.
export function statWalk(root: string, dir: string, out: Map<string, Entry> = new Map()): Map<string, Entry> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = relOf(root, abs);
    const st = lstatSync(abs);
    const kind: Kind = st.isFile() ? "file" : st.isDirectory() ? "dir" : "other";
    out.set(rel, { kind, size: st.size, mtimeMs: st.mtimeMs, ino: st.ino });
    if (kind === "dir") statWalk(root, abs, out);
  }
  return out;
}

export function walk(root: string, dir: string, out: Map<string, Kind> = new Map()): Map<string, Kind> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = relOf(root, abs);
    if (entry.isDirectory()) {
      out.set(rel, "dir");
      walk(root, abs, out);
    } else if (entry.isFile()) {
      out.set(rel, "file");
    } else {
      out.set(rel, "other");
    }
  }
  return out;
}

function kindOf(abs: string): Kind | null {
  try {
    const st = lstatSync(abs);
    return st.isFile() ? "file" : st.isDirectory() ? "dir" : "other";
  } catch {
    return null;
  }
}

export class Watcher {
  readonly root: string;
  private handle: FSWatcher | null = null;
  // The tree at the start of the current window (the baseline view).
  private base = new Map<string, Entry>();
  private baseTime = 0;
  // Duration of the last state() walk, in milliseconds.
  lastWalkMs = 0;
  private lostReason: string | null = null;
  // Incremented on every event or loss. A caller compares it to detect events
  // that happened during a run. It is a wake-up signal only, never a change list.
  generation = 0;

  constructor(root: string) {
    this.root = realpathSync(root);
  }

  // Starts watching and snapshots the tree. The watch is opened first so an
  // edit during the snapshot is recorded, not missed.
  start(): void {
    this.stop();
    this.handle = watch(this.root, { recursive: true, encoding: "utf8" }, (_event, name) => this.onEvent(name));
    this.handle.on("error", (e: Error) => this.loss(`watch error: ${e.message}`));
    this.rebase();
  }

  // A new window: the current tree is the baseline view and nothing is changed.
  rebase(): void {
    this.baseTime = Date.now();
    this.base = statWalk(this.root, this.root);
    for (const [rel, entry] of this.base) {
      if (entry.kind === "file" && this.racyAt(entry, this.baseTime)) {
        entry.hash = sha256(readFileSync(path.join(this.root, rel)));
      }
    }
    this.lostReason = null;
    this.generation++;
  }

  stop(): void {
    this.handle?.close();
    this.handle = null;
  }

  // Reports a loss from outside the event stream (for example an overflow the
  // caller learned about). The window cannot be trusted until rebase().
  loss(reason: string): void {
    this.lostReason ??= reason;
    this.generation++;
  }

  private onEvent(name: string | null): void {
    if (typeof name !== "string") return this.loss("event without a file name");
    const segments = name.split(path.sep).join("/").split("/");
    if (segments.some((s) => SKIP_DIRS.has(s))) return;
    this.generation++;
  }

  // The changes since the window started, from a fresh walk against the
  // snapshot. A file is added or deleted by its presence, modified by its stat
  // signature (or by the racy rule). A removed or replaced directory, or a
  // symbolic link, is lost: it cannot be compared entry by entry.
  state(): WatchState {
    const started = performance.now();
    const fresh = statWalk(this.root, this.root);
    this.lastWalkMs = performance.now() - started;
    const changes: Change[] = [];
    let lost = this.lostReason;
    for (const [rel, now] of fresh) {
      if (now.kind === "other") {
        lost ??= `symbolic link or special file: ${rel}`;
        continue;
      }
      if (now.kind === "dir") continue;
      const before = this.base.get(rel);
      if (before === undefined) {
        changes.push({ path: rel, status: "added" });
      } else if (before.kind !== "file") {
        lost ??= `directory or link replaced by a file: ${rel}`;
      } else if (before.hash !== undefined) {
        if (sha256(readFileSync(path.join(this.root, rel))) !== before.hash) changes.push({ path: rel, status: "modified" });
      } else if (before.size !== now.size || before.mtimeMs !== now.mtimeMs || before.ino !== now.ino) {
        changes.push({ path: rel, status: "modified" });
      }
    }
    for (const [rel, before] of this.base) {
      if (before.kind === "other") continue;
      const now = fresh.get(rel);
      if (now === undefined) {
        if (before.kind === "dir") lost ??= `directory removed: ${rel}`;
        else changes.push({ path: rel, status: "deleted" });
      } else if (before.kind === "dir" && now.kind !== "dir") {
        lost ??= `directory replaced: ${rel}`;
      } else if (before.kind === "file" && now.kind === "dir") {
        lost ??= `file replaced by a directory: ${rel}`;
      }
    }
    return { changes: changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)), lost };
  }

  private racyAt(entry: Entry, time: number): boolean {
    return entry.mtimeMs >= time - RACY_MS;
  }
}

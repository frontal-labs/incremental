// The file-system event source (spec/adapters/watcher.md). It records which
// paths under root changed since it started, and classifies them against the
// file set it walked at start. An event it cannot classify, or a loss it is told
// about, makes the state "lost": the caller must run everything.
import { lstatSync, readdirSync, realpathSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { Change } from "@backplane/client";

// Directories the watcher never enters or reports. Task inputs must not lie under them.
export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".backplane", ".toolchain"]);

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
  // Kinds of the paths at the start of the current window (the baseline view).
  private base = new Map<string, Kind>();
  private changed = new Set<string>();
  private lostReason: string | null = null;
  // Incremented on every recorded event or loss. A caller compares it to detect
  // events that happened during a run.
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
    this.base = walk(this.root, this.root);
    this.changed.clear();
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
    this.changed.add(segments.join("/"));
    this.generation++;
  }

  // The changes since the window started, classified against its baseline view.
  // A path is modified or added if it is a file now, deleted if it was a file at
  // the start and is gone. A removed or replaced directory, or a symbolic link,
  // is lost: its contents are not enumerated by an event.
  state(): WatchState {
    const changes = new Map<string, Change>();
    const queue = [...this.changed].sort();
    const seen = new Set<string>();
    let lost = this.lostReason;
    for (let i = 0; i < queue.length; i++) {
      const rel = queue[i] as string;
      if (seen.has(rel)) continue;
      seen.add(rel);
      const before = this.base.get(rel);
      const now = kindOf(path.join(this.root, rel));
      if (now === null) {
        if (before === "dir") lost ??= `directory removed: ${rel}`;
        else if (before !== undefined) changes.set(rel, { path: rel, status: "deleted" });
      } else if (now === "dir") {
        if (before === "file" || before === "other") lost ??= `file replaced by a directory: ${rel}`;
        else if (before === undefined) {
          // A new directory: its files are added. Walk it so none is missed.
          for (const [child, kind] of walk(this.root, path.join(this.root, rel))) {
            if (kind === "file") queue.push(child);
            else if (kind === "other") lost ??= `symbolic link or special file: ${child}`;
          }
        }
      } else if (now === "file") {
        if (before === "dir" || before === "other") lost ??= `directory or link replaced by a file: ${rel}`;
        else changes.set(rel, { path: rel, status: before === "file" ? "modified" : "added" });
      } else {
        lost ??= `symbolic link or special file: ${rel}`;
      }
    }
    return { changes: [...changes.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)), lost };
  }
}

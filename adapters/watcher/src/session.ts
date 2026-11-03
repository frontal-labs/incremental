// The watcher loop (spec/adapters/watcher.md). A session holds the event history
// since a store baseline B and turns it into a ChangeSet for `affected`. It mirrors
// the typescript run loop (PLAN 10.4) for observe and advance, with one difference:
// the history is only complete if the watch was running and the tree equalled B
// when it started, so the session advances only from a complete history.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  connect,
  defaultEngine,
  repoRoot,
  type backplane,
  type Change,
  type Context,
  type Input,
  type Observation,
  type Outcome,
  type Plan,
} from "@backplane/client";
import { relOf, SKIP_DIRS, Watcher, walk } from "./watch.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// A task: a command and the repo-relative files or directories it reads. Inputs
// are declared, not traced: the watcher cannot see what the command reads.
export interface TaskDef {
  id: string;
  command: string[];
  inputs: string[];
}

export interface SessionOptions {
  root: string;
  store: string;
  tasks: TaskDef[];
  timeoutMs: number;
}

export interface TaskRun {
  task: string;
  outcome: Outcome;
  durationMs: number;
}

export interface CycleReport {
  // "full" runs every task; "incremental" runs the tasks `affected` selected.
  mode: "full" | "incremental";
  // Why the cycle is full, or null when it is incremental.
  reason: string | null;
  stored: string | null;
  changes: Change[];
  plan: Plan | null;
  selected: string[];
  results: TaskRun[];
  advanced: boolean;
  headEnd: string;
}

const require_ = createRequire(import.meta.url);
const WATCHER_RUNNER = `backplane-watcher@${(require_("../../package.json") as { version: string }).version}`;

function gitSourcePath(): string {
  return process.env.BACKPLANE_GIT || path.join(repoRoot(), "adapters", "git", "dist", "backplane-git");
}

// The git change source (PLAN 11.7), used only for the baseline check and for
// the advance. The watcher itself runs no git.
interface GitChangeSet {
  baseline: string;
  head: string;
  dirty: boolean;
  changes: Change[];
}

function gitChangeSet(root: string, ref: string): GitChangeSet {
  const r = spawnSync(gitSourcePath(), ["changes", "--base", ref, "--root", root], { encoding: "utf8" });
  if (r.error !== undefined) throw new Error(`cannot run the git change source: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git change source failed (exit ${r.status}): ${(r.stdout || r.stderr || "").trim()}`);
  return JSON.parse(r.stdout) as GitChangeSet;
}

// The context (PLAN 8.4). The watcher observes no tool, lockfile or probe, so the
// reserved keys are constant and caps are all false. In balanced mode that makes
// any change to a path that is not a task input a fallback (P6, P7), which is sound.
export function contextFor(): Context {
  return {
    lockfile: "absent",
    tsconfig: "absent",
    pkgjson: "absent",
    runner: WATCHER_RUNNER,
    node: process.version,
    fmt: 1,
    caps: { probes: false, dirs: false, env: false },
  };
}

type FileInput = Extract<Input, { kind: "file" }>;

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// The file inputs of a task: each declared path, directories expanded. Missing
// paths contribute nothing (a later creation is an added path, which falls back).
export function inputsOf(root: string, task: TaskDef): FileInput[] {
  const files = new Map<string, FileInput>();
  for (const entry of task.inputs) {
    const abs = path.resolve(root, entry);
    const rel = relOf(root, abs);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new ConfigError(`task ${task.id}: input ${entry} is outside the repository`);
    }
    if (rel.split("/").some((s) => SKIP_DIRS.has(s))) {
      throw new ConfigError(`task ${task.id}: input ${entry} is under an ignored directory`);
    }
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    const kinds: Map<string, string> = st.isDirectory() ? walk(root, abs) : new Map([[rel, "file"]]);
    for (const [child, kind] of kinds) {
      if (kind !== "file") continue;
      files.set(child, { kind: "file", path: child, hash: sha256(readFileSync(path.join(root, child))) });
    }
  }
  return [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export class Session {
  private client: backplane | null = null;
  private readonly watcher: Watcher;
  // The baseline the event history is complete since, or null.
  private base: string | null = null;
  // The first cycle of a session runs everything: a restart has no history.
  private first = true;

  constructor(private readonly opts: SessionOptions) {
    this.watcher = new Watcher(opts.root);
  }

  // Connects to the store and opens a watch window against the stored baseline.
  async open(): Promise<void> {
    this.client = await connect({
      store: this.opts.store,
      root: this.opts.root,
      command: [defaultEngine(), "serve"],
      timeoutMs: 60_000,
    });
    await this.arm();
  }

  async close(): Promise<void> {
    this.watcher.stop();
    await this.client?.close();
    this.client = null;
  }

  // Events the watcher has recorded since the window started, for callers that
  // want to know whether a cycle has work to do.
  pending(): number {
    return this.watcher.state().changes.length;
  }

  // Reports an event loss from outside the watcher (for example a dropped
  // notification). The next cycle runs everything.
  reportLoss(reason: string): void {
    this.watcher.loss(reason);
  }

  // Starts a new window. The history is complete only if the tree equalled the
  // stored baseline when the window started, and the window is then the baseline.
  private async arm(): Promise<void> {
    this.watcher.start();
    const stored = (await this.need().baseline()).baseline;
    this.base = null;
    if (stored === null) return;
    let cs: GitChangeSet;
    try {
      cs = gitChangeSet(this.opts.root, stored);
    } catch {
      return;
    }
    if (cs.baseline === stored && cs.changes.length === 0 && !cs.dirty) this.base = stored;
  }

  private need(): backplane {
    if (this.client === null) throw new Error("the session is not open");
    return this.client;
  }

  // One cycle: the ChangeSet since the stored baseline, `affected`, the selected
  // tasks run and observed, then advance if the history was complete.
  async cycle(): Promise<CycleReport> {
    const client = this.need();
    const { root } = this.opts;
    const stored = (await client.baseline()).baseline;
    const startHead = gitChangeSet(root, "HEAD").head;
    const gen = this.watcher.generation;
    const state = this.watcher.state();
    const complete = this.base !== null && this.base === stored && state.lost === null;

    let reason: string | null = null;
    if (this.first) reason = "no_history";
    else if (this.base === null) reason = "not_watching_since_baseline";
    else if (this.base !== stored) reason = "baseline_moved";
    else if (state.lost !== null) reason = `watcher_lost: ${state.lost}`;

    let plan: Plan | null = null;
    if (reason === null && stored !== null) {
      plan = await client.affected(
        { baseline: stored, changes: state.changes },
        {
          baseline: stored,
          context: contextFor(),
          declared_tasks: this.opts.tasks.map((t) => t.id),
          verify: false,
          policy: "balanced",
        },
      );
      if (plan.fallback !== null) reason = `${plan.fallback.reason}`;
      const declared = new Set(this.opts.tasks.map((t) => t.id));
      if (reason === null && plan.tasks.some((t) => !declared.has(t.id))) reason = "plan_unknown_task";
    }

    const full = reason !== null || stored === null;
    const selectedIds = full ? this.opts.tasks.map((t) => t.id) : (plan?.tasks ?? []).map((t) => t.id);
    const selected = this.opts.tasks.filter((t) => selectedIds.includes(t.id));

    const results: TaskRun[] = [];
    const observations: Observation[] = [];
    const obsBaseline = stored ?? startHead;
    for (const task of selected) {
      const inputs = inputsOf(root, task);
      const run = runTask(root, task, this.opts.timeoutMs);
      results.push({ task: task.id, ...run });
      observations.push({
        task: task.id,
        baseline: obsBaseline,
        dirty: true,
        context: contextFor(),
        inputs,
        outputs: [],
        outcome: run.outcome,
        duration_ms: run.durationMs,
      });
    }

    const end = gitChangeSet(root, "HEAD");
    // The tree is clean at HEAD, the window covered the baseline, and no event
    // arrived during the run: the runs saw exactly the tree that the baseline names.
    const treeClean = complete && !end.dirty && end.head === startHead && this.watcher.generation === gen;
    // Observations are reusable only from a clean tree (dirty ones are never trusted).
    for (const o of observations) o.dirty = !treeClean;
    if (observations.length > 0) await client.observeMany(observations);

    const allRan = results.every((r) => r.outcome !== "error");
    const canAdvance = treeClean && stored !== null && allRan;
    let advanced = false;
    if (canAdvance && end.head !== stored) {
      await client.advance(end.head, stored);
      advanced = true;
      this.base = end.head;
      this.watcher.rebase();
    }
    // A full cycle that did not advance starts a new window, so the next cycle can
    // be incremental again if the tree equals the stored baseline.
    if (full && !advanced) await this.arm();

    const report: CycleReport = {
      mode: full ? "full" : "incremental",
      reason,
      stored,
      changes: state.changes,
      plan,
      selected: selected.map((t) => t.id),
      results,
      advanced,
      headEnd: end.head,
    };
    this.first = false;
    return report;
  }
}

// Runs one task command in the repository. A command that cannot start, or is
// killed, is an error, never a pass.
export function runTask(root: string, task: TaskDef, timeoutMs: number): { outcome: Outcome; durationMs: number } {
  const started = Date.now();
  const [cmd, ...args] = task.command;
  if (cmd === undefined) throw new ConfigError(`task ${task.id}: empty command`);
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const durationMs = Date.now() - started;
  if (r.error !== undefined || r.signal !== null) return { outcome: "error", durationMs };
  return { outcome: r.status === 0 ? "pass" : "fail", durationMs };
}

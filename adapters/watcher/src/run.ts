#!/usr/bin/env node
// `backplane-watcher watch`: the watcher loop. Runs a cycle every --interval
// milliseconds (default 1000), --cycles times (default: until interrupted).
//
// Exit codes: 0 every run task passed; 1 a task failed; 2 usage error; 4 engine or setup error.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { defaultEngine } from "@backplane/client";
import { type CycleReport, ConfigError, Session, type TaskDef } from "./session.js";

export interface WatchOptions {
  root: string;
  store: string;
  tasks: TaskDef[];
  intervalMs: number;
  cycles: number;
  timeoutMs: number;
  json: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function loadTasks(file: string): TaskDef[] {
  if (!existsSync(file)) throw new UsageError(`no task file at ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new UsageError(`cannot parse ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(raw)) throw new UsageError(`${file} must hold a JSON array of tasks`);
  const ids = new Set<string>();
  return raw.map((t: unknown, i) => {
    const o = t as Partial<TaskDef>;
    const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
    if (typeof o.id !== "string" || o.id === "" || !strings(o.command) || o.command.length === 0 || !strings(o.inputs)) {
      throw new UsageError(`task ${i} needs id, command (non-empty string array) and inputs (string array)`);
    }
    if (ids.has(o.id)) throw new UsageError(`duplicate task id ${o.id}`);
    ids.add(o.id);
    return { id: o.id, command: o.command, inputs: o.inputs };
  });
}

export function parseArgs(argv: string[]): WatchOptions {
  const [cmd, ...rest] = argv;
  const usage = "usage: backplane-watcher watch --tasks FILE [--interval MS] [--cycles N] [--json] [--store DIR] [--root DIR] [--timeout MS]";
  if (cmd !== "watch") throw new UsageError(usage);
  const opts: WatchOptions = { root: process.cwd(), store: "", tasks: [], intervalMs: 1000, cycles: 0, timeoutMs: 600_000, json: false };
  let tasksFile: string | null = null;
  let storeGiven = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    const value = (): string => {
      const v = rest[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      return v;
    };
    const int = (min: number): number => {
      const n = Number(value());
      if (!Number.isInteger(n) || n < min) throw new UsageError(`${a} needs an integer >= ${min}`);
      return n;
    };
    switch (a) {
      case "--tasks": tasksFile = value(); break;
      case "--interval": opts.intervalMs = int(0); break;
      case "--cycles": opts.cycles = int(0); break;
      case "--timeout": opts.timeoutMs = int(1); break;
      case "--json": opts.json = true; break;
      case "--store": opts.store = value(); storeGiven = true; break;
      case "--root": opts.root = value(); break;
      default: throw new UsageError(`unknown option ${a}`);
    }
  }
  if (tasksFile === null) throw new UsageError(usage);
  opts.root = path.resolve(opts.root);
  if (!storeGiven) opts.store = process.env.BACKPLANE_STORE || path.join(opts.root, ".backplane");
  opts.store = path.resolve(opts.store);
  opts.tasks = loadTasks(path.resolve(tasksFile));
  return opts;
}

function ensureStore(store: string): void {
  if (existsSync(store)) return;
  const r = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
  if (r.status !== 0) throw new UsageError(`cannot create the store at ${store}: ${(r.stderr || "").trim()}`);
}

function describe(n: number, r: CycleReport): string {
  const counts = { pass: 0, fail: 0, error: 0 } as Record<string, number>;
  for (const t of r.results) counts[t.outcome] = (counts[t.outcome] ?? 0) + 1;
  const why = r.reason === null ? "" : ` (${r.reason})`;
  return [
    `cycle ${n}: ${r.mode}${why}, stored ${r.stored ?? "none"}, changes ${r.changes.length}`,
    `  selected [${r.selected.join(", ")}]: pass ${counts.pass}, fail ${counts.fail}, error ${counts.error}`,
    `  ${r.advanced ? `advanced to ${r.headEnd}` : "not advanced"}`,
  ].join("\n");
}

export async function main(argv: string[]): Promise<number> {
  let opts: WatchOptions;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  let code = 0;
  let session: Session | null = null;
  try {
    ensureStore(opts.store);
    session = new Session({ root: opts.root, store: opts.store, tasks: opts.tasks, timeoutMs: opts.timeoutMs });
    await session.open();
    for (let n = 1; opts.cycles === 0 || n <= opts.cycles; n++) {
      const report = await session.cycle();
      if (opts.json) process.stdout.write(JSON.stringify(report) + "\n");
      else process.stdout.write(describe(n, report) + "\n");
      if (report.results.some((t) => t.outcome === "fail")) code = 1;
      if (opts.cycles === 0 || n < opts.cycles) await new Promise((res) => setTimeout(res, opts.intervalMs));
    }
    return code;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`backplane watcher: ${message}\n`);
    return e instanceof ConfigError || e instanceof UsageError ? 2 : 4;
  } finally {
    await session?.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

#!/usr/bin/env node
// `backplane-process run [NAME...]`: runs tasks from backplane-process.json.
//
// Exit codes: 0 every task passed; 1 a task failed; 2 usage error;
// 4 engine or setup error, or a task could not run (outcome error).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultEngine } from "@backplane/client";
import { runTasks, type TaskRun } from "./index.js";

const USAGE = "usage: backplane-process run [NAME...] [--root DIR] [--store DIR] [--timeout MS]";

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd !== "run") {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let root = process.cwd();
  let store = "";
  let timeoutMs = 600_000;
  const names: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    const value = (): string | undefined => rest[++i];
    if (a === "--root" || a === "--store" || a === "--timeout") {
      const v = value();
      if (v === undefined) {
        process.stderr.write(`${a} needs a value\n${USAGE}\n`);
        return 2;
      }
      if (a === "--root") root = path.resolve(v);
      else if (a === "--store") store = v;
      else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) {
          process.stderr.write(`--timeout needs a positive integer\n`);
          return 2;
        }
        timeoutMs = n;
      }
    } else if (a.startsWith("--")) {
      process.stderr.write(`unknown option ${a}\n${USAGE}\n`);
      return 2;
    } else {
      names.push(a);
    }
  }
  if (store === "") store = process.env.BACKPLANE_STORE || path.join(root, ".backplane");
  try {
    if (!existsSync(store)) {
      mkdirSync(path.dirname(store), { recursive: true });
      const init = spawnSync(defaultEngine(), ["init", "--store", store], { encoding: "utf8" });
      if (init.status !== 0) throw new Error(`cannot create the store at ${store}: ${(init.stderr || "").trim()}`);
    }
    const results = await runTasks({ root, store, names: names.length > 0 ? names : undefined, timeoutMs });
    printResults(results);
    if (results.some((r) => r.outcome === "error")) return 4;
    if (results.some((r) => r.outcome === "fail")) return 1;
    return 0;
  } catch (e) {
    process.stderr.write(`backplane-process: ${e instanceof Error ? e.message : String(e)}\n`);
    return 4;
  }
}

function printResults(results: TaskRun[]): void {
  const lines = results.map((r) => {
    const note = r.problem !== null ? ` (${r.problem})` : "";
    return `${r.outcome} ${r.task}${r.dirty ? " dirty" : ""}${note}`;
  });
  process.stdout.write(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

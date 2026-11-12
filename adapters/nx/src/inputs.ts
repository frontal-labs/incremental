// The Nx project graph (`nx graph --file`): project names, their roots, and their dependency
// edges. The adapter's tasks are the projects; their inputs come from the recorder (run.ts).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectGraph {
  roots: Record<string, string>;
  deps: Record<string, string[]>;
}

export function projectGraph(root: string, nxBin: string): ProjectGraph {
  const dir = mkdtempSync(path.join(os.tmpdir(), "incremental-nx-graph-"));
  const file = path.join(dir, "graph.json");
  try {
    const r = spawnSync(nxBin, ["graph", `--file=${file}`, "--no-interactive"], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (r.status !== 0) throw new Error(`nx graph failed: ${r.stderr || r.stdout}`);
    const g = JSON.parse(readFileSync(file, "utf8")).graph;
    const roots: Record<string, string> = {};
    for (const [name, node] of Object.entries<{ data?: { root?: string } }>(g.nodes ?? {})) {
      roots[name] = node.data?.root ?? name;
    }
    const deps: Record<string, string[]> = {};
    for (const [name, edges] of Object.entries<{ target: string }[]>(g.dependencies ?? {})) {
      deps[name] = [...new Set(edges.map((e) => e.target))].filter((t) => t !== name).sort();
    }
    return { roots, deps };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface TestCommand {
  command: string;
  cwd: string;
}

// The command that tests a project: the `test` target of its project.json (its command, run in
// the target's cwd, relative to the workspace), or else the `test` script of its package.json,
// run in the project directory.
export function testCommand(root: string, projectRoot: string): TestCommand {
  const projectFile = path.join(root, projectRoot, "project.json");
  if (existsSync(projectFile)) {
    const target = JSON.parse(readFileSync(projectFile, "utf8")).targets?.test;
    const command = target?.options?.command;
    if (typeof command === "string")
      return { command, cwd: path.join(root, target.options.cwd ?? projectRoot) };
  }
  const pkgFile = path.join(root, projectRoot, "package.json");
  if (existsSync(pkgFile)) {
    const script = JSON.parse(readFileSync(pkgFile, "utf8")).scripts?.test;
    if (typeof script === "string") return { command: script, cwd: path.join(root, projectRoot) };
  }
  throw new Error(`no test command for the project at ${projectRoot}`);
}

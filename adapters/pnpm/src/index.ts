// @backplane/pnpm: the pnpm workspace adapter (spec/adapters/pnpm.md).
export { closure, contextFor, declaredInputs, tasksOf, workspacePackages } from "./project.js";
export type { DeclaredInput, Pkg, TaskDef } from "./project.js";
export { parseArgs, runAdapter, UsageError } from "./run.js";
export type { ProjectRun, RunOptions, RunReport } from "./run.js";

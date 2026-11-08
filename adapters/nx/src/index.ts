// @frontal-labs/incremental-nx: the Nx adapter (spec/adapters/nx.md).
export { runAdapter, main, parseArgs, UsageError } from "./run.js";
export type { RunOptions, RunReport, TaskRun } from "./run.js";
export { contextFor } from "./planner.js";

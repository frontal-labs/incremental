// @frontal-labs/incremental-vitest: the Vitest adapter (PLAN 11.2 to 11.3).
export { runAdapter, main, parseArgs, UsageError } from "./run.js";
export type { RunOptions, RunReport, TaskRun } from "./run.js";
export { buildObservation, runFile } from "./record.js";
export type { FileResult, TraceEvent } from "./record.js";

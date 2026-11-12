// @incremental/clippy: the Cargo/Clippy adapter (spec/adapters/clippy.md).
export { clippy, toolchain, workspaceOf, CargoError } from "./cargo.js";
export type { ClippyRun, Member, Message, Workspace } from "./cargo.js";
export { buildScriptWatches, depInfoFor, parseDepInfo } from "./depinfo.js";
export { declaredPaths, memberTasks, observeTask, taskId } from "./project.js";
export type { Observed } from "./project.js";
export { contextFor, outcomeOf, parseArgs, runAdapter, UsageError } from "./run.js";
export type { ProjectRun, RunOptions, RunReport } from "./run.js";

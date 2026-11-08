// @frontal-labs/incremental-watcher: the file-system change source (spec/adapters/watcher.md).
export { Watcher, walk, SKIP_DIRS } from "./watch.js";
export type { WatchState } from "./watch.js";
export { ConfigError, contextFor, inputsOf, runTask, Session } from "./session.js";
export type { CycleReport, SessionOptions, TaskDef, TaskRun } from "./session.js";
export { loadTasks, parseArgs, UsageError } from "./run.js";

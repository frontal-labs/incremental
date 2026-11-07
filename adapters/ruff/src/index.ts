// @incremental/ruff: the ruff file adapter (spec/adapters/ruff.md).
export {
  checkFile,
  configChain,
  discoverFiles,
  relPath,
  ruffRunner,
  settingsPath,
  taskId,
} from "./project.js";
export type { CheckResult, ConfigChain } from "./project.js";
export { contextFor, inputsFor, parseArgs, runAdapter, UsageError } from "./run.js";
export type { FileRun, RunOptions, RunReport } from "./run.js";

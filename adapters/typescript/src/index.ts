// @frontal-labs/incremental-typescript: the TypeScript project adapter (spec/adapters/typescript.md).
export {
  checkProject,
  configChain,
  discoverProjects,
  packageJsonsFor,
  programFiles,
  typescriptVersion,
} from "./project.js";
export type { CheckResult, ConfigChain } from "./project.js";
export { contextFor, parseArgs, runAdapter, UsageError } from "./run.js";
export type { ProjectRun, RunOptions, RunReport } from "./run.js";

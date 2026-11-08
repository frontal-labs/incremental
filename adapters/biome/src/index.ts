// @frontal-labs/incremental-biome: the Biome file adapter (spec/adapters/biome.md).
export {
  BiomeError,
  biomeBin,
  biomeVersion,
  checkDiagnostics,
  configInputs,
  processedFiles,
} from "./biome.js";
export type { ConfigInputs, Diagnostic } from "./biome.js";
export { contextFor, parseArgs, runAdapter, taskId, UsageError } from "./run.js";
export type { FileRun, RunOptions, RunReport } from "./run.js";

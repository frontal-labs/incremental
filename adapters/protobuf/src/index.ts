// @incremental/protobuf: the protoc and buf adapter (spec/adapters/protobuf.md).
export {
  bufVersion,
  classifyDeps,
  compileProto,
  checkBuf,
  discoverTargets,
  parseDepFile,
  protocVersion,
  wellKnownDigest,
} from "./protoc.js";
export type { BufCheck, Compile, Outcome, Targets } from "./protoc.js";
export { contextFor, parseArgs, runAdapter, UsageError } from "./run.js";
export type { RunOptions, RunReport, TargetRun } from "./run.js";

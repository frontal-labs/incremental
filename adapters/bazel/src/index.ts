// @backplane/bazel: the Bazel test-target adapter (spec/adapters/bazel.md).
export { discoverTests, labelPath, remoteFlags, runTest, taskInputs } from "./bazel.js";
export type { TaskInputs, TestRun } from "./bazel.js";
export { contextFor, parseArgs, runAdapter, UsageError } from "./run.js";
export type { RunOptions, RunReport, TargetRun } from "./run.js";

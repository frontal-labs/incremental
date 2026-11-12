#!/usr/bin/env node
// `incremental` CLI entry point: resolves the engine binary and execs it.
//
// Usage:
//   incremental <command> [options]
//
//   # Same as:
//   $INCREMENTAL_ENGINE init --store .incremental
//   $INCREMENTAL_ENGINE affected --changes changes.json --baseline abc --context ctx.json

import { spawnSync } from "node:child_process";
import { enginePath } from "../index.js";

const args = process.argv.slice(2);

const result = spawnSync(enginePath(), args, {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);

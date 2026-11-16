#!/usr/bin/env node
// `incremental` CLI entry point: resolves the engine binary and execs it.
//
// Usage:
//   incremental <command> [options]
//
//   # Same as:
//   $INCREMENTAL_ENGINE init --store .incremental
//   $INCREMENTAL_ENGINE affected --changes changes.json --baseline abc --context ctx.json
//
// If the engine binary cannot be resolved, this wrapper fails fast with the
// self-diagnosing error from enginePath() (which prebuilds are bundled and how
// to provide the missing one) instead of surfacing a flag-parsing error from
// the native binary.

import { spawnSync } from "node:child_process";

let engine;
try {
  const { enginePath } = await import("../index.js");
  engine = enginePath();
} catch (err) {
  console.error(`incremental: ${err.message}`);
  process.exit(1);
}

const args = process.argv.slice(2);

const result = spawnSync(engine, args, {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);

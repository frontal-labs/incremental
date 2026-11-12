#!/usr/bin/env node
// `incremental-client` helper: resolves and prints the engine binary path.
//
//   incremental-client engine-path
//   incremental-client version

import { enginePath } from "@incremental/engine";

const cmd = process.argv[2];

if (cmd === "engine-path") {
  console.log(enginePath());
} else if (cmd === "version") {
  console.log("0.1.0");
} else {
  console.error("usage: incremental-client <engine-path|version>");
  process.exit(2);
}

import path from "node:path";
import { fileURLToPath } from "node:url";

// All modules compile to .../benchmarks/replay/dist/src, so import.meta.url
// resolves consistently from any of them.
export const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../benchmarks/replay/dist/src
export const ROOT = path.resolve(HERE, "../../../.."); // graph root
export const ENGINE = path.join(ROOT, "core", "dist", "incremental");
export const VITEST_RUN = path.join(ROOT, "adapters", "vitest", "dist", "src", "run.js");
export const VITEST_BIN = path.join(
  ROOT,
  "adapters",
  "vitest",
  "node_modules",
  "vitest",
  "vitest.mjs",
);
export const FIXTURE = path.join(ROOT, "adapters", "vitest", "fixtures", "repo");

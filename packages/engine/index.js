// @incremental/engine: resolves the path to the native Incremental engine binary.
//
// Resolution order:
//  1. INCREMENTAL_ENGINE environment variable (override)
//  2. Prebuilt binary bundled in this package (prebuilds/<platform>-<arch>/incremental)
//  3. Fallback: core/dist/incremental relative to the incremental repo root (dev mode)
//
// Exports:
//
//   enginePath() -> string   absolute path to the executable
//   engineDir()  -> string   directory containing the executable

import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform, arch } from "node:process";

const PACKAGE_DIR = import.meta.dirname;

function prebuiltPath() {
  return join(PACKAGE_DIR, "prebuilds", `${platform}-${arch}`, "incremental");
}

function devPath() {
  // In the incremental monorepo, the binary is built at core/dist/incremental
  // by `make build`. This path is relative to this package's location.
  return join(PACKAGE_DIR, "..", "core", "dist", "incremental");
}

export function enginePath() {
  // 1. Environment override
  const env = process.env.INCREMENTAL_ENGINE;
  if (env && existsSync(env)) return env;

  // 2. Bundled prebuilt binary
  const prebuilt = prebuiltPath();
  if (existsSync(prebuilt)) return prebuilt;

  // 3. Dev-mode fallback (incremental monorepo)
  const dev = devPath();
  if (existsSync(dev)) return dev;

  throw new Error(
    "Could not locate the Incremental engine binary. " +
      "Set INCREMENTAL_ENGINE to the path of the `incremental` executable, " +
      "or install @incremental/engine which bundles prebuilt binaries.",
  );
}

export function engineDir() {
  return join(enginePath(), "..");
}

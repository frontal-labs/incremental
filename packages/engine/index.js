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

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const PACKAGE_DIR = import.meta.dirname;

function prebuiltPath() {
  return join(PACKAGE_DIR, "prebuilds", `${process.platform}-${process.arch}`, "incremental");
}

function devPath() {
  // In the incremental monorepo, the binary is built at core/dist/incremental
  // by `make build`. This path is relative to this package's location.
  return join(PACKAGE_DIR, "..", "core", "dist", "incremental");
}

// Lists the platform-arch directories bundled under prebuilds/ (e.g.
// "darwin-arm64"). Empty when the package was published without prebuilds.
function bundledPrebuilds() {
  const dir = join(PACKAGE_DIR, "prebuilds");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function missingBinaryMessage() {
  const triple = `${process.platform}-${process.arch}`;
  const available = bundledPrebuilds();
  const lines = [`No Incremental engine binary for ${triple}.`];
  if (available.length > 0) {
    lines.push(`Prebuilds available: ${available.join(", ")}`);
  } else {
    lines.push("This package was published without bundled prebuilds.");
  }
  lines.push(
    "Build from source (make build) and set INCREMENTAL_ENGINE, or wait for a " +
      `${triple} prebuild.`,
  );
  return lines.join("\n");
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

  throw new Error(missingBinaryMessage());
}

export function engineDir() {
  return join(enginePath(), "..");
}

export { bundledPrebuilds, missingBinaryMessage };

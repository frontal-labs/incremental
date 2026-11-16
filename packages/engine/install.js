#!/usr/bin/env node
// `postinstall` script for @incremental/engine.
//
// Verifies that a prebuilt binary exists for the current platform/arch.
// If missing, attempts to download it from GitHub Releases
// (incremental-<platform>-<arch> from the release tagged v<version>).
//
// The download is best-effort: if it fails, the install still succeeds and
// enginePath() will raise a clear, self-diagnosing error at runtime (see
// index.js) telling the user exactly which prebuilds are bundled and how to
// provide the missing one (build with `make build` and set INCREMENTAL_ENGINE,
// or wait for a prebuild for their platform).

import { existsSync, mkdirSync, chmodSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const PACKAGE_DIR = import.meta.dirname;
const BINARY_NAME = "incremental";

const targetTriple = `${process.platform}-${process.arch}`;
const prebuiltDir = join(PACKAGE_DIR, "prebuilds", targetTriple);
const binaryPath = join(prebuiltDir, BINARY_NAME);

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

function downloadFromReleases() {
  const version = readVersion();
  if (!version) {
    console.warn("@incremental/engine: could not determine package version; skipping download.");
    return;
  }
  const url =
    `https://github.com/frontal-labs/incremental/releases/download/v${version}/` +
    `incremental-${targetTriple}`;

  try {
    mkdirSync(prebuiltDir, { recursive: true });
    execFileSync("curl", ["-fsSL", "-o", binaryPath, url], { stdio: "inherit" });
    chmodSync(binaryPath, 0o755);
    console.log(`@incremental/engine: downloaded binary for ${targetTriple}`);
  } catch {
    console.warn(
      `@incremental/engine: no prebuilt binary for ${targetTriple} and the download from ` +
        `${url} failed. ` +
        "Build the engine locally (`make build`) and set INCREMENTAL_ENGINE, or wait for a " +
        `${targetTriple} prebuild.`,
    );
  }
}

function main() {
  if (existsSync(binaryPath)) {
    console.log(`@incremental/engine: prebuilt binary found for ${targetTriple}`);
    return;
  }
  console.log(`@incremental/engine: no prebuilt binary for ${targetTriple}, attempting download...`);
  downloadFromReleases();
}

main();

#!/usr/bin/env node
// `postinstall` script for @incremental/engine.
//
// Verifies that a prebuilt binary exists for the current platform/arch.
// If missing, attempts to download from GitHub Releases (requires network).
//
//   NODE_AUTH_TOKEN=<ghcr_or_npm_token>  (optional, for private releases)

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { platform, arch } from "node:process";
import { execFileSync } from "node:child_process";

const PACKAGE_DIR = import.meta.dirname;
const BINARY_NAME = "incremental";

function targetTriple() {
  return `${platform}-${arch}`;
}

function prebuiltDir() {
  return join(PACKAGE_DIR, "prebuilds", targetTriple());
}

function binaryPath() {
  return join(prebuiltDir(), BINARY_NAME);
}

function downloadFromReleases() {
  const triple = targetTriple();
  const version = "0.1.0";
  const url = `https://github.com/frontal-labs/incremental/releases/download/v${version}/incremental-${triple}`;

  try {
    mkdirSync(prebuiltDir(), { recursive: true });
    execFileSync("curl", ["-fsSL", "-o", binaryPath(), url], { stdio: "inherit" });
    execFileSync("chmod", ["+x", binaryPath()], { stdio: "inherit" });
    console.log(`@incremental/engine: downloaded binary for ${triple}`);
  } catch (_err) {
    console.warn(
      `@incremental/engine: could not download prebuilt binary for ${triple} from GitHub Releases. ` +
        "You may need to build the engine locally with `make build` or set INCREMENTAL_ENGINE manually.",
    );
  }
}

function main() {
  const bin = binaryPath();
  if (existsSync(bin)) {
    console.log(`@incremental/engine: prebuilt binary found for ${targetTriple()}`);
    return;
  }

  console.log(
    `@incremental/engine: no prebuilt binary for ${targetTriple()}, attempting download...`,
  );
  downloadFromReleases();
}

main();

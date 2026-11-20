#!/usr/bin/env node
// Builds the native Incremental engine binary and stages it under
// prebuilds/<platform>-<arch>/incremental for inclusion in the npm package.
//
// Usage:
//   node scripts/build-prebuilds.mjs                 # build for the host platform
//   node scripts/build-prebuilds.mjs --target darwin-x64
//
// Targets must be one of: darwin-arm64, darwin-x64, linux-x64, linux-arm64.
// The Goose toolchain for the target is downloaded to .toolchain/goose/ when
// missing (npm triples are mapped to Goose release asset names; the Makefile
// convention is goose-v<version>-<npm-triple>/goose). Building for an OS
// different from the host is best done in CI (see .github/workflows/publish-npm.yml).
//
// The built binary lands in core/dist/incremental and is copied to
// prebuilds/<target>/incremental with +x.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..");
const ROOT = resolve(PACKAGE_DIR, "..", "..");
const ENGINE = join(ROOT, "core", "dist", "incremental");
const GOOSE_VERSION = "v2026.3";
const SUPPORTED_TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
// Goose ships no linux-arm64 toolchain. linux-arm64 is built by the x86_64 Linux
// Goose with an aarch64 cross C compiler (--cc), so it needs gcc-aarch64-linux-gnu.
const CROSS_TARGETS = { "linux-arm64": { host: "linux-x64", cc: "/usr/bin/aarch64-linux-gnu-gcc" } };
// Goose release assets are named with `macos` instead of npm's `darwin`.
const GOOSE_ASSET_NAME = { "darwin-arm64": "macos-arm64", "darwin-x64": "macos-x64" };

function die(msg) {
  console.error(`build-prebuilds: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  let target = `${process.platform}-${process.arch}`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") target = argv[++i] || die("--target requires a value");
    else if (a.startsWith("--target=")) target = a.slice("--target=".length);
    else die(`unknown argument: ${a}`);
  }
  if (!SUPPORTED_TARGETS.includes(target))
    die(`unsupported target: ${target} (supported: ${SUPPORTED_TARGETS.join(", ")})`);
  return target;
}

function gooseBinaryFor(target) {
  return join(ROOT, ".toolchain", "goose", `goose-${GOOSE_VERSION}-${target}`, "goose");
}

function ensureGoose(target) {
  const bin = gooseBinaryFor(target);
  if (existsSync(bin)) return bin;
  const asset = GOOSE_ASSET_NAME[target] ?? target;
  const url = `https://github.com/aardappel/goose/releases/download/${GOOSE_VERSION}/goose-${GOOSE_VERSION}-${asset}.tar.gz`;
  console.log(`build-prebuilds: fetching Goose toolchain for ${target} from ${url}`);
  const toolchainParent = join(ROOT, ".toolchain", "goose");
  mkdirSync(toolchainParent, { recursive: true });
  const tarball = join(toolchainParent, "goose.tar.gz");
  execFileSync("curl", ["-fsSL", "--retry", "3", "-o", tarball, url], { stdio: "inherit" });
  execFileSync("tar", ["-xzf", tarball, "-C", toolchainParent], { stdio: "inherit" });
  rmSync(tarball, { force: true });
  // The toolchain extracts under its asset name (e.g. goose-v2026.3-macos-x64);
  // rename to the npm-triple name so gooseBinaryFor() can find it.
  const extracted = join(toolchainParent, `goose-${GOOSE_VERSION}-${asset}`);
  const expected = join(toolchainParent, `goose-${GOOSE_VERSION}-${target}`);
  if (existsSync(extracted) && extracted !== expected) {
    if (existsSync(expected)) rmSync(expected, { recursive: true, force: true });
    try {
      renameSync(extracted, expected);
    } catch {
      copyFileSync(extracted, expected, { recursive: true });
      if (statSync(extracted).isDirectory()) rmSync(extracted, { recursive: true, force: true });
    }
  }
  if (!existsSync(bin)) die(`Goose toolchain for ${target} not found at ${bin} after extraction`);
  return bin;
}

function main() {
  const target = parseArgs(process.argv.slice(2));
  const cross = CROSS_TARGETS[target];
  const goose = ensureGoose(cross ? cross.host : target);
  mkdirSync(join(ROOT, "core", "dist"), { recursive: true });
  console.log(`build-prebuilds: building engine for ${target}`);
  const buildArgs = ["build", join(ROOT, "core", "src", "main.goose"), "-o", ENGINE];
  if (cross) buildArgs.push("--cc", process.env.CROSS_CC || cross.cc);
  execFileSync(goose, buildArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      GOOSE_HOME: process.env.GOOSE_HOME || join(ROOT, ".toolchain", "goose-home"),
      // Lowest macOS the binary runs on; without it the binary needs the SDK's OS (26).
      ...(target.startsWith("darwin-")
        ? { MACOSX_DEPLOYMENT_TARGET: process.env.MACOSX_DEPLOYMENT_TARGET || "11.0" }
        : {}),
    },
  });

  const destDir = join(PACKAGE_DIR, "prebuilds", target);
  rmSync(join(SCRIPT_DIR, "prebuilds"), { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, "incremental");
  copyFileSync(ENGINE, dest);
  chmodSync(dest, 0o755);
  console.log(`build-prebuilds: staged ${dest}`);
}

main();

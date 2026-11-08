#!/usr/bin/env node
// Publish the Node client and the TypeScript adapters to GitHub Packages
// (https://npm.pkg.github.com), scope @frontal-labs.
//
//   NODE_AUTH_TOKEN=<token with write:packages> node scripts/publish-github-packages.mjs [--dry-run]
//
// Packages: bindings/node and every adapters/*/ with a package.json. apps/mcp and
// benchmarks/replay are not published. Each package is published in dependency
// order (the client first). For each one, this script:
//   - removes "private", sets publishConfig, repository and the "files" list;
//   - replaces "file:" dependencies on workspace packages with their version;
//   - runs `npm publish`, then restores the original package.json (also on failure).
// The package must be built first (`make build` and the adapter builds).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://npm.pkg.github.com";
const REPOSITORY = "https://github.com/frontal-labs/incremental.git";
const SCOPE_PREFIX = "@frontal-labs/incremental-";
const dryRun = process.argv.includes("--dry-run");

function die(msg) {
  console.error(`publish: ${msg}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// The package directories to publish, relative to the repo root.
// Adapters for tools outside the Node ecosystem are not published: they stay in the repo and in
// the tests, but are not npm packages in the sense this registry serves.
const NOT_PUBLISHED = new Set(["bazel", "clippy", "protobuf", "ruff"]);

function candidateDirs() {
  const dirs = ["bindings/node"];
  const adapters = path.join(ROOT, "adapters");
  for (const name of readdirSync(adapters).sort()) {
    if (NOT_PUBLISHED.has(name)) continue;
    if (existsSync(path.join(adapters, name, "package.json"))) dirs.push(`adapters/${name}`);
  }
  return dirs;
}

// { dir, name, version, pkg, workspaceDeps } for each publishable package.
function loadPackages() {
  const found = candidateDirs().map((dir) => {
    const pkg = readJson(path.join(ROOT, dir, "package.json"));
    if (!pkg.name.startsWith(SCOPE_PREFIX))
      die(`${dir}: name ${pkg.name} is not under ${SCOPE_PREFIX}`);
    return { dir, name: pkg.name, version: pkg.version, pkg };
  });
  const byName = new Map(found.map((p) => [p.name, p]));
  for (const p of found) {
    p.workspaceDeps = Object.entries(p.pkg.dependencies ?? {})
      .filter(([, spec]) => spec.startsWith("file:"))
      .map(([name]) => name);
    for (const dep of p.workspaceDeps) {
      if (!byName.has(dep)) die(`${p.dir}: file dependency ${dep} is not a publishable package`);
    }
  }
  return orderByDependencies(found, byName);
}

// Dependencies first. A cycle among the workspace packages is an error.
function orderByDependencies(found, byName) {
  const ordered = [];
  const state = new Map();
  const visit = (p) => {
    if (state.get(p.name) === "done") return;
    if (state.get(p.name) === "active") die(`dependency cycle through ${p.name}`);
    state.set(p.name, "active");
    for (const dep of p.workspaceDeps) visit(byName.get(dep));
    state.set(p.name, "done");
    ordered.push(p);
  };
  for (const p of found) visit(p);
  return ordered;
}

// The manifest as it is published: GitHub Packages settings, and file: dependencies
// replaced by the version of the sibling package (all packages share one version).
function publishManifest(p, byName) {
  const manifest = structuredClone(p.pkg);
  delete manifest.private;
  manifest.publishConfig = { registry: REGISTRY };
  manifest.repository = { type: "git", url: `git+${REPOSITORY}`, directory: p.dir };
  if (!manifest.files) manifest.files = ["dist/src"];
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = manifest[field];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (spec.startsWith("file:")) {
        const target = byName.get(name);
        deps[name] = `^${target.version}`;
      }
    }
  }
  return manifest;
}

// The package.json currently rewritten, with its original text. npm publish runs synchronously, so
// a signal only sets 'aborted': the package in progress is restored, then the loop stops.
let pending = null;
let aborted = false;

function onSignal() {
  if (pending === null) process.exit(130);
  aborted = true;
}
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

function publish(p, manifest, userConfig) {
  const file = path.join(ROOT, p.dir, "package.json");
  const original = readFileSync(file, "utf8");
  if (!existsSync(path.join(ROOT, p.dir, "dist")))
    die(`${p.dir}: no dist/ directory, build it first`);
  pending = { file, original };
  let failure = null;
  try {
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    const args = ["publish", "--registry", REGISTRY, "--userconfig", userConfig];
    if (dryRun) args.push("--dry-run");
    const out = execFileSync("npm", args, {
      cwd: path.join(ROOT, p.dir),
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`${dryRun ? "dry run" : "published"} ${p.name}@${p.version}`);
    if (out.trim()) console.log(out.trim());
  } catch (err) {
    failure = err.stderr ? String(err.stderr).trim() : err.message;
  } finally {
    // Restore before any exit, so a failed or interrupted publish leaves no rewritten manifest.
    writeFileSync(file, original);
    pending = null;
  }
  if (failure !== null) die(`npm publish failed for ${p.name}: ${failure}`);
}

function main() {
  if (!process.env.NODE_AUTH_TOKEN) die("NODE_AUTH_TOKEN is not set (a token with write:packages)");
  const packages = loadPackages();
  const byName = new Map(packages.map((p) => [p.name, p]));
  // The registry settings live in the root .npmrc, which reads the token from the environment.
  const userConfig = path.join(ROOT, ".npmrc");
  for (const p of packages) {
    if (aborted) die("interrupted; packages published so far are listed above");
    publish(p, publishManifest(p, byName), userConfig);
  }
}

main();

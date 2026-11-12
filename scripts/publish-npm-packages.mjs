#!/usr/bin/env node
// Publish all Incremental packages to npm (https://registry.npmjs.org), scope @incremental.
//
//   NODE_AUTH_TOKEN=<token with publish access> node scripts/publish-npm-packages.mjs [--dry-run]
//
// Publish order (dependencies first):
//   1. @incremental/engine     (native binary prebuilds)
//   2. @incremental/client     (protocol client, depends on engine)
//   3. @incremental/* adapters (vitest, bazel, nx, turbo, etc.)
//   4. @incremental/sdk        (metapackage: client + engine + vitest)
//
// For each package this script:
//   - removes "private", sets publishConfig (access: public)
//   - replaces "file:" dependencies on workspace packages with their version
//   - runs `npm publish`, then restores the original package.json (also on failure)
//
// The package must be built first (`make build` and each adapter's `npm run build`).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org";
const REPOSITORY = "https://github.com/frontal-labs/incremental.git";
const SCOPE_PREFIX = "@incremental/";
const dryRun = process.argv.includes("--dry-run");

function die(msg) {
  console.error(`publish: ${msg}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Package directories to publish, in dependency order.
// The engine must go first (client depends on it), then client, then adapters, then sdk.
const PUBLISH_ORDER = ["packages/engine", "bindings/node", "packages/sdk"];

function candidateDirs() {
  const dirs = [...PUBLISH_ORDER];
  const adapters = path.join(ROOT, "adapters");
  for (const name of readdirSync(adapters).sort()) {
    if (existsSync(path.join(adapters, name, "package.json"))) {
      dirs.push(`adapters/${name}`);
    }
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

// The manifest as it is published.
function publishManifest(p, byName) {
  const manifest = structuredClone(p.pkg);
  delete manifest.private;
  manifest.publishConfig = { registry: REGISTRY, access: "public" };
  manifest.repository = { type: "git", url: `git+${REPOSITORY}`, directory: p.dir };

  // Ensure files list includes dist and bin
  const files = new Set(manifest.files ?? []);
  if (p.dir.includes("engine")) {
    files.add("bin/");
    files.add("prebuilds/");
    files.add("index.js");
    files.add("index.d.ts");
    files.add("install.js");
  } else if (p.dir.includes("sdk")) {
    files.add("index.js");
    files.add("index.d.ts");
  } else {
    files.add("dist/src");
    if (existsSync(path.join(ROOT, p.dir, "bin"))) files.add("bin/");
  }
  manifest.files = [...files];

  // Replace file: workspace deps with versioned ranges
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

  // Engine package uses prebuilds instead of dist/src
  const needsDist = !p.dir.includes("engine") && !p.dir.includes("sdk");
  if (needsDist && !existsSync(path.join(ROOT, p.dir, "dist")))
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
    writeFileSync(file, original);
    pending = null;
  }
  if (failure !== null) die(`npm publish failed for ${p.name}: ${failure}`);
}

function main() {
  if (!process.env.NODE_AUTH_TOKEN)
    die("NODE_AUTH_TOKEN is not set (a token with publish access to @incremental)");
  const packages = loadPackages();
  const byName = new Map(packages.map((p) => [p.name, p]));
  const userConfig = path.join(ROOT, ".npmrc");
  for (const p of packages) {
    if (aborted) die("interrupted; packages published so far are listed above");
    publish(p, publishManifest(p, byName), userConfig);
  }
}

main();

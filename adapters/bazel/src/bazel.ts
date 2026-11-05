// One Bazel test target as a task (spec/adapters/bazel.md). The task id is the
// target label (PLAN D-2). Its file inputs are the main-repository source, BUILD
// and .bzl files in its dependency closure, and the main-repository inputs of its
// actions (aquery), all hashed at observation time. Bazel's embedded tools are
// pinned by the runner version in the context. External repositories are pinned
// by MODULE.bazel.lock (context key `lockfile`). Anything the adapter cannot
// observe or pin marks the observation dirty.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BazelError } from "./error.js";

// Files Bazel reads as configuration. Declared global inputs (spec section "Declared inputs").
export const DECLARED_FILES = ["MODULE.bazel", "MODULE.bazel.lock", ".bazelrc", ".bazelversion"];

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hashOrAbsent(file: string): string {
  return existsSync(file) ? sha256(readFileSync(file)) : "absent";
}

export function bazelBin(): string {
  return process.env.INCREMENTAL_BAZEL || "bazel";
}

function bazel(root: string, args: string[], timeoutMs: number): SpawnSyncReturns<string> {
  return spawnSync(bazelBin(), args, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 512 * 1024 * 1024,
  });
}

function failure(r: SpawnSyncReturns<string>, what: string): BazelError {
  const detail = `${r.stderr}`.trim().split("\n").slice(-3).join(" | ");
  return new BazelError(`${what} failed (exit ${r.status ?? r.signal}): ${detail}`);
}

// The Bazel version, e.g. "9.3.1". It pins Bazel's embedded tools (bazel_tools).
export function bazelVersion(root: string): string {
  const r = bazel(root, ["--version"], 60_000);
  const m = /^bazel (\S+)/m.exec(r.stdout ?? "");
  if (r.status !== 0 || m === null) throw failure(r, "bazel --version");
  return m[1] as string;
}

function queryLabels(root: string, expr: string, timeoutMs: number): string[] {
  const r = bazel(root, ["query", expr, "--output=label"], timeoutMs);
  if (r.status !== 0) throw failure(r, `bazel query ${expr}`);
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Test targets of the main repository, sorted. Labels are the task ids.
export function discoverTests(root: string, timeoutMs: number): string[] {
  return queryLabels(root, "tests(//...)", timeoutMs)
    .filter((l) => l.startsWith("//"))
    .sort();
}

// A main-repository label (//pkg:name) as a repo-relative path, or null.
export function labelPath(label: string): string | null {
  const m = /^\/\/([^:]*):(.+)$/.exec(label);
  if (m === null) return null;
  return m[1] === "" ? (m[2] as string) : `${m[1]}/${m[2]}`;
}

// Embedded Bazel tools (bazel_tools), pinned by the runner version.
export function isEmbedded(p: string): boolean {
  return /^@@?bazel_tools(\+|\/\/)/.test(p) || p.startsWith("external/bazel_tools/");
}

// Flags that make a run remote. Parsed from `bazel canonicalize-flags`, which
// expands .bazelrc, so a remote setting in any rc file is seen.
export function remoteFlags(canonical: string): string[] {
  return canonical
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^--remote_(executor|cache)=.+$/.test(l));
}

export function remoteEnabled(root: string, args: string[], timeoutMs: number): string[] {
  const r = bazel(root, ["canonicalize-flags", "--for_command=test", "--", ...args], timeoutMs);
  if (r.status !== 0) throw failure(r, "bazel canonicalize-flags");
  return remoteFlags(r.stdout);
}

export interface TaskInputs {
  // Main-repository files: repo-relative paths, each hashed by the caller.
  files: string[];
  // Non-embedded external repositories read by the task (pinned by the lockfile).
  external: string[];
  // Inputs that cannot be named repo-relative (e.g. a directory, an unparsable label).
  unobservable: string[];
}

// The inputs of one target. The closure gives sources, BUILD and .bzl files
// (declared by the dependency graph and read while loading). The action inputs
// (aquery) give what the test's actions read at run time. Generated outputs
// are not inputs of their own: their producers are in the closure.
export function taskInputs(root: string, label: string, timeoutMs: number): TaskInputs {
  const files = new Set<string>();
  const external = new Set<string>();
  const unobservable: string[] = [];
  const closure = queryLabels(
    root,
    `kind("source file", deps(${label})) + buildfiles(deps(${label})) + loadfiles(deps(${label}))`,
    timeoutMs,
  );
  for (const l of closure) {
    const p = labelPath(l);
    if (p !== null) files.add(p);
    else if (!isEmbedded(l)) external.add(l);
  }
  const r = bazel(root, ["aquery", `deps(${label})`, "--output=text"], timeoutMs);
  if (r.status !== 0) throw failure(r, "bazel aquery");
  for (const line of r.stdout.split("\n")) {
    if (/^\s*Inputs:/.test(line)) {
      const m = /^\s*Inputs: \[(.*)\]\s*$/.exec(line);
      if (m === null) throw new BazelError(`cannot parse aquery inputs: ${line.trim()}`);
      for (const p of (m[1] as string)
        .split(", ")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)) {
        if (!p.startsWith("bazel-out/") && !isEmbedded(p)) {
          if (p.startsWith("external/")) {
            external.add(p);
          } else {
            const abs = path.join(root, p);
            if (existsSync(abs) && statSync(abs).isFile()) files.add(p);
            else unobservable.push(p);
          }
        }
      }
    }
  }
  return { files: [...files].sort(), external: [...external].sort(), unobservable };
}

export interface TestRun {
  outcome: "pass" | "fail" | "error";
  durationMs: number;
  problem: string | null;
}

// Runs one test target. The result cache is off, so a result is always a run
// this adapter watched, not a result Bazel served from its cache.
export function runTest(root: string, label: string, timeoutMs: number): TestRun {
  const started = Date.now();
  const r = bazel(root, ["test", label, "--nocache_test_results"], timeoutMs);
  const durationMs = Date.now() - started;
  if (r.error !== undefined || r.signal !== null) {
    return { outcome: "error", durationMs, problem: r.error?.message ?? `killed by ${r.signal}` };
  }
  if (r.status === 0) return { outcome: "pass", durationMs, problem: null };
  // 1: a build or test failure of the target; 3: tests failed.
  if (r.status === 1 || r.status === 3)
    return { outcome: "fail", durationMs, problem: `bazel test exited ${r.status}` };
  return { outcome: "error", durationMs, problem: `bazel test exited ${r.status}` };
}

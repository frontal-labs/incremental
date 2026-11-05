// M10 (PLAN §12.4): every path the strace oracle sees must be in the Vitest
// recorder's input set, for every fixture test file. Zero gaps.
//
// Runs on Linux only (strace). On other platforms, and when strace or a built
// Vitest adapter is missing, this test skips. The test is self-contained: it
// runs the recorder the same way `adapters/vitest/src/record.ts` does (one
// Vitest process per file, forks pool, NODE_OPTIONS preload) and compares the
// path sets, without importing the Vitest adapter package.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { runOracle } from "../src/oracle.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER = path.resolve(HERE, "..", "..");
const VITEST = path.resolve(ADAPTER, "..", "vitest");
const FIXTURE = path.join(VITEST, "fixtures", "repo");
const PRELOAD = path.join(VITEST, "dist", "src", "preload.js");

// The Vitest CLI entry of the pinned Vitest (mirrors adapters/vitest/src/planner.ts).
const vitestBin = (() => {
  try {
    const requireVitest = createRequire(path.join(VITEST, "package.json"));
    const pkg = requireVitest.resolve("vitest/package.json");
    return path.join(path.dirname(pkg), "vitest.mjs");
  } catch {
    return "";
  }
})();

const haveStrace = spawnSync("strace", ["--version"], { encoding: "utf8" }).status === 0;
const built = existsSync(PRELOAD) && vitestBin.length > 0 && existsSync(vitestBin);
// Linux with strace and a built Vitest adapter: run the comparison. Otherwise skip.
const m10 = process.platform === "linux" && haveStrace && built ? test : test.skip;

// The fixture's test files, sorted (CR-001: 7 in core, 7 in app). Kept local
// so this test does not import the Vitest adapter's test helpers.
const FIXTURE_TESTS: readonly string[] = [
  "packages/app/test/config.test.ts",
  "packages/app/test/disposable.test.ts",
  "packages/app/test/envall.test.ts",
  "packages/app/test/linked.test.ts",
  "packages/app/test/only-app.test.ts",
  "packages/app/test/plugins.test.ts",
  "packages/app/test/shared.test.ts",
  "packages/core/test/crash.test.ts",
  "packages/core/test/env.test.ts",
  "packages/core/test/leaf-a.test.ts",
  "packages/core/test/leaf-b.test.ts",
  "packages/core/test/probe.test.ts",
  "packages/core/test/util.test.ts",
  "packages/core/test/worker.test.ts",
];

interface TraceEvent {
  k: string;
  p?: string;
  pid: number;
}

function readEvents(file: string): TraceEvent[] {
  if (!existsSync(file)) return [];
  const events: TraceEvent[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.length !== 0) {
      try {
        events.push(JSON.parse(line) as TraceEvent);
      } catch {
        // a torn final line is ignored
      }
    }
  }
  return events;
}

// Runs one fixture test file exactly like the Vitest recorder does
// (adapters/vitest/src/record.ts runFile): one Vitest process per file with
// the preload loaded through NODE_OPTIONS, trace written to a temp file.
async function recordTask(
  dir: string,
  task: string,
  work: string,
  index: number,
  env: NodeJS.ProcessEnv,
): Promise<TraceEvent[]> {
  const trace = path.join(work, `trace-${index}.ndjson`);
  const report = path.join(work, `report-${index}.json`);
  rmSync(trace, { force: true });
  rmSync(report, { force: true });
  const preloadUrl = pathToFileURL(PRELOAD).href;
  const nodeOptions = [env.NODE_OPTIONS, `--import ${preloadUrl}`].filter(Boolean).join(" ");
  const args = [
    vitestBin,
    "run",
    task,
    "--root",
    dir,
    "--pool=forks",
    "--reporter=json",
    `--outputFile=${report}`,
  ];
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    NODE_OPTIONS: nodeOptions,
    INCREMENTAL_TRACE_OUT: trace,
    INCREMENTAL_TRACE_ROOT: dir,
  };
  return new Promise<TraceEvent[]>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: dir,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve(readEvents(trace));
    };
    child.on("close", finish);
    child.on("error", finish);
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      finish();
    }, 120_000).unref();
  });
}

// Recorder input paths for one task: file/dir/probe events, with files that no
// longer exist after the run dropped (transient artifacts, like the recorder).
function recorderPaths(events: TraceEvent[], dir: string): Set<string> {
  const paths = new Set<string>();
  for (const ev of events) {
    if (ev.k === "file" || ev.k === "dir" || ev.k === "probe") {
      if (ev.p !== undefined && (ev.k !== "file" || existsSync(path.join(dir, ev.p))))
        paths.add(ev.p);
    }
  }
  return paths;
}

m10(
  "M10: every strace-oracle path is in the recorder's input set, per fixture test file",
  async () => {
    const env = { ...process.env, NODE_ENV: "test" };
    const gaps: Array<{ task: string; missing: string[] }> = [];

    for (const task of FIXTURE_TESTS) {
      const dir = mkdtempSync(path.join(os.tmpdir(), "bp-m10-repo-"));
      try {
        cpSync(FIXTURE, dir, { recursive: true, verbatimSymlinks: true });
        const work = mkdtempSync(path.join(os.tmpdir(), "bp-m10-work-"));
        try {
          // The recorder's observation for this task.
          const recEvents = await recordTask(dir, task, work, 1, env);

          // The same command, traced with strace (PLAN §11.5).
          const { events } = await runOracle(
            [
              process.execPath,
              vitestBin,
              "run",
              task,
              "--root",
              dir,
              "--pool=forks",
              "--reporter=json",
            ],
            { roots: [dir], cwd: dir, env, timeoutMs: 180_000 },
          );

          // The first traced process is the Vitest main process itself. Its
          // directory listings (test discovery) are deliberately not task
          // inputs (PLAN 11.2), so dirs from that pid are excluded. Files and
          // probes from it are inputs, as are all events from forked workers.
          // `exec` events are process observations (for @incremental/process),
          // not file reads: the Node recorder deliberately does not intercept
          // execve, so they are not part of the recorder-completeness comparison.
          const first = events[0];
          const rootPid = first === undefined ? -1 : first.pid;
          const oraclePaths = new Set<string>();
          for (const e of events) {
            if (e.kind !== "exec" && !(e.kind === "dir" && e.pid === rootPid)) {
              oraclePaths.add(e.path);
            }
          }

          const recPaths = recorderPaths(recEvents, dir);
          const missing = [...oraclePaths].filter((p) => !recPaths.has(p));
          if (missing.length > 0) gaps.push({ task, missing });
        } finally {
          rmSync(work, { recursive: true, force: true });
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    assert.equal(
      gaps.length,
      0,
      `M10 gaps (oracle paths missing from the recorder's inputs): ${JSON.stringify(gaps, null, 2)}`,
    );
  },
);

test("the fixture under test is present", () => {
  for (const task of FIXTURE_TESTS) {
    assert.equal(existsSync(path.join(FIXTURE, task)), true, `fixture missing: ${task}`);
  }
});

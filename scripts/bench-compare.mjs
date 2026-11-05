#!/usr/bin/env node
// Benchmark comparison: Incremental vs Turborepo vs Nx vs Bazel
//
// Measures affected-project detection time for each tool on matching monorepo fixtures.
//
//   node scripts/bench-compare.mjs [iterations]
//
// Runs each tool against its dedicated monorepo fixture:
//   - Nx     → monorepos/nx/
//   - Turbo  → monorepos/turborepo/
//   - Bazel  → monorepos/bazel/
//   - Incremental → benchmarks/warm-plan.mjs (engine-native, synthetic)
//
// Each tool is run <iterations> times and the median is reported.
// Failures are recorded but don't abort the comparison.
//
// Output JSON to benchmarks/results/comparison.json.

import { spawnSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GRAPH_ROOT = process.env.GRAPH_ROOT || "/Users/gabrielfonseca/Desktop/graph";

const MONOREPOS = {
  nx: join(GRAPH_ROOT, "monorepos", "nx"),
  turbo: join(GRAPH_ROOT, "monorepos", "turborepo"),
  bazel: join(GRAPH_ROOT, "monorepos", "bazel"),
};

function die(msg) {
  console.error(`benchmark-compare: ${msg}`);
  process.exit(1);
}

function timeCommand(cmd, args, opts = {}) {
  const start = process.hrtime.bigint();
  const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  return { ms, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function median(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Incremental: run warm-plan benchmark (measures query latency)
function benchIncremental(iterations) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const result = spawnSync(
      "node",
      [join(GRAPH_ROOT, "benchmarks", "warm-plan.mjs"), "10000", "100", "1"],
      {
        cwd: GRAPH_ROOT,
        encoding: "utf8",
      },
    );
    if (result.status !== 0) {
      console.warn(`incremental iteration ${i + 1} failed: ${result.stderr}`);
    } else {
      try {
        const data = JSON.parse(result.stdout);
        samples.push(data.per_query_ms.median);
      } catch {
        console.warn(`incremental iteration ${i + 1}: invalid JSON output`);
      }
    }
  }
  if (!samples.length) die(`incremental benchmark failed all ${iterations} iterations`);
  return {
    process_load_ms: null, // not measured per iteration
    per_query_ms: median(samples),
    samples,
  };
}

// Nx: measure affected project detection time
function benchNx(monorepoPath, iterations) {
  const samples = [];
  let projects = [];
  let lastError = null;
  for (let i = 0; i < iterations; i++) {
    const attempts = [
      () =>
        timeCommand(
          "node",
          [
            join(monorepoPath, "node_modules", ".bin", "nx"),
            "show",
            "projects",
            "--affected",
            "--base=HEAD~1",
          ],
          { cwd: monorepoPath },
        ),
      () =>
        timeCommand("nx", ["show", "projects", "--affected", "--base=HEAD~1"], {
          cwd: monorepoPath,
        }),
      () =>
        timeCommand("npx", ["nx", "show", "projects", "--affected", "--base=HEAD~1"], {
          cwd: monorepoPath,
        }),
    ];
    let result = null;
    for (let k = 0; k < attempts.length && (result === null || result.status !== 0); k++) {
      result = attempts[k]();
    }
    if (result.status !== 0) {
      lastError = result.stderr;
    } else {
      const stdout = result.stdout.trim();
      const jsonMatch = stdout.match(/\[([^\]]+)\]/);
      if (jsonMatch) {
        try {
          projects = JSON.parse(jsonMatch[0]);
        } catch {
          projects = [];
        }
      }
      samples.push(result.ms);
    }
  }
  return {
    affected_detect_ms: median(samples),
    projects,
    samples,
    error: lastError,
  };
}

// Turbo: measure affected task detection time
function benchTurbo(monorepoPath, iterations) {
  const samples = [];
  let tasksFound = 0;
  let lastError = null;
  for (let i = 0; i < iterations; i++) {
    const attempts = [
      () =>
        timeCommand(
          "node",
          [
            join(monorepoPath, "node_modules", ".bin", "turbo"),
            "run",
            "build",
            "--affected=HEAD~1",
          ],
          { cwd: monorepoPath },
        ),
      () => timeCommand("turbo", ["run", "build", "--affected=HEAD~1"], { cwd: monorepoPath }),
      () =>
        timeCommand("npx", ["turbo", "run", "build", "--affected=HEAD~1"], { cwd: monorepoPath }),
    ];
    let result = null;
    for (let k = 0; k < attempts.length && (result === null || result.status !== 0); k++) {
      result = attempts[k]();
    }
    if (result.status !== 0) {
      lastError = result.stderr;
    } else {
      const found = (result.stdout.match(/Tasks?:\s+(\d+)/) || [])[1];
      tasksFound = Number(found) || 0;
      samples.push(result.ms);
    }
  }
  return {
    affected_detect_ms: median(samples),
    tasks_found: tasksFound,
    samples,
    error: lastError,
  };
}

// Bazel: measure affected target detection time
function benchBazel(monorepoPath, iterations) {
  const bazelCmd =
    spawnSync("which", ["bazel"], { encoding: "utf8" }).status === 0
      ? "bazel"
      : spawnSync("which", ["bazelisk"], { encoding: "utf8" }).status === 0
        ? "bazelisk"
        : null;
  if (!bazelCmd) {
    return {
      affected_detect_ms: null,
      targets: [],
      samples: [],
      error: "bazel/bazelisk not found",
    };
  }

  const samples = [];
  let targets = [];
  let lastError = null;
  for (let i = 0; i < iterations; i++) {
    const result = timeCommand(bazelCmd, ["query", "//packages/..."], {
      cwd: monorepoPath,
      env: { ...process.env, BAZEL_NO_TUNE: "1" },
    });
    if (result.status !== 0) {
      lastError = result.stderr.slice(0, 300);
    } else {
      targets = result.stdout
        .trim()
        .split("\n")
        .filter((l) => l.trim());
      samples.push(result.ms);
    }
  }
  return {
    affected_detect_ms: samples.length ? median(samples) : null,
    targets,
    samples,
    error: lastError,
  };
}

async function main() {
  const iterations = Number(process.argv[2] ?? 3);
  console.log(
    `Running benchmark comparison across monorepo types (${iterations} iterations each)...\n`,
  );

  const incremental = benchIncremental(iterations);
  console.log(
    `Incremental: ${incremental.per_query_ms.toFixed(3)}ms/query (median of ${iterations} iterations)`,
  );

  const nx = benchNx(MONOREPOS.nx, iterations);
  console.log(
    `Nx: ${nx.affected_detect_ms?.toFixed(2)}ms detect, ${nx.projects.length} projects${nx.error ? ` (error: ${nx.error})` : ""}`,
  );

  const turbo = benchTurbo(MONOREPOS.turbo, iterations);
  console.log(
    `Turbo: ${turbo.affected_detect_ms?.toFixed(2)}ms detect, ${turbo.tasks_found} tasks${turbo.error ? ` (error: ${turbo.error})` : ""}`,
  );

  const bazel = benchBazel(MONOREPOS.bazel, iterations);
  console.log(
    `Bazel: ${bazel.affected_detect_ms?.toFixed(2)}ms detect, ${bazel.targets.length} targets${bazel.error ? ` (error: ${bazel.error})` : ""}`,
  );

  const comparison = {
    timestamp: new Date().toISOString(),
    iterations,
    incremental,
    nx: { ...nx, monorepo: MONOREPOS.nx },
    turbo: { ...turbo, monorepo: MONOREPOS.turbo },
    bazel: { ...bazel, monorepo: MONOREPOS.bazel },
  };

  const outPath = join(GRAPH_ROOT, "benchmarks", "results", "comparison.json");
  writeFileSync(outPath, JSON.stringify(comparison, null, 2) + "\n");
  console.log(`\nResults written to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

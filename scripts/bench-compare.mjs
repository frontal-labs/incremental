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
import { writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GRAPH_ROOT = process.env.GRAPH_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
// The change under test is the last commit that touches packages/shared/src/index.ts, and the
// base is its parent. The fixture repos can have later commits (READMEs, docs) on top of it,
// so HEAD~1 is not the change under test; the shared commit is.
function changeBase(monorepoPath) {
  const r = spawnSync("git", ["log", "-1", "--format=%H", "--", "packages/shared/src/index.ts"], {
    cwd: monorepoPath,
    encoding: "utf8",
  });
  const sha = r.stdout.trim();
  if (r.status !== 0 || sha === "") {
    return { error: r.stderr.trim() || "no commit touches packages/shared/src/index.ts" };
  }
  return { base: `${sha}^` };
}

function benchNx(monorepoPath, iterations) {
  const { base, error } = changeBase(monorepoPath);
  if (error) return { affected_detect_ms: null, projects: [], samples: [], error };
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
            `--base=${base}`,
          ],
          { cwd: monorepoPath },
        ),
      () =>
        timeCommand("nx", ["show", "projects", "--affected", `--base=${base}`], {
          cwd: monorepoPath,
        }),
      () =>
        timeCommand("npx", ["nx", "show", "projects", "--affected", `--base=${base}`], {
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
      // nx prints either a JSON array or one project name per line, depending on the
      // terminal. Accept both; any other line (nx's own notices) is ignored.
      const stdout = result.stdout.trim();
      const jsonMatch = stdout.match(/\[[^\]]*\]/);
      if (jsonMatch) {
        try {
          projects = JSON.parse(jsonMatch[0]);
        } catch {
          projects = [];
        }
      } else {
        projects = stdout
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^[@\w./-]+$/.test(l));
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

// Turbo: measure affected task detection time. Uses the explicit git-range filter,
// because `--affected=<ref>` selects nothing on turbo 2.11 (verified 2026-11-05).
function benchTurbo(monorepoPath, iterations) {
  const { base, error } = changeBase(monorepoPath);
  if (error) return { affected_detect_ms: null, tasks_found: 0, samples: [], error };
  const samples = [];
  let tasksFound = 0;
  let packages = [];
  let lastError = null;
  const args = ["run", "build", `--filter=...[${base}]`, "--dry=json"];
  for (let i = 0; i < iterations; i++) {
    const attempts = [
      () =>
        timeCommand("node", [join(monorepoPath, "node_modules", ".bin", "turbo"), ...args], {
          cwd: monorepoPath,
        }),
      () => timeCommand("turbo", args, { cwd: monorepoPath }),
      () => timeCommand("npx", ["turbo", ...args], { cwd: monorepoPath }),
    ];
    let result = null;
    for (let k = 0; k < attempts.length && (result === null || result.status !== 0); k++) {
      result = attempts[k]();
    }
    if (result.status !== 0) {
      lastError = result.stderr;
      continue;
    }
    try {
      const tasks = JSON.parse(result.stdout).tasks;
      tasksFound = tasks.length;
      packages = tasks.map((t) => t.package).sort();
      samples.push(result.ms);
    } catch {
      lastError = "turbo --dry=json output was not JSON";
    }
  }
  return {
    affected_detect_ms: median(samples),
    tasks_found: tasksFound,
    packages,
    samples,
    error: lastError,
  };
}

// Bazel: affected targets = rdeps of the packages whose files changed in base..HEAD.
// Each package p has the target //packages/p:p_pkg (see monorepos/bazel/packages/*/BUILD.bazel).
// The timed command is the rdeps query, not a listing of all targets.
function changedBazelTargets(monorepoPath, base) {
  const diff = spawnSync("git", ["diff", "--name-only", base, "HEAD", "--", "packages"], {
    cwd: monorepoPath,
    encoding: "utf8",
  });
  if (diff.status !== 0) return { error: diff.stderr.trim() };
  const pkgs = new Set();
  for (const f of diff.stdout.split("\n")) {
    const m = f.match(/^packages\/([^/]+)\//);
    if (m) pkgs.add(m[1]);
  }
  return { labels: [...pkgs].sort().map((p) => `//packages/${p}:${p}_pkg`) };
}

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

  const { base, error: baseError } = changeBase(monorepoPath);
  const changed = baseError ? { error: baseError } : changedBazelTargets(monorepoPath, base);
  if (changed.error) {
    return { affected_detect_ms: null, targets: [], samples: [], error: changed.error };
  }
  // kind(filegroup, ...) keeps the package targets and drops the test targets, which also depend on shared.
  const expr = `kind(filegroup, rdeps(//packages/..., set(${changed.labels.join(" ")})))`;

  const samples = [];
  let targets = [];
  let lastError = null;
  for (let i = 0; i < iterations; i++) {
    const result = timeCommand(bazelCmd, ["query", expr], {
      cwd: monorepoPath,
      env: { ...process.env, BAZEL_NO_TUNE: "1" },
    });
    if (result.status !== 0) {
      lastError = result.stderr.slice(0, 300);
    } else {
      targets = result.stdout
        .trim()
        .split("\n")
        .filter((l) => l.startsWith("//"));
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
    // Relative to the graph root, so the results file does not carry a machine's absolute paths.
    nx: { ...nx, monorepo: relative(GRAPH_ROOT, MONOREPOS.nx) },
    turbo: { ...turbo, monorepo: relative(GRAPH_ROOT, MONOREPOS.turbo) },
    bazel: { ...bazel, monorepo: relative(GRAPH_ROOT, MONOREPOS.bazel) },
  };

  const outPath = join(GRAPH_ROOT, "benchmarks", "results", "comparison.json");
  writeFileSync(outPath, JSON.stringify(comparison, null, 2) + "\n");
  console.log(`\nResults written to ${outPath}`);

  // Each tool must select exactly the packages the change under test affects. A wrong set makes
  // the timing meaningless, so the run fails (non-zero exit) and `make bench` stops.
  const EXPECTED = ["api", "shared", "web"];
  const selected = {
    nx: nx.projects,
    turbo: turbo.packages,
    bazel: bazel.targets.map((t) => t.replace(/^\/\/packages\//, "").replace(/:.*$/, "")),
  };
  let wrong = false;
  for (const [tool, got] of Object.entries(selected)) {
    const sorted = [...got].sort();
    if (JSON.stringify(sorted) !== JSON.stringify(EXPECTED)) {
      wrong = true;
      console.error(
        `FAIL ${tool}: selected [${sorted.join(", ")}], expected [${EXPECTED.join(", ")}]`,
      );
    }
  }
  if (wrong) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

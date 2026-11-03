// Gate 0 replay driver (PLAN 12.5). Materialises each first-parent commit of the
// Os main line into the scratch replay tree W, runs the adapter (plan, run the
// invalid test files under the recorder, advance), runs the plain ground truth,
// and records everything into OUT/<index>.json. Resumable: existing records are
// skipped. Usage: node replay.mjs <scratch> <count|all> [limit-index]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , SCRATCH, COUNT = "all", STOP_AT = "999999"] = process.argv;
const OS = "/Users/gabrielfonseca/Desktop/os";
const GRAPH = "/Users/gabrielfonseca/Desktop/graph";
const W = path.join(SCRATCH, "W");
const STORE = path.join(SCRATCH, "store");
const OUT = path.join(SCRATCH, "out");
const TMP = path.join(SCRATCH, "tmp");
const ADAPTER = path.join(GRAPH, "adapters/vitest/dist/src/run.js");
const GITSRC = path.join(GRAPH, "adapters/git/dist/backplane-git");
const CORE = path.join(GRAPH, "core/dist/backplane");
const VITEST = path.join(W, "node_modules/vitest/vitest.mjs");
const DIST_PIN = path.join(SCRATCH, "dist_pinned");
const SRC_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

// The unit project of vitest.config.ts (packages/vitest-config/src/projects/globs.ts).
const INCLUDE = [
  "apps/*/tests/**/*.{test,spec}.{ts,tsx}",
  "features/*/tests/**/*.{test,spec}.{ts,tsx}",
  "adapters/*/tests/**/*.{test,spec}.{ts,tsx}",
  "packages/*/tests/**/*.{test,spec}.{ts,tsx}",
  "scripts/**/*.{test,spec}.{ts,tsx}",
  "tests/unit/**/*.{test,spec}.{ts,tsx}",
];
const EXCLUDE = [
  "**/node_modules/**", "**/dist/**", "**/.turbo/**",
  "packages/design-system/**", "apps/hq/**",
  "**/*.int.{test,spec}.{ts,tsx}", "**/*.perf.{test,spec}.{ts,tsx}",
  "**/*.stress.{test,spec}.{ts,tsx}", "**/*.smoke.{test,spec}.{ts,tsx}",
  "**/*.cross.{test,spec}.{ts,tsx}",
  "tests/integration/**", "tests/performance/**", "tests/stress/**",
  "tests/smoke/**", "tests/cross/**",
];
const VITEST_ARGS = ["--configLoader", "runner", "--project", "unit"];
const FILTER_ARGS = [...INCLUDE.flatMap((g) => ["--include", g]), ...EXCLUDE.flatMap((g) => ["--exclude", g])];

const sh = (cmd, args, opts = {}) => {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message ?? null, ms: performance.now() - t0 };
};
const must = (cmd, args, opts) => {
  const r = sh(cmd, args, opts);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r.stdout;
};
const git = (dir, args) => must("git", ["-C", dir, ...args]).trim();
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const relOf = (abs) => path.relative(fs.realpathSync(W), abs).split(path.sep).join("/");
const log = (...a) => console.error(new Date().toISOString(), ...a);

// Vitest JSON report -> {files: {rel: status}, success, unhandled}
function readReport(file) {
  if (!fs.existsSync(file)) return null;
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const files = {};
  for (const tr of j.testResults ?? []) files[relOf(tr.name)] = { status: tr.status, message: (tr.message ?? "").slice(0, 300), tests: (tr.assertionResults ?? []).length };
  return { files, success: j.success === true, unhandled: (j.unhandledErrors ?? []).length, total: j.numTotalTestSuites ?? null };
}

// Plain run (no recorder), same env as the adapter.
function groundTruth(label, extraArgs) {
  const out = path.join(TMP, `gt-${label}.json`);
  fs.rmSync(out, { force: true });
  const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || "test" };
  const r = sh(process.execPath, [VITEST, "run", ...extraArgs, "--root", W, ...VITEST_ARGS, "--reporter=json", `--outputFile=${out}`], { cwd: W, env, timeout: 900_000 });
  const rep = readReport(out);
  return { exit: r.status, ms: r.ms, report: rep, stderrTail: r.stderr.slice(-800) };
}

function materialise(osSha, prevW) {
  // Remove the previous commit's tracked files and any untracked leftovers,
  // keeping node_modules (which is not part of the commit).
  // Every file outside node_modules goes (tracked, untracked and ignored), so no
  // file from an earlier commit can survive into this one.
  must("sh", ["-c", `find "${W}" \\( -name node_modules -o -name .git \\) -prune -o \\( -type f -o -type l \\) -print0 | xargs -0 rm -f; find "${W}" -mindepth 1 -depth \\( -name .git -prune \\) -o \\( -type d -empty -print \\) | xargs -r rmdir`]);
  must("sh", ["-c", `git -C ${OS} archive ${osSha} | tar -x -C ${W}`]);
  git(W, ["add", "-A"]);
  const tree = git(W, ["write-tree"]);
  const want = git(OS, ["rev-parse", `${osSha}^{tree}`]);
  if (tree !== want) throw new Error(`tree mismatch at ${osSha}: W ${tree} != Os ${want}`);
  // Build outputs (ignored by git) are pinned to the copies taken from the Os
  // checkout at HEAD. They are not part of any commit (see GATE.md, environment).
  if (fs.existsSync(DIST_PIN)) must("sh", ["-c", `cp -cR "${DIST_PIN}/." "${W}/"`]);
  git(W, ["-c", "user.name=gate0", "-c", "user.email=gate0@localhost", "commit", "-q", "--allow-empty", "-m", `replay ${osSha}`]);
  return git(W, ["rev-parse", "HEAD"]);
}

function coldAffected(changeSetFile, contextFile, baseline) {
  const samples = [];
  let ok = true; let last = "";
  for (let k = 0; k < 5; k++) {
    const copy = path.join(TMP, "storecopy");
    fs.rmSync(copy, { recursive: true, force: true });
    must("cp", ["-cR", STORE, copy]);
    const r = sh(CORE, ["affected", "--changes", changeSetFile, "--baseline", baseline, "--context", contextFile], { env: { ...process.env, BACKPLANE_STORE: copy } });
    samples.push(r.ms);
    last = r.stdout.slice(0, 300);
    if (r.status !== 0 || !r.stdout.includes('"ok":true') && !r.stdout.includes('"tasks"')) ok = false;
    fs.rmSync(copy, { recursive: true, force: true });
  }
  return { samples_ms: samples.map((x) => Math.round(x * 10) / 10), median_ms: median(samples), ok, last };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const headSha = git(OS, ["rev-parse", "HEAD"]);
  const all = git(OS, ["rev-list", "--first-parent", headSha]).split("\n").filter(Boolean);
  // The window: newest first, up to 200 commits, stopping before the first commit
  // that has no unit project (PLAN 12.5 needs the suite defined, see GATE.md).
  const PROJECT_FILE = "packages/vitest-config/src/projects/globs.ts";
  let window = [];
  for (const c of all) {
    if (window.length >= 200) break;
    if (sh("git", ["-C", OS, "cat-file", "-e", `${c}:${PROJECT_FILE}`]).status !== 0) break;
    // The root config must not import a package the installed node_modules does not link (E. env note).
    const cfg = sh("git", ["-C", OS, "show", `${c}:vitest.config.ts`]).stdout;
    if (cfg.includes("@frontal-os/testing")) break;
    window.push(c);
  }
  const n = COUNT === "all" ? window.length : Math.min(Number(COUNT), window.length);
  const commits = window.slice(0, n).reverse(); // oldest first
  fs.writeFileSync(path.join(OUT, "_plan.json"), JSON.stringify({ os_head: headSha, first_parent_total: all.length, commits, include: INCLUDE, exclude: EXCLUDE, vitest_args: VITEST_ARGS }, null, 2));
  log(`commits selected: ${commits.length} (first-parent of ${headSha}, total ${all.length}; window stops before the first commit without the unit project or whose root config imports an unlinked package)`);

  if (process.env.GT_ONLY) {
    // Probe mode: materialise each listed window index and run only the plain ground truth.
    for (const idx of process.env.GT_ONLY.split(",").map(Number)) {
      const sha = commits[idx];
      materialise(sha);
      const gt = groundTruth(`probe-${idx}`, []);
      const files = gt.report ? Object.values(gt.report.files) : [];
      const failed = gt.report ? Object.entries(gt.report.files).filter(([, v]) => v.status !== "passed").map(([k]) => k) : null;
      console.log(JSON.stringify({ idx, sha: sha.slice(0, 9), exit: gt.exit, files: files.length, failed: failed?.length ?? null, failed_files: failed?.slice(0, 8) ?? null, ms: Math.round(gt.ms) }));
    }
    return;
  }

  // previous state
  let prev = null;
  const existing = fs.readdirSync(OUT).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  if (existing.length) prev = JSON.parse(fs.readFileSync(path.join(OUT, existing[existing.length - 1]), "utf8"));

  for (let i = prev ? prev.index + 1 : 0; i < commits.length && i <= Number(STOP_AT); i++) {
    const osSha = commits[i];
    const rec = { index: i, os_sha: osSha, subject: git(OS, ["log", "-1", "--format=%s", osSha]), date: git(OS, ["log", "-1", "--format=%cI", osSha]) };
    const t0 = performance.now();
    const wSha = materialise(osSha);
    rec.w_sha = wSha;
    rec.materialise_ms = Math.round(performance.now() - t0);

    // (a) ChangeSet from the stored baseline to this commit, from the git source.
    const stored = prev ? prev.stored_after : null;
    rec.stored_before = stored;
    const csRes = sh(GITSRC, ["changes", "--base", stored ?? "HEAD", "--root", W]);
    const cs = csRes.status === 0 ? JSON.parse(csRes.stdout) : null;
    rec.changeset = cs ? { baseline: cs.baseline, count: cs.changes.length, changes: cs.changes } : { error: csRes.stderr || csRes.stdout };
    if (cs) {
      rec.changeset.source_changed = cs.changes.filter((c) => SRC_EXT.test(c.path) && !TEST_FILE.test(c.path)).length;
      // Cross-check against the Os history itself (read only): the same paths and statuses.
      const hasParent = sh("git", ["-C", OS, "rev-parse", "--verify", "-q", `${osSha}^`]).status === 0;
      if (hasParent) {
        const lines = git(OS, ["diff", "--name-status", "-M", `${osSha}^`, osSha]).split("\n").filter(Boolean);
        const osSet = lines.map((l) => { const f = l.split("\t"); const st = f[0][0]; return st === "R" ? `renamed|${f[2]}|${f[1]}` : `${{ M: "modified", A: "added", D: "deleted", T: "modified" }[st]}|${f[1]}|`; }).sort();
        const wSet = cs.changes.map((c) => `${c.status}|${c.path}|${c.old_path ?? ""}`).sort();
        rec.changeset.matches_os = JSON.stringify(osSet) === JSON.stringify(wSet);
        if (!rec.changeset.matches_os) rec.changeset.os_only = osSet.filter((x) => !wSet.includes(x)).slice(0, 20), rec.changeset.w_only = wSet.filter((x) => !osSet.includes(x)).slice(0, 20);
      }
    }
    const contextFile = path.join(TMP, "ctx.json");
    const ctxRes = sh(process.execPath, ["--input-type=module", "-e", `
      import { contextFor, vitestVersion } from ${JSON.stringify(path.join(GRAPH, "adapters/vitest/dist/src/planner.js"))};
      import fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(contextFile)}, JSON.stringify(contextFor(${JSON.stringify(W)}, vitestVersion(${JSON.stringify(VITEST)}))));`]);
    if (ctxRes.status !== 0) throw new Error("context: " + ctxRes.stderr);
    const csFile = path.join(TMP, "changes.json");
    if (cs) fs.writeFileSync(csFile, JSON.stringify(cs));

    // Cold CLI plan timing on a copy of the store at the stored baseline.
    if (stored && cs) rec.cold = coldAffected(csFile, contextFile, stored);

    // (b) adapter: plan at the stored baseline, run invalid tests under the recorder, advance.
    const adArgs = [ADAPTER, "run", "--root", W, "--store", STORE, "--json", ...FILTER_ARGS, "--vitest", VITEST, ...VITEST_ARGS.flatMap((a) => ["--vitest-arg", a])];
    if (i === 0) adArgs.push("--all");
    const ad = sh(process.execPath, adArgs, { cwd: W, timeout: 1_800_000 });
    let rep = null;
    try { rep = JSON.parse(ad.stdout); } catch { rep = null; }
    rec.adapter = { exit: ad.status, ms: Math.round(ad.ms), stderr: ad.stderr.slice(-1500), parsed: rep !== null };
    if (rep) {
      const plan = rep.plan;
      rec.adapter.stored = rep.stored;
      rec.adapter.advanced = rep.advanced;
      rec.adapter.not_advanced = rep.notAdvanced;
      rec.adapter.fallback = rep.fallback;
      rec.adapter.dirty = rep.dirty;
      rec.adapter.discovered = rep.discovered.length;
      rec.adapter.run_selected = rep.selected;
      rec.adapter.total_known = plan ? plan.total_tasks : null;
      rec.adapter.plan_tasks = plan ? plan.tasks : null; // {id, reasons}
      rec.adapter.would_skip = rep.wouldSkip;
      rec.adapter.run_outcomes = rep.results.map((r) => ({ task: r.task, outcome: r.outcome, problem: r.problem }));
    }
    if (ad.status !== 0 && (rep === null || ![1, 7].includes(ad.status))) {
      log(`ADAPTER FAILURE at ${i} exit ${ad.status}: ${ad.stderr.slice(-400)}`);
      fs.writeFileSync(path.join(OUT, `${String(i).padStart(4, "0")}.failed.json`), JSON.stringify(rec, null, 2));
      throw new Error("adapter failure");
    }
    const storedAfter = rep ? (rep.advanced ? rep.headEnd : rep.stored) : null;
    rec.stored_after = storedAfter;

    // (c) ground truth at this commit: a plain full unit run, no recorder.
    const gt = groundTruth(`${i}`, []);
    rec.gt = { exit: gt.exit, ms: Math.round(gt.ms), total_files: gt.report ? Object.keys(gt.report.files).length : null, stderr_tail: gt.stderrTail };
    if (gt.report) {
      rec.gt.files = gt.report.files;
      rec.gt.success = gt.report.success;
      rec.gt.unhandled = gt.report.unhandled;
      rec.gt.failed_files = Object.keys(gt.report.files).filter((f) => gt.report.files[f].status !== "passed");
      rec.gt.green = rec.gt.failed_files.length === 0 && gt.report.success && gt.report.unhandled === 0;
    } else {
      rec.gt.green = false;
      rec.gt.failed_files = null;
    }
    // The planner's discovery against the files vitest actually ran for the unit project.
    if (rep && gt.report) {
      const gtSet = new Set(Object.keys(gt.report.files));
      const dSet = new Set(rep.discovered);
      rec.discovery_check = { discovered: dSet.size, gt_files: gtSet.size, only_discovered: [...dSet].filter((x) => !gtSet.has(x)).slice(0, 20), only_gt: [...gtSet].filter((x) => !dSet.has(x)).slice(0, 20) };
    }

    // (d) evaluation gate: ground truth at the previous commit must be green.
    const gatePrev = prev ? prev.gt?.green === true : false;
    rec.evaluated = i > 0 && gatePrev && rec.adapter && rep && rep.plan !== null;
    rec.gate_prev_green = gatePrev;
    rec.typical = Boolean(rec.evaluated && rec.changeset?.source_changed !== undefined && rec.changeset.source_changed <= 5 && rep.plan.fallback === null);
    if (rec.evaluated) {
      const planned = new Set((rep.plan.tasks ?? []).map((t) => t.id));
      rec.engine_skipped = (rep.wouldSkip ?? []).length;
      rec.engine_skip_share = rec.adapter.discovered ? rec.engine_skipped / rec.adapter.discovered : null;
      rec.discovered = rec.adapter.discovered;
      rec.false_candidates = [];
      rec.false_skips = [];
      rec.flaky_skips = [];
      for (const f of rec.gt.failed_files ?? []) {
        if (planned.has(f)) continue;
        // Not invalidated by the plan at this commit and failing in ground truth: rerun twice.
        const re = [];
        for (let k = 0; k < 2; k++) {
          const out = path.join(TMP, `rerun-${i}-${k}.json`);
          fs.rmSync(out, { force: true });
          const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || "test" };
          const r = sh(process.execPath, [VITEST, "run", f, "--root", W, ...VITEST_ARGS, "--reporter=json", `--outputFile=${out}`], { cwd: W, env, timeout: 900_000 });
          const rr = readReport(out);
          re.push({ exit: r.status, status: rr?.files[f]?.status ?? "no-report" });
        }
        const passedOnRerun = re.some((x) => x.status === "passed");
        const rec2 = { task: f, gt_message: gt.report.files[f].message, reruns: re, reasons_in_plan: null };
        rec.false_candidates.push(rec2);
        if (passedOnRerun) rec.flaky_skips.push(rec2); else rec.false_skips.push(rec2);
      }
      rec.plan_reasons = Object.fromEntries((rep.plan.tasks ?? []).map((t) => [t.id, t.reasons]));
      // K4: the repo's existing selection on the same ChangeSet (vitest related, not run as a gate).
      if (rec.typical) {
        const paths = (cs?.changes ?? []).filter((c) => c.status !== "deleted").map((c) => c.path);
        const rel = path.join(TMP, `related-${i}.json`);
        fs.rmSync(rel, { force: true });
        const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || "test" };
        const r = sh(process.execPath, [VITEST, "related", "--run", "--root", W, ...VITEST_ARGS, "--passWithNoTests", "--reporter=json", `--outputFile=${rel}`, ...paths], { cwd: W, env, timeout: 900_000 });
        const rr = readReport(rel);
        const sel = rr ? Object.keys(rr.files) : null;
        rec.related = { exit: r.status, ms: Math.round(r.ms), selected: sel, selected_count: sel ? sel.length : null, skip_share: sel && rec.adapter.discovered ? 1 - sel.length / rec.adapter.discovered : null, stderr_tail: r.stderr.slice(-300) };
      }
    }
    rec.elapsed_ms = Math.round(performance.now() - t0);
    fs.writeFileSync(path.join(OUT, `${String(i).padStart(4, "0")}.json`), JSON.stringify(rec, null, 2));
    log(`commit ${i} ${osSha.slice(0, 9)} evaluated=${rec.evaluated} gt_green=${rec.gt.green} plan_invalid=${rec.adapter.plan_tasks?.length ?? "-"} exit=${rec.adapter.exit} ${Math.round(rec.elapsed_ms / 1000)}s`);
    prev = { index: i, gt: rec.gt, stored_after: storedAfter };
    if (rep && rec.adapter.exit === 7) log(`WARNING exit 7 at ${i}: ${rec.adapter.not_advanced?.join("; ")}`);
  }
  log("done");
}

main().catch((e) => { log("FATAL", e.stack || e.message); process.exitCode = 1; });

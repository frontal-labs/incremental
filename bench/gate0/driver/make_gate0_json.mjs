// Builds bench/results/gate0.json from the raw Gate 0 probe and timing files.
import fs from "node:fs";

const S = process.argv[2];
const OUT = "/Users/gabrielfonseca/Desktop/graph/bench/results/gate0.json";

const probes = fs
  .readFileSync(`${S}/tmp/probe3.log`, "utf8")
  .split("\n")
  .filter((l) => l.startsWith('{"idx"'))
  .map((l) => JSON.parse(l));
const k3 = [1, 2, 3, 4, 5].map((k) => {
  const t = fs.readFileSync(`${S}/k3/time${k}.txt`, "utf8");
  return Number(/real ([\d.]+)/.exec(t)[1]) * 1000;
});
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const seed = JSON.parse(fs.readFileSync(`${S}/k3/all.json`, "utf8"));
const outcomes = seed.results.reduce((a, r) => ((a[r.outcome] = (a[r.outcome] || 0) + 1), a), {});

const out = {
  gate: "Gate 0 (PLAN 13.1)",
  decision: "STOP",
  decision_basis:
    "PLAN 14.1 and 12.5 step 3d: the replay evaluates a commit only when the ground truth at the previous commit is green. The suite is not green at the reference point (HEAD) or at any of the 8 sampled window commits, so no commit is evaluated and K1, K2 and K4 cannot be measured.",
  os_repo: {
    path: "/Users/gabrielfonseca/Desktop/os",
    branch: "feat/apps-ai-sdk-rebuild",
    head: "47cd74be7b2f9f5ed5878a47ed1c6f08ea092d89",
    first_parent_commits: 173,
    main_branch_first_parent_commits: 128,
    note: "main and HEAD have diverged. The line measured is the first-parent line of HEAD, which is the checkout the lead measured (269 commits in total).",
  },
  window: {
    selection: "first-parent commits of HEAD, newest first, while the unit project exists and the root vitest.config.ts imports no unlinked package",
    count: 127,
    oldest_window_commit: "85806568",
    excluded_older_commits:
      "46 commits. Before first-parent index 43 there is no unit project (packages/vitest-config/src/projects/globs.ts is absent). Indices 43 to 46 import @frontal-os/testing/config, which HEAD's install does not link.",
  },
  evaluated_commits: 0,
  evaluated_basis:
    "Measured on the sample only: 8 window commits, ground truth run in the replay tree. None was green, so none was evaluated. The full window was not swept.",
  metrics: {
    K1: { value: null, threshold: ">= 30%", result: "not measured (0 evaluated commits)" },
    K2: { false_skips: null, n_evaluated_commits: 0, rule_of_three_bound: null, result: "not measurable (0 evaluated commits)" },
    K3: {
      store_tasks: 122,
      cold_affected_ms_samples: k3.map((x) => Math.round(x * 10) / 10),
      median_ms: Math.round(median(k3) * 10) / 10,
      threshold: "< 1000 ms",
      result:
        "pass for a 122-task store at HEAD only. Not measured per commit (no evaluated commits). The 100k-task target is not measured here.",
      note: "The store was seeded by an all-tests adapter run at HEAD, then advanced with `core/dist/backplane advance --expected null`, because the 2 error outcomes block advance (PLAN 11.6). The CLI runs without env, so the plan carries env_changed reasons. The number is a latency figure only.",
    },
    K4: {
      value: null,
      threshold: "engine skips >= 10 pp more than vitest related, or each extra run explained",
      result: "not measured (0 evaluated commits)",
    },
  },
  ground_truth_sample: probes.map((p) => ({
    window_index: p.idx,
    os_commit: p.sha,
    unit_files: p.files,
    failing_files: p.failed,
    failing_list_head: p.failed_files,
    ms: p.ms,
  })),
  head_reference: {
    window_index: 126,
    os_commit: "47cd74be7b2f9f5ed5878a47ed1c6f08ea092d89",
    unit_files: 122,
    failing_files: [
      "tests/unit/api-auth.test.ts: resolves @frontal-os/feature-careers, whose main points to dist/, and features/careers has no dist build in the Os checkout",
      "apps/api/tests/requested-for.test.ts: Cannot find package @/lib/requested-for (not diagnosed)",
    ],
    note: "The lead reported 2 failing test files in the Os working tree. The replay tree at HEAD gives the same count, and both files were not run in the Os checkout (not run there, to leave it untouched).",
  },
  seed_run_at_head: {
    discovered: seed.discovered.length,
    ran: seed.results.length,
    outcomes,
    advanced: seed.advanced,
    exit: seed.exit,
    not_advanced: seed.notAdvanced,
  },
  environment: [
    "The replay tree W is a scratch git repo, not the Os repo. Each Os commit is materialised with git archive. The tree is checked against the Os tree (write-tree equals the Os commit's tree), and a synthetic commit is made so that backplane-git can compute the ChangeSet. backplane-git diffs a ref against the worktree only, and the Os worktree is dirty (8 uncommitted changes).",
    "node_modules: the 90 node_modules directories of the Os checkout were cloned into W with APFS copy-on-write (cp -c). A symlink to the Os node_modules would resolve workspace packages into the dirty Os checkout. One absolute symlink (packages/llm/node_modules/@types) was rewritten to a relative link.",
    "The installed node_modules are HEAD's install. Every window commit has a different lockfile from HEAD. Some workspace packages are absent or unlinked at older commits (for example adapters/r2 and packages/airbyte), and their tests fail to resolve.",
    "Build outputs (dist/ directories, git-ignored, 26 of them, about 3 MB) are pinned to the Os HEAD copies and are not per commit. A test that consumes a dist file would not see source changes in its package, which biases the replay toward fewer detected changes for those tests.",
    "No per-commit dependency install or build was run.",
    "Vitest: the Os repo runs vitest 3.2.4 from its own node_modules, and the adapter pinned 4.1.12. The adapter now runs the repo's Vitest (--vitest) and records its real version as the runner in the context.",
  ],
  harness_changes: [
    "adapters/vitest/src/run.ts: --include and --exclude test discovery filters, --vitest-arg pass-through, --vitest entry, and a discovered list in the report.",
    "adapters/vitest/src/planner.ts: selectTests (glob filter), vitestVersion(bin), and contextFor(root, version) so the runner names the Vitest that runs the tests.",
    "adapters/vitest/src/record.ts: vitestArgs are passed to vitest run.",
    "adapters/vitest/src/preload.ts: the fs wrappers dropped the properties of the wrapped functions, so fs.realpathSync.native was undefined and Vite failed with 'safeRealpathSync is not a function' (Vitest 3.2.4 with Vite 7). Properties are now copied, and realpathSync.native is recorded too.",
    "adapters/vitest dist rebuilt with npm run build.",
  ],
  scratch_drivers: "scratchpad/gate0/driver/ (setup.sh, replay.mjs, probe.sh, make_gate0_json.mjs). Not in the repo.",
  not_done: [
    "The full replay over the window was not run, because the gate cannot be evaluated (see decision).",
    "Per-commit install or build. Exhaustive ground-truth sweep of the window (about 2 hours) to count green commits exactly.",
    "K1, K2, K4 numbers.",
  ],
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log("written", OUT, "probes", probes.length, "K3 median ms", Math.round(median(k3) * 10) / 10);

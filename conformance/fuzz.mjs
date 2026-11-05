#!/usr/bin/env node
// Differential fuzz (PLAN G5): random stores and queries, answered by the
// engine (through serve) and by the reference policy (spec/reference). Any
// difference is reported with its seed, so it can be replayed.
// Usage: node conformance/fuzz.mjs [seed] [stores] [queries-per-store] [engine]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildState, plan } from "../spec/reference/policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const seed = Number(process.argv[2] ?? 20261103) >>> 0;
const nStores = Number(process.argv[3] ?? 100);
const perStore = Number(process.argv[4] ?? 100);
const engine = path.resolve(process.argv[5] ?? path.join(root, "core/dist/incremental"));
const worktree = path.join(root, "conformance/worktrees/base");

// mulberry32: small, seeded, reproducible.
function rng(s) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILES = [
  "packages/core/src/math.ts",
  "packages/core/src/utils.ts",
  "packages/core/src/old.ts",
  "src/a.ts",
  "src/b.ts",
  "docs/x.md",
];
const DIRS = ["packages/app/plugins", "src", "packages/core/src"];
const PROBES = ["packages/core/src/helpers.ts", "src/c.ts"];
const ENVS = ["TG_MODE", "TG_OTHER"];
const HASHES = ["sha256:h1", "sha256:h2"];
const CTX = {
  lockfile: "sha256:l1",
  tsconfig: "sha256:t1",
  pkgjson: "sha256:p1",
  runner: "vitest@4.1.12",
  node: "22.11.0",
  fmt: 1,
  caps: { probes: true, dirs: true, env: true },
};
// The real worktree hashes, so verify sometimes passes and sometimes fails.
const REAL = {
  "packages/core/src/math.ts":
    "sha256:8d344bcb231aaa7f94df684340b260c5edc259441a6e56f600f23f736b3f2f5e",
  "packages/core/src/utils.ts":
    "sha256:13dcfc0fb50a0f649fbf222a00d2159fcb0c17b15bb52e21f21cc2d7ce263a1a",
  "packages/core/src/old.ts":
    "sha256:8df9d7d0e198c9df6e50c5968114ce4618a307b3f7122910a553a77c1a975178",
};

function genStore(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const msgs = [];
  const nTasks = 1 + Math.floor(r() * 6);
  const taskNames = [];
  for (let i = 0; i < nTasks; i++) taskNames.push(`t${i}.test.ts`);
  let id = 2;
  for (const task of taskNames) {
    const inputs = [];
    const nIn = Math.floor(r() * 4);
    for (let k = 0; k < nIn; k++) {
      const kind = pick(["file", "file", "dir", "probe", "env", "env_all", "declared"]);
      if (kind === "file")
        inputs.push({
          kind,
          path: pick(FILES),
          hash: r() < 0.5 ? (REAL[pick(Object.keys(REAL))] ?? pick(HASHES)) : pick(HASHES),
        });
      else if (kind === "declared") inputs.push({ kind, path: pick(FILES), hash: pick(HASHES) });
      else if (kind === "dir") inputs.push({ kind, path: pick(DIRS) });
      else if (kind === "probe") inputs.push({ kind, path: pick(PROBES) });
      else if (kind === "env")
        inputs.push({ kind, name: pick(ENVS), value_hash: r() < 0.5 ? "sha256:v1" : "unset" });
      else {
        const snap = {};
        for (const e of ENVS) if (r() < 0.5) snap[e] = "sha256:v1";
        inputs.push({ kind, snapshot: snap });
      }
    }
    const outcome = pick(["pass", "pass", "pass", "fail", "error", "none"]);
    msgs.push({
      id: id++,
      method: "observe",
      params: {
        observation: {
          task,
          baseline: "b1",
          dirty: r() < 0.1,
          outcome,
          context: CTX,
          inputs,
          outputs: [],
        },
      },
    });
  }
  if (r() < 0.9) msgs.push({ id: id++, method: "advance", params: { to: "b1", expected: null } });
  if (r() < 0.2) msgs.push({ id: id++, method: "forget", params: { task: pick(taskNames) } });
  return msgs;
}

function genQuery(r, qid, taskNames) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const changes = [];
  const nC = Math.floor(r() * 4);
  for (let i = 0; i < nC; i++) {
    const status = pick(["modified", "modified", "added", "added", "deleted", "renamed"]);
    if (status === "renamed")
      changes.push({
        path: pick(FILES.concat(DIRS.map((d) => d + "/n.ts"))),
        status,
        old_path: pick(FILES),
      });
    else
      changes.push({
        path: pick(
          FILES.concat(DIRS.map((d) => d + "/n.ts"))
            .concat(PROBES)
            .concat(["package.json", "docs/y.md"])
            .concat(taskNames),
        ),
        status,
      });
  }
  const options = {
    baseline: r() < 0.05 ? "b0" : "b1",
    verify: r() < 0.3,
    policy: r() < 0.2 ? "conservative" : "balanced",
  };
  const roll = r();
  if (roll < 0.03) {
    /* no context: context_missing */
  } else if (roll < 0.13) options.context = { ...CTX, lockfile: "sha256:l2" };
  else options.context = CTX;
  const env = {};
  for (const e of ENVS) if (r() < 0.5) env[e] = r() < 0.5 ? "sha256:v1" : "sha256:v2";
  options.env = env;
  if (r() < 0.1) options.config = { ignore: ["docs/**"] };
  if (r() < 0.15) options.declared_tasks = [pick(taskNames), "fresh.test.ts"];
  return {
    id: qid,
    method: "affected",
    params: { changes: { baseline: options.baseline, changes }, options },
  };
}

// The reference state is built from the same protocol messages.
function refInput(messages, q) {
  const state = buildState(messages.map((m) => ({ method: m.method, params: m.params })));
  const o = q.params.options;
  const qq = {
    baseline: o.baseline,
    context: o.context,
    env: o.env,
    verify: o.verify,
    policy: o.policy,
    config: o.config,
    declared_tasks: o.declared_tasks,
    changes: q.params.changes.changes,
  };
  return { state, qq };
}

const FIELDS = [
  "tasks",
  "unobserved",
  "ignored",
  "deleted_tasks",
  "fallback",
  "confidence",
  "total_tasks",
  "skipped",
];

const r = rng(seed);
let compared = 0;
let mismatches = [];
const shape = {
  plans: 0,
  fallback: 0,
  withTasks: 0,
  unobserved: 0,
  ignored: 0,
  deleted: 0,
  high: 0,
  reasons: new Map(),
};
const work = fs.mkdtempSync(path.join(os.tmpdir(), "incremental-fuzz-"));
for (let s = 0; s < nStores; s++) {
  const store = path.join(work, `s${s}`);
  spawnSync(engine, ["init", "--store", store]);
  const msgs = genStore(r);
  const taskNames = [
    ...new Set(msgs.filter((m) => m.method === "observe").map((m) => m.params.observation.task)),
  ];
  const queries = [];
  for (let q = 0; q < perStore; q++) queries.push(genQuery(r, 1000 + q, taskNames));
  const input = [
    JSON.stringify({
      id: 1,
      method: "hello",
      params: { protocol: 1, client: { name: "fuzz", version: "0" } },
    }),
    ...msgs.map((m) => JSON.stringify(m)),
    ...queries.map((q) => JSON.stringify(q)),
    "",
  ].join("\n");
  const out = spawnSync(engine, ["serve", "--store", store, "--root", worktree], {
    input,
    encoding: "utf8",
  });
  const byId = new Map(
    out.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .map((x) => [x.id, x]),
  );
  for (const q of queries) {
    const got = byId.get(q.id)?.result;
    const { state, qq } = refInput(msgs, q);
    const want = plan(state, qq, worktree);
    compared++;
    if (want.fallback) shape.fallback++;
    else shape.plans++;
    if (want.tasks.length) shape.withTasks++;
    if (want.unobserved.length) shape.unobserved++;
    if (want.ignored.length) shape.ignored++;
    if (want.deleted_tasks.length) shape.deleted++;
    if (want.confidence === "high") shape.high++;
    for (const t of want.tasks)
      for (const rs of t.reasons) {
        const k = rs.split(":")[0];
        shape.reasons.set(k, (shape.reasons.get(k) ?? 0) + 1);
      }
    const diffs = [];
    for (const f of FIELDS) {
      const a = JSON.stringify(got?.[f] ?? null);
      const b = JSON.stringify(want[f] ?? null);
      if (a !== b) diffs.push(`${f}: engine ${a} reference ${b}`);
    }
    if (diffs.length) mismatches.push({ store: s, query: q.id, diffs, msgs, q });
  }
}
fs.rmSync(work, { recursive: true, force: true });

console.log(
  `coverage: ${JSON.stringify({ ...shape, reasons: Object.fromEntries(shape.reasons) })}`,
);
console.log(
  `seed ${seed}: compared ${compared} queries over ${nStores} stores; ${mismatches.length} differ`,
);
for (const m of mismatches.slice(0, 5)) {
  console.log(`  store ${m.store} query ${m.query}: ${m.diffs.join(" | ")}`);
}
const dump = path.join(root, "conformance", `fuzz-mismatches-${seed}.json`);
if (mismatches.length) {
  fs.writeFileSync(dump, JSON.stringify(mismatches.slice(0, 20), null, 2));
  console.log(`first mismatches written to ${path.relative(root, dump)}`);
  console.log("FAIL fuzz");
  process.exit(1);
}
console.log("PASS fuzz");

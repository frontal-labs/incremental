#!/usr/bin/env node
// Conformance runner (spec/PLAN.md 12.1, DECISIONS.md D-E1-05). Runs every
// case through the engine's `serve` command over the protocol and compares
// the answers with the hand-written expectations. Nothing here computes an
// expected value. Usage: node conformance/run.mjs [engine-binary]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const engine = path.resolve(process.argv[2] ?? path.join(root, "core/dist/incremental"));
const casesDir = path.join(here, "cases");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "incremental-conf-"));

const HELLO = {
  id: 1,
  method: "hello",
  params: { protocol: 1, client: { name: "conformance", version: "0.0.0" } },
};

// Protocol messages from a JSONL file, with ids assigned from `start`.
function storeMessages(file, start) {
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n").filter(Boolean);
  return lines.map((l, i) => ({ id: start + i, ...JSON.parse(l) }));
}

function freshStore(name) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync(engine, ["init", "--store", dir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
  return dir;
}

// Sends the request lines to one serve process; returns parsed responses
// and the raw stdout lines (for byte comparison).
function serve(store, root_, requests, raw = []) {
  const input = [JSON.stringify(HELLO), ...requests.map((r) => JSON.stringify(r)), ...raw, ""].join(
    "\n",
  );
  const r = spawnSync(engine, ["serve", "--store", store, "--root", root_], {
    input,
    encoding: "utf8",
  });
  const lines = r.stdout.split("\n").filter(Boolean);
  return { lines, responses: lines.map((l) => JSON.parse(l)), status: r.status };
}

function worktreeOf(c) {
  return path.join(root, "conformance/worktrees", c.worktree ?? "base");
}

// Query params from a case query (see DECISIONS.md D-E1-05).
function affectedRequest(id, c) {
  const q = c.query;
  const options = { baseline: q.baseline, verify: q.verify, policy: c.mode };
  if (q.context !== undefined) options.context = q.context;
  if (q.env !== undefined) options.env = q.env;
  if (q.declared_tasks !== undefined) options.declared_tasks = q.declared_tasks;
  if (c.config !== undefined) options.config = c.config;
  return {
    id,
    method: "affected",
    params: { changes: { baseline: q.baseline, changes: q.changes }, options },
  };
}

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Compares a plan against the expectation, reporting each mismatch.
function comparePlan(plan, expect) {
  const diffs = [];
  for (const key of ["tasks", "unobserved", "ignored", "deleted_tasks", "fallback", "confidence"]) {
    if (key in expect) {
      if (!sameJSON(plan[key], expect[key])) {
        diffs.push(`${key}: want ${JSON.stringify(expect[key])} got ${JSON.stringify(plan[key])}`);
      }
    }
  }
  return diffs;
}

function appendStoreRecords(store, c) {
  // store.append messages are applied after store.from, through the protocol.
  return (c.store.append ?? []).map((m, i) => ({ id: 1000 + i, ...m }));
}

// Runs one case and returns { status: 'PASS'|'FAIL'|'SKIP', detail }.
function runCase(c) {
  if (c.requires) return { status: "SKIP", detail: `requires ${c.requires} (not implemented)` };
  if (c.determinism === "index") return runIndexCase(c);
  if (c.kind === "concurrency") return runConcurrency(c);

  const store = freshStore(c.id);
  const wt = worktreeOf(c);
  const seed = storeMessages(c.store.from, 100);
  const appended = appendStoreRecords(store, c);
  const storeReqs = [...seed, ...appended];
  const base = 500;

  // Protocol-level action cases.
  if (c.action && c.action.method === "hello") {
    const r = spawnSync(engine, ["serve", "--store", store, "--root", wt], {
      input: JSON.stringify({ id: 1, ...c.action }) + "\n",
      encoding: "utf8",
    });
    const resp = JSON.parse(r.stdout.split("\n").filter(Boolean)[0]);
    const ok = resp.error && resp.error.code === c.expect.error && r.status === 2;
    return ok
      ? { status: "PASS" }
      : { status: "FAIL", detail: `got ${r.stdout.trim()} exit ${r.status}` };
  }

  if (c.action) {
    const run = serve(store, wt, [
      ...storeReqs,
      { id: base, ...c.action },
      { id: base + 1, method: "baseline" },
    ]);
    const act = run.responses.find((r) => r.id === base);
    const after = run.responses.find((r) => r.id === base + 1);
    const diffs = [];
    if (!act || !act.error || act.error.code !== c.expect.error)
      diffs.push(`error: want ${c.expect.error} got ${JSON.stringify(act)}`);
    if (
      c.expect.baseline_after !== undefined &&
      (!after || after.result.baseline !== c.expect.baseline_after)
    ) {
      diffs.push(`baseline_after: want ${c.expect.baseline_after} got ${JSON.stringify(after)}`);
    }
    return diffs.length ? { status: "FAIL", detail: diffs.join("; ") } : { status: "PASS" };
  }

  if (c.raw_lines) {
    const run = serve(store, wt, storeReqs, c.raw_lines);
    const want = c.expect.responses;
    const diffs = [];
    want.forEach((w, i) => {
      const got =
        run.responses.find((r) => r.id === w.id) ?? run.responses[i + storeReqs.length + 1];
      const idOk = w.id === null ? got && got.id === null : got && got.id === w.id;
      if (!idOk) diffs.push(`response ${i}: id ${JSON.stringify(got?.id)}`);
      if (w.error_code && got.error?.code !== w.error_code)
        diffs.push(`response ${i}: error ${JSON.stringify(got)}`);
      if (w.result && !sameJSON(got.result, w.result))
        diffs.push(`response ${i}: result ${JSON.stringify(got)}`);
    });
    return diffs.length ? { status: "FAIL", detail: diffs.join("; ") } : { status: "PASS" };
  }

  if (c.post_raw_log !== undefined) {
    // Build the store, append raw text to the log, then start a new process.
    serve(store, wt, storeReqs);
    fs.appendFileSync(path.join(store, "tg.log"), c.post_raw_log);
    const run = serve(store, wt, [affectedRequest(base, c)]);
    const plan = run.responses.find((r) => r.id === base)?.result;
    const diffs = plan ? comparePlan(plan, c.expect) : ["no plan response"];
    return diffs.length ? { status: "FAIL", detail: diffs.join("; ") } : { status: "PASS" };
  }

  // Build the store once; every query after this reads the same log, so
  // graph_version and the bytes of a plan are comparable across runs.
  serve(store, wt, storeReqs);
  const q1 = affectedRequest(base, c);
  const run = serve(store, wt, [q1]);
  const got = run.responses.find((r) => r.id === base);
  if (!got || !got.result) return { status: "FAIL", detail: `no plan: ${run.lines.join(" | ")}` };

  const diffs = comparePlan(got.result, c.expect);

  if (c.determinism === "repeat") {
    const again = serve(store, wt, [q1, q1]);
    const bytes = again.lines.filter((l) => JSON.parse(l).id === base);
    if (bytes.length !== 2 || bytes[0] !== bytes[1]) diffs.push("repeat: bytes differ");
  }
  if (c.determinism === "shuffle") {
    const reversed = {
      ...q1,
      params: {
        ...q1.params,
        changes: { ...q1.params.changes, changes: [...q1.params.changes.changes].reverse() },
      },
    };
    const other = serve(store, wt, [reversed]);
    const a = run.lines.find((l) => JSON.parse(l).id === base);
    const b = other.lines.find((l) => JSON.parse(l).id === base);
    if (a !== b) diffs.push("shuffle: bytes differ from reversed input order");
  }
  if (c.determinism === "cache") {
    // Verify with the stat cache present (written by the first run), then
    // with it deleted: the answer must not change (spec 7.6).
    const cache = path.join(store, "stat.cache");
    const cached = fs.existsSync(cache);
    const again = serve(store, wt, [q1]).responses.find((r) => r.id === base)?.result;
    fs.rmSync(cache, { force: true });
    const cold = serve(store, wt, [q1]).responses.find((r) => r.id === base)?.result;
    if (!cached) diffs.push("cache: stat.cache was not written by verify");
    if (!sameJSON(again, got.result) || !sameJSON(cold, got.result))
      diffs.push("cache: answer changed with the cache");
  }
  return diffs.length ? { status: "FAIL", detail: diffs.join("; ") } : { status: "PASS" };
}

// C38: the same query from (a) a valid index, (b) a rebuild with no index,
// and (c) a stale index plus the log bytes after it (the delta layer) must
// give the same plan bytes, and match the expectation.
function runIndexCase(c) {
  const store = freshStore(c.id);
  const wt = worktreeOf(c);
  const storeReqs = [...storeMessages(c.store.from, 100), ...appendStoreRecords(store, c)];
  serve(store, wt, storeReqs); // writes tg.idx at exit
  const idx = path.join(store, "tg.idx");
  const saved = fs.readFileSync(idx);
  const q = affectedRequest(500, c);
  const planOf = (r) => r.lines.find((l) => JSON.parse(l).id === 500);

  const a = serve(store, wt, [q]); // from the index
  fs.rmSync(idx);
  const b = serve(store, wt, [q]); // rebuilt from the log
  // Log grows past the saved index; then restore the stale index.
  serve(store, wt, [
    {
      id: 600,
      method: "observe",
      params: {
        observation: {
          task: "packages/core/src/extra.test.ts",
          baseline: "b1",
          dirty: false,
          outcome: "pass",
          context: {
            lockfile: "sha256:l1",
            tsconfig: "sha256:t1",
            pkgjson: "sha256:p1",
            runner: "vitest@4.1.12",
            node: "22.11.0",
            fmt: 1,
            caps: { probes: true, dirs: true, env: true },
          },
          inputs: [],
        },
      },
    },
  ]);
  fs.writeFileSync(idx, saved);
  const cdelta = serve(store, wt, [q]); // stale index + delta
  fs.rmSync(idx);
  const d = serve(store, wt, [q]); // rebuilt, after the same log growth

  const diffs = [];
  if (!planOf(a) || planOf(a) !== planOf(b)) diffs.push("index plan differs from rebuilt plan");
  if (!planOf(cdelta) || planOf(cdelta) !== planOf(d))
    diffs.push("delta plan differs from rebuilt plan");
  const got = JSON.parse(planOf(a)).result;
  diffs.push(...comparePlan(got, c.expect));
  return diffs.length ? { status: "FAIL", detail: diffs.join("; ") } : { status: "PASS" };
}

// C40: two writer processes at once, then the store must hold both sets.
function runConcurrency(c) {
  const store = freshStore(c.id);
  const wt = worktreeOf(c);
  const seed = storeMessages(c.store.from, 100);
  serve(store, wt, seed);
  const writer = (w) => {
    const reqs = [];
    for (let i = 0; i < c.per_writer; i++) {
      reqs.push({
        id: 10 + i,
        method: "observe",
        params: {
          observation: {
            task: `packages/core/src/gen/w${w}_${i}.test.ts`,
            baseline: "b1",
            dirty: false,
            context: {
              lockfile: "sha256:l1",
              tsconfig: "sha256:t1",
              pkgjson: "sha256:p1",
              runner: "vitest@4.1.12",
              node: "22.11.0",
              fmt: 1,
              caps: { probes: true, dirs: true, env: true },
            },
            inputs: [],
            outputs: [],
            outcome: "pass",
            duration_ms: 1,
          },
        },
      });
    }
    return new Promise((resolve) => {
      const p = spawn(engine, ["serve", "--store", store, "--root", wt]);
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", () => resolve(out));
      p.stdin.end([JSON.stringify(HELLO), ...reqs.map((r) => JSON.stringify(r))].join("\n") + "\n");
    });
  };
  return Promise.all([writer(0), writer(1)]).then((outs) => {
    const accepted = outs
      .join("")
      .split("\n")
      .filter(Boolean)
      .filter((l) => l.includes('"accepted":true')).length;
    const stats = serve(store, wt, [{ id: 99, method: "stats" }]).responses.find(
      (r) => r.id === 99,
    )?.result;
    const diffs = [];
    if (accepted !== 2 * c.per_writer) diffs.push(`accepted ${accepted} of ${2 * c.per_writer}`);
    if (!stats || stats.tasks !== c.expect.tasks)
      diffs.push(`tasks: want ${c.expect.tasks} got ${JSON.stringify(stats)}`);
    if (!stats || stats.observations !== c.expect.observations)
      diffs.push(`observations: want ${c.expect.observations} got ${JSON.stringify(stats)}`);
    return diffs.length ? { status: "FAIL", detail: diffs.join("; ") } : { status: "PASS" };
  });
}

async function main() {
  if (!fs.existsSync(engine)) {
    console.log(`FAIL test-policy: engine not found at ${engine} (run make build)`);
    process.exit(1);
  }
  const only = process.env.CONF_ONLY ? process.env.CONF_ONLY.split(",") : null;
  const files = fs
    .readdirSync(casesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .filter((f) => !only || only.includes(f.replace(".json", "")));
  let pass = 0;
  let fail = 0;
  let skip = 0;
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(path.join(casesDir, f), "utf8"));
    let result;
    try {
      result = await runCase(c);
    } catch (e) {
      result = { status: "FAIL", detail: `runner error: ${e.message}` };
    }
    if (result.status === "PASS") pass++;
    else if (result.status === "SKIP") skip++;
    else fail++;
    const tail = result.detail ? `  ${result.detail}` : "";
    console.log(`${result.status} ${c.id} ${c.desc}${tail}`);
  }
  console.log(`cases: ${pass} pass, ${fail} fail, ${skip} skip`);
  fs.rmSync(work, { recursive: true, force: true });
  if (fail > 0 || skip > 0) {
    console.log("FAIL test-policy");
    process.exit(1);
  }
  console.log("PASS test-policy");
}

main();

// Runs every conformance case (conformance/cases/*.json) through the Node
// client and checks the expectations the way conformance/run.mjs does.
// Cases that the client cannot express (a protocol version other than 1, and
// malformed raw lines) are run against the engine process directly, with the
// same logic as run.mjs. Nothing here computes an expected value.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  incrementalError,
  connect,
  type AffectedOptions,
  type ChangeSet,
  type Observation,
} from "../src/index.js";
import {
  ENGINE,
  comparePlan,
  initStore,
  loadCases,
  once,
  replay,
  sameJSON,
  seedsOf,
  worktreeOf,
  type CaseFile,
} from "./helpers.js";

// Cases run through the engine process, not the client (see the note above).
const RAW_CASES = new Set(["C34", "C35"]);

const HELLO = { id: 1, method: "hello", params: { protocol: 1, client: { name: "conformance", version: "0.0.0" } } };

// The client's affected options for a query case (run.mjs affectedRequest).
// A case without context is passed without it on purpose (P0b): the client
// type requires context, so the test casts.
function optionsOf(c: CaseFile): AffectedOptions {
  const q = c.query!;
  const o: Record<string, unknown> = { baseline: q.baseline, verify: q.verify, policy: c.mode, context: q.context };
  if (q.env !== undefined) o.env = q.env;
  if (q.declared_tasks !== undefined) o.declared_tasks = q.declared_tasks;
  if (c.config !== undefined) o.config = c.config;
  return o as unknown as AffectedOptions;
}

function changesOf(c: CaseFile): ChangeSet {
  return { baseline: c.query!.baseline, changes: c.query!.changes };
}

async function buildStore(c: CaseFile, store: string, root: string): Promise<void> {
  await once(store, root, (k) => replay(k, seedsOf(c)));
  if (c.post_raw_log !== undefined) {
    // A truncated or unknown record appended after the store was written.
    fs.appendFileSync(path.join(store, "tg.log"), c.post_raw_log);
  }
}

// Engine process, one request per line; returns the parsed responses.
function rawServe(store: string, root: string, lines: string[]): { status: number | null; responses: Record<string, unknown>[] } {
  const r = spawnSync(ENGINE, ["serve", "--store", store, "--root", root], {
    input: lines.join("\n") + "\n",
    encoding: "utf8",
  });
  const responses = r.stdout
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { status: r.status, responses };
}

async function runRawCase(c: CaseFile): Promise<string[]> {
  const store = initStore(c.id);
  const wt = worktreeOf(c);
  const diffs: string[] = [];
  if (c.action) {
    // C34: hello with an unsupported protocol version.
    const r = rawServe(store, wt, [JSON.stringify({ id: 1, ...c.action })]);
    const err = r.responses[0]?.error as { code?: string } | undefined;
    if (err?.code !== c.expect.error) diffs.push(`error: want ${String(c.expect.error)} got ${JSON.stringify(r.responses[0])}`);
    if (r.status !== 2) diffs.push(`exit: want 2 got ${String(r.status)}`);
    return diffs;
  }
  // C35: malformed line, then a valid request; the loop must continue.
  const seeds = seedsOf(c).map((m, i) => JSON.stringify({ id: 100 + i, ...m }));
  const r = rawServe(store, wt, [JSON.stringify(HELLO), ...seeds, ...(c.raw_lines ?? [])]);
  const want = (c.expect.responses as { id: number | null; error_code?: string; result?: unknown }[]);
  for (const w of want) {
    const got = r.responses.find((x) => x.id === w.id);
    if (got === undefined) {
      diffs.push(`no response with id ${String(w.id)}`);
      continue;
    }
    if (w.error_code !== undefined && (got.error as { code?: string } | undefined)?.code !== w.error_code) {
      diffs.push(`id ${String(w.id)}: error ${JSON.stringify(got)}`);
    }
    if (w.result !== undefined && !sameJSON(got.result, w.result)) diffs.push(`id ${String(w.id)}: result ${JSON.stringify(got)}`);
  }
  return diffs;
}

async function runAdvanceCase(c: CaseFile): Promise<string[]> {
  // C26: advance with a stale expected value must be rejected and change nothing.
  const store = initStore(c.id);
  const wt = worktreeOf(c);
  await buildStore(c, store, wt);
  const diffs: string[] = [];
  const act = c.action!;
  if (act.method !== "advance") throw new Error(`unsupported action ${act.method}`);
  const k = await connect({ store, root: wt });
  try {
    try {
      await k.advance(act.params.to as string, act.params.expected as string | null);
      diffs.push("error: advance succeeded");
    } catch (e) {
      const code = e instanceof incrementalError ? e.code : String(e);
      if (code !== c.expect.error) diffs.push(`error: want ${String(c.expect.error)} got ${code}`);
    }
    const after = await k.baseline();
    if (c.expect.baseline_after !== undefined && after.baseline !== c.expect.baseline_after) {
      diffs.push(`baseline_after: want ${String(c.expect.baseline_after)} got ${String(after.baseline)}`);
    }
  } finally {
    await k.close();
  }
  return diffs;
}

async function runConcurrencyCase(c: CaseFile): Promise<string[]> {
  // C40: two writers, each on its own connection, must both be recorded.
  const store = initStore(c.id);
  const wt = worktreeOf(c);
  await buildStore(c, store, wt);
  const writer = async (w: number): Promise<void> => {
    const k = await connect({ store, root: wt });
    try {
      for (let i = 0; i < (c.per_writer ?? 0); i++) {
        const obs: Observation = {
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
        };
        await k.observe(obs);
      }
    } finally {
      await k.close();
    }
  };
  await Promise.all(Array.from({ length: c.writers ?? 0 }, (_, w) => writer(w)));
  const stats = await once(store, wt, (k) => k.stats());
  const diffs: string[] = [];
  const want = c.expect as { tasks: number; observations: number };
  if (stats.tasks !== want.tasks) diffs.push(`tasks: want ${want.tasks} got ${stats.tasks}`);
  if (stats.observations !== want.observations) diffs.push(`observations: want ${want.observations} got ${stats.observations}`);
  return diffs;
}

async function runIndexCase(c: CaseFile): Promise<string[]> {
  // C38: the same query from (a) a valid index, (b) a rebuild with no index,
  // and (c) a stale index plus the log after it (the delta layer), and (d) a
  // rebuild after the same log growth, must give the same plan.
  const store = initStore(c.id);
  const wt = worktreeOf(c);
  await buildStore(c, store, wt); // writes tg.idx on close
  const idx = path.join(store, "tg.idx");
  const saved = fs.readFileSync(idx);
  const cs = changesOf(c);
  const opts = optionsOf(c);

  const a = await once(store, wt, (k) => k.affected(cs, opts)); // from the index
  fs.rmSync(idx);
  const b = await once(store, wt, (k) => k.affected(cs, opts)); // rebuilt from the log
  // The log grows past the saved index.
  await once(store, wt, (k) =>
    k.observe({
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
      outputs: [],
    }),
  );
  fs.writeFileSync(idx, saved); // stale index
  const cdelta = await once(store, wt, (k) => k.affected(cs, opts));
  fs.rmSync(idx);
  const d = await once(store, wt, (k) => k.affected(cs, opts));

  const diffs: string[] = [];
  if (!sameJSON(a, b)) diffs.push("index plan differs from rebuilt plan");
  if (!sameJSON(cdelta, d)) diffs.push("delta plan differs from rebuilt plan");
  diffs.push(...comparePlan(a, c.expect));
  return diffs;
}

async function runQueryCase(c: CaseFile): Promise<string[]> {
  const store = initStore(c.id);
  const wt = worktreeOf(c);
  await buildStore(c, store, wt);
  const cs = changesOf(c);
  const opts = optionsOf(c);
  // Each affected call is its own connection, as the CLI runs were in run.mjs.
  const plan = await once(store, wt, (k) => k.affected(cs, opts));
  const diffs = comparePlan(plan, c.expect);
  const cached = fs.existsSync(path.join(store, "stat.cache")); // written by verify

  if (c.determinism === "repeat") {
    const [x, y] = await once(store, wt, async (k) => [await k.affected(cs, opts), await k.affected(cs, opts)]);
    if (!sameJSON(x, y)) diffs.push("repeat: bytes differ");
  }
  if (c.determinism === "shuffle") {
    const reversed: ChangeSet = { ...cs, changes: [...cs.changes].reverse() };
    const other = await once(store, wt, (k) => k.affected(reversed, opts));
    if (!sameJSON(plan, other)) diffs.push("shuffle: bytes differ from reversed input order");
  }
  if (c.determinism === "cache") {
    // Verify with the stat cache present, then without it (spec 7.6).
    const again = await once(store, wt, (k) => k.affected(cs, opts));
    fs.rmSync(path.join(store, "stat.cache"), { force: true });
    const cold = await once(store, wt, (k) => k.affected(cs, opts));
    if (!cached) diffs.push("cache: stat.cache was not written by verify");
    if (!sameJSON(again, plan) || !sameJSON(cold, plan)) diffs.push("cache: answer changed with the cache");
  }
  return diffs;
}

async function runCase(c: CaseFile): Promise<string[]> {
  if (c.kind === "concurrency") return runConcurrencyCase(c);
  if (c.determinism === "index") return runIndexCase(c);
  if (c.action?.method === "hello") return runRawCase(c);
  if (c.raw_lines !== undefined) return runRawCase(c);
  if (c.action) return runAdvanceCase(c);
  return runQueryCase(c);
}

const cases = loadCases();

for (const c of cases) {
  const via = RAW_CASES.has(c.id) ? "engine process" : "client";
  test(`${c.id} [${via}] ${c.desc}`, async () => {
    const diffs = await runCase(c);
    assert.deepEqual(diffs, [], diffs.join("; "));
  });
}

test("coverage: every case runs, and only C34 and C35 bypass the client", () => {
  const raw = cases.filter((c) => RAW_CASES.has(c.id)).map((c) => c.id);
  assert.deepEqual(raw, ["C34", "C35"]);
  assert.equal(cases.length, 40);
  assert.equal(cases.length - raw.length, 38);
  // The runner skips nothing; a case with `requires` would be a skip.
  assert.equal(cases.filter((c) => c.requires !== undefined).length, 0);
});

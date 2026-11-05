// Byte-identical plans: for each query case, the plan the client returns,
// serialized with JSON.stringify, must equal the stdout of the CLI
// `incremental affected` for the same inputs (plans/PLAN.md 15.4 E3).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AffectedOptions, ChangeSet } from "../src/index.js";
import { ENGINE, REPO, initStore, loadCases, once, replay, seedsOf, tempDir, worktreeOf } from "./helpers.js";

// Not comparable with the CLI: C27 has no context (the CLI requires --context)
// and C04 passes declared_tasks (the CLI has no flag for it).
const NOT_IN_CLI = new Set(["C04", "C27"]);

const cases = loadCases().filter((c) => c.query !== undefined);
const results: { id: string; exact: boolean; semantic: boolean }[] = [];

for (const c of cases) {
  const q = c.query!;
  const label = NOT_IN_CLI.has(c.id) ? "skipped (not expressible through the CLI)" : "";
  if (NOT_IN_CLI.has(c.id)) {
    test(`${c.id} plan byte-identical to CLI ${label}`, { skip: label }, () => undefined);
    continue;
  }
  test(`${c.id} plan byte-identical to CLI`, async () => {
    const store = initStore(`plan-${c.id}`);
    // Config cases: the CLI reads incremental.config.json from --root, so the
    // worktree is copied and the config written there (same values as the client).
    let root = worktreeOf(c);
    if (c.config !== undefined) {
      root = path.join(tempDir(`root-${c.id}`), "root");
      fs.cpSync(worktreeOf(c), root, { recursive: true });
      fs.writeFileSync(path.join(root, "incremental.config.json"), JSON.stringify(c.config));
    }
    // Build the store through the client, with the case's post-write log bytes.
    await once(store, root, (k) => replay(k, seedsOf(c)));
    if (c.post_raw_log !== undefined) fs.appendFileSync(path.join(store, "tg.log"), c.post_raw_log);

    const dir = tempDir(`cli-${c.id}`);
    const changesFile = path.join(dir, "changes.json");
    const contextFile = path.join(dir, "context.json");
    fs.writeFileSync(changesFile, JSON.stringify({ baseline: q.baseline, changes: q.changes }));
    fs.writeFileSync(contextFile, JSON.stringify(q.context));

    const cs: ChangeSet = { baseline: q.baseline, changes: q.changes };
    const opts = {
      baseline: q.baseline,
      verify: q.verify,
      policy: c.mode,
      context: q.context,
      ...(q.env !== undefined ? { env: q.env } : {}),
      ...(c.config !== undefined ? { config: c.config } : {}),
    } as unknown as AffectedOptions;
    const clientPlan = await once(store, root, (k) => k.affected(cs, opts));
    const clientBytes = JSON.stringify(clientPlan);

    const args = [
      "affected", "--store", store, "--root", root,
      "--changes", changesFile, "--baseline", q.baseline, "--context", contextFile,
      "--policy", c.mode ?? "balanced",
    ];
    if (q.env !== undefined) {
      const envFile = path.join(dir, "env.json");
      fs.writeFileSync(envFile, JSON.stringify(q.env));
      args.push("--env", envFile);
    }
    if (q.verify) args.push("--verify");
    const r = spawnSync(ENGINE, args, { encoding: "utf8" });
    assert.equal(r.status, 0, `CLI exit ${String(r.status)}: ${r.stdout} ${r.stderr}`);
    const cliLine = r.stdout.replace(/\n$/, "");
    const exact = cliLine === clientBytes;
    const semantic = JSON.stringify(JSON.parse(cliLine)) === clientBytes;
    results.push({ id: c.id, exact, semantic });
    assert.equal(clientBytes, cliLine, `client and CLI plans differ for ${c.id}`);
  });
}

test("summary: byte-identical plans cover every expressible query case", () => {
  // Runs after the case tests above (node:test runs tests in a file in order).
  const expressible = cases.filter((c) => !NOT_IN_CLI.has(c.id)).map((c) => c.id);
  assert.equal(results.length, expressible.length, "not every expressible case ran");
  const diff = results.filter((x) => !x.exact).map((x) => x.id);
  assert.deepEqual(diff, [], `byte mismatches: ${diff.join(",")}`);
  process.stdout.write(`byte-identical client vs CLI plans: ${results.length} of ${expressible.length} cases (repo ${REPO})\n`);
});

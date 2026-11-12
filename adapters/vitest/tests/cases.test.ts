// V01 to V16 end to end (PLAN 12.3, E6): each case runs the whole loop on a
// copy of the fixture with real recordings. The expectations are the ones in
// fixtures/cases, hand-written from PLAN 12.3 and POLICY.md.
import assert from "node:assert/strict";
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { test, before, after } from "node:test";
import {
  applyEdits,
  commitAll,
  fixtureReady,
  makeRepo,
  normTasks,
  runCli,
  sortChanges,
  tmp,
  loadCases,
  type CaseFile,
  type Change,
  type Step,
} from "./helpers.js";

let template = "";

before(() => {
  fixtureReady();
  template = tmp("bp-template-");
  const repo = path.join(template, "repo");
  const store = path.join(template, "store");
  makeRepo(repo);
  // The prime run: no baseline yet, so every test runs and the baseline becomes HEAD.
  const prime = runCli(repo, store);
  assert.equal(prime.status, 0, `prime run failed: ${prime.stderr} ${JSON.stringify(prime.out)}`);
  assert.equal(prime.out?.advanced, true, "the prime run must advance the baseline");
  assert.equal(
    (prime.out?.results as unknown[] | undefined)?.length,
    14,
    "the prime run must run all 14 tests",
  );
});

after(() => {
  if (template !== "") rmSync(template, { recursive: true, force: true });
});

// Compares one step's actual output with its expectation. Returns mismatches.
function compareStep(
  step: Step,
  status: number | null,
  out: Record<string, unknown> | null,
  stderr: string,
): string[] {
  if (out === null) return [`no JSON output (exit ${status}): ${stderr.slice(-800)}`];
  const problems: string[] = [];
  const plan = (out.plan ?? null) as Record<string, unknown> | null;
  const results = out.results as Array<{ task: string; outcome: string }>;
  const expect = step.expect;
  const check = (field: string, want: unknown, got: unknown): void => {
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      problems.push(`${field}: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
    }
  };
  if (step.query !== undefined) {
    const want = sortChanges(step.query.changes as Change[]);
    const got = sortChanges(out.changes as Change[]);
    check("changes", want, got);
  }
  if (plan === null) return [...problems, "no plan in the output"];
  check("tasks", normTasks(expect.tasks), normTasks(plan.tasks as never));
  check("unobserved", expect.unobserved, plan.unobserved);
  check("ignored", expect.ignored, plan.ignored);
  check("deleted_tasks", expect.deleted_tasks, plan.deleted_tasks);
  check("fallback", expect.fallback, plan.fallback);
  check("confidence", expect.confidence, plan.confidence);
  check("ran", [...expect.ran].sort(), results.map((r) => r.task).sort());
  check("exit", expect.exit, out.exit);
  check("status", expect.exit, status);
  check("advanced", expect.advanced, out.advanced);
  for (const [task, outcome] of Object.entries(expect.outcomes ?? {})) {
    const got = results.find((r) => r.task === task)?.outcome;
    check(`outcome ${task}`, outcome, got);
  }
  return problems;
}

for (const c of loadCases() as CaseFile[]) {
  test(`${c.id}: ${c.desc}`, () => {
    const dir = tmp(`bp-${c.id}-`);
    try {
      cpSync(template, dir, { recursive: true, verbatimSymlinks: true });
      const repo = path.join(dir, "repo");
      const store = path.join(dir, "store");
      const steps: Step[] = [{ edit: c.edit, query: c.query, expect: c.expect }, ...(c.then ?? [])];
      const problems: string[] = [];
      steps.forEach((step, i) => {
        const env = applyEdits(repo, step.edit ?? []);
        commitAll(repo);
        const r = runCli(repo, store, [], env);
        for (const p of compareStep(step, r.status, r.out, r.stderr))
          problems.push(`step ${i + 1}: ${p}`);
      });
      assert.deepEqual(problems, [], `${c.id} mismatches (expected first, got second)`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

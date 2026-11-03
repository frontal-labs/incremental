// CR-001 fixture: the tests run and pass offline under Vitest with the forks
// pool (D-12), with no recorder involved.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FIXTURE, tmp, fixtureReady } from "./helpers.js";
import { vitestBin } from "../src/planner.js";

test("the fixture runs and passes under vitest --pool=forks", () => {
  fixtureReady();
  const dir = tmp("bp-fixture-");
  try {
    cpSync(FIXTURE, dir, { recursive: true, verbatimSymlinks: true });
    const report = path.join(dir, "report.json");
    const r = spawnSync(process.execPath, [vitestBin(), "run", "--root", dir, "--pool=forks", "--reporter=json", `--outputFile=${report}`], {
      cwd: dir,
      encoding: "utf8",
      timeout: 300_000,
    });
    assert.equal(r.status, 0, `vitest failed: ${r.stdout.slice(-800)} ${r.stderr.slice(-800)}`);
    const json = JSON.parse(readFileSync(report, "utf8")) as { numTotalTests: number; numPassedTests: number };
    assert.equal(json.numTotalTests, 14);
    assert.equal(json.numPassedTests, 14);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
// Builds a NEW demo Vitest monorepo with a deterministic history, for the Gate 0
// harness (PLAN 12.5). It is a demo, not a real repository: the history is
// generated. Every commit keeps the suite green except the deliberate "break"
// commits, which fail one test and are fixed by the next commit. Those break
// commits exercise soundness: a failing test must be invalidated.
//
//   node make_demo.mjs <dir> [commits=60] [seed=20261103]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [, , DIR, COMMITS_ARG = "60", SEED_ARG = "20261103"] = process.argv;
if (!DIR) {
  console.error("usage: make_demo.mjs <dir> [commits] [seed]");
  process.exit(2);
}
const COMMITS = Number(COMMITS_ARG);
const rng = (() => {
  let a = Number(SEED_ARG) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
const pick = (xs) => xs[Math.floor(rng() * xs.length)];
const PKGS = ["core", "data", "ui", "app"];
const MODS = [0, 1, 2];

const write = (rel, text) => {
  const p = path.join(DIR, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const git = (args, env = {}) => {
  const r = spawnSync("git", ["-C", DIR, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "demo", GIT_AUTHOR_EMAIL: "demo@example.com", GIT_COMMITTER_NAME: "demo", GIT_COMMITTER_EMAIL: "demo@example.com", ...env },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

// State: each module has constants K and C. The tests import them, so changing
// C keeps tests green and makes them depend on the module file.
const state = {};
const modKey = (p, m) => `${p}/m${m}`;
for (const p of PKGS) for (const m of MODS) state[modKey(p, m)] = { K: 2 + ((PKGS.indexOf(p) * 3 + m) % 5), C: 1 + m };

// The test that reads a module for "breaks" hard-codes an expected value.
const tests = new Map(); // rel path -> { reads: [moduleKey...], hard: null | {module, value} }
const testPath = (p, m, i) => `packages/${p}/test/m${m}_${i}.test.mjs`;

function moduleSource(p, m) {
  const s = state[modKey(p, m)];
  return [
    `export const K = ${s.K};`,
    `export const C = ${s.C};`,
    `export function compute(x) {`,
    `  let s = 0;`,
    `  for (let i = 0; i < 20000; i++) s += (x * K + C + i) % 7;`,
    `  return x * K + C + (s === -1 ? 1 : 0);`,
    `}`,
    ``,
  ].join("\n");
}

function testSource(rel, t) {
  const imports = t.reads.map((k, j) => {
    const [pk, mk] = k.split("/");
    const m = mk.slice(1);
    const rel2 = pk === path.dirname(path.dirname(rel)).split("/").pop()
      ? `../src/m${m}.mjs`
      : `../../${pk}/src/m${m}.mjs`;
    return `import * as M${j} from "${rel2}";`;
  });
  const checks = t.reads.map((k, j) => {
    const s = state[k];
    if (t.hard && t.hard.module === k) {
      return `  it("hard-coded ${k}", () => { expect(M${j}.compute(2)).toBe(${t.hard.value}); });`;
    }
    return `  it("${k} matches its constants", () => { expect(M${j}.compute(2)).toBe(2 * M${j}.K + M${j}.C); });`;
  });
  return [
    `import { describe, expect, it } from "vitest";`,
    ...imports,
    `describe("${rel}", () => {`,
    ...checks,
    `});`,
    ``,
  ].join("\n");
}

function materializeTest(rel) {
  write(rel, testSource(rel, tests.get(rel)));
}

// Base tree.
fs.mkdirSync(DIR, { recursive: true });
write("package.json", JSON.stringify({
  name: "backplane-demo-monorepo", version: "0.0.0", private: true, type: "module",
  workspaces: ["packages/*"], devDependencies: { vitest: "4.1.12" },
}, null, 2) + "\n");
write("vitest.config.mjs", `export default { test: { pool: "forks", include: ["packages/*/test/**/*.test.mjs"] } };\n`);
write("tsconfig.json", `{ "compilerOptions": { "module": "NodeNext", "target": "ES2022" } }\n`);
write("README.md", "# backplane demo monorepo\n\nGenerated history for the Gate 0 harness. Not a real project.\n");
write(".gitignore", "node_modules/\n");
for (const p of PKGS) {
  write(`packages/${p}/package.json`, JSON.stringify({ name: `@demo/${p}`, version: "0.0.0", private: true, type: "module" }, null, 2) + "\n");
  write(`packages/${p}/README.md`, `${p} package\n`);
  write(`packages/${p}/fixtures/cfg.json`, JSON.stringify({ pkg: p, scale: 3 }) + "\n");
  for (const m of MODS) write(`packages/${p}/src/m${m}.mjs`, moduleSource(p, m));
}
// Tests: one per module, plus one cross-package reader per package.
let testCount = 0;
for (const p of PKGS) {
  for (const m of MODS) {
    const rel = testPath(p, m, 0);
    tests.set(rel, { reads: [modKey(p, m)], hard: null });
    materializeTest(rel);
    testCount++;
  }
  const other = PKGS[(PKGS.indexOf(p) + 1) % PKGS.length];
  const rel = testPath(p, 9, 1);
  tests.set(rel, { reads: [modKey(p, 0), modKey(other, 1)], hard: null });
  materializeTest(rel);
  testCount++;
}
// A runtime-reading test (reads a JSON file).
write("packages/app/test/cfg.test.mjs", [
  `import { readFileSync } from "node:fs";`,
  `import { describe, expect, it } from "vitest";`,
  `describe("cfg", () => { it("reads its fixture", () => {`,
  `  const cfg = JSON.parse(readFileSync(new URL("../../core/fixtures/cfg.json", import.meta.url), "utf8"));`,
  `  expect(cfg.scale).toBe(3);`,
  `}); });`,
  ``,
].join("\n"));
testCount++;

// Lockfile (committed once; changed only by "lock" commits, a global input).
const install = spawnSync("npm", ["install", "--legacy-peer-deps", "--no-audit", "--no-fund"], { cwd: DIR, encoding: "utf8" });
if (install.status !== 0) throw new Error(`npm install failed: ${install.stderr}`);

git(["init", "-q", "-b", "main"]);
git(["add", "-A"]);
let when = Date.UTC(2026, 0, 1, 12, 0, 0);
const commitAt = (msg) => {
  when += 3600 * 1000;
  git(["add", "-A"]);
  git(["commit", "-q", "--allow-empty", "-m", msg], { GIT_AUTHOR_DATE: new Date(when).toISOString(), GIT_COMMITTER_DATE: new Date(when).toISOString() });
};
commitAt("base");
console.error(`base: ${testCount} test files`);

// Mutations. Each returns a commit message. "break" leaves the suite red; the
// next commit is always the matching "fix".
let pendingFix = null;
const plan = [];
for (let i = 1; i < COMMITS; i++) plan.push(i);
for (const i of plan) {
  if (pendingFix) {
    const fix = pendingFix;
    pendingFix = null;
    tests.get(fix.test).hard = null;
    materializeTest(fix.test);
    commitAt(`fix: ${fix.test} expectation`);
    continue;
  }
  const r = rng();
  if (r < 0.5) {
    // constant change in one module (1 source file; tests keep passing)
    const k = pick([...Object.keys(state)]);
    state[k].C += 1 + Math.floor(rng() * 3);
    const [kp, km] = k.split("/");
    write(`packages/${kp}/src/${km}.mjs`, moduleSource(kp, Number(km.slice(1))));
    commitAt(`tune ${k}`);
  } else if (r < 0.62) {
    // new test file reading one module
    const k = pick([...Object.keys(state)]);
    const [p, mk] = k.split("/");
    const rel = testPath(p, Number(mk.slice(1)), 100 + i);
    tests.set(rel, { reads: [k], hard: null });
    materializeTest(rel);
    testCount++;
    commitAt(`add test ${rel}`);
  } else if (r < 0.7) {
    // delete a test file (keep at least 20)
    const rels = [...tests.keys()];
    if (rels.length > 20) {
      const rel = pick(rels);
      tests.delete(rel);
      fs.rmSync(path.join(DIR, rel));
      testCount--;
      commitAt(`remove ${rel}`);
    } else {
      commitAt("noop");
    }
  } else if (r < 0.8) {
    // README: nothing reads it
    const p = pick(PKGS);
    write(`packages/${p}/README.md`, `${p} package (${i})\n`);
    commitAt(`docs ${p}`);
  } else if (r < 0.9) {
    // a break: change a constant AND leave a hard-coded expectation behind
    const k = pick([...Object.keys(state)]);
    const [p, mk] = k.split("/");
    const old = 2 * state[k].K + state[k].C;
    const rel = testPath(p, Number(mk.slice(1)), 200 + i);
    tests.set(rel, { reads: [k], hard: { module: k, value: old } });
    materializeTest(rel);
    testCount++;
    commitAt(`add hard-coded test ${rel}`);
    // now the change that breaks it
    state[k].C += 2;
    write(`packages/${p}/src/${mk}.mjs`, moduleSource(p, Number(mk.slice(1))));
    pendingFix = { test: rel };
    commitAt(`break ${k}: ${rel} expects the old value`);
  } else if (r < 0.93) {
    // a lockfile change: a global input, so the plan falls back (not a typical commit)
    const lock = JSON.parse(fs.readFileSync(path.join(DIR, "package-lock.json"), "utf8"));
    lock.demoRevision = i;
    fs.writeFileSync(path.join(DIR, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
    commitAt("lock: bump demo revision");
  } else {
    // a shared change across two modules (6 files total, atypical)
    const a = pick([...Object.keys(state)]);
    const b = pick([...Object.keys(state)]);
    for (const k of [a, b]) {
      state[k].C += 1;
      const [p, mk] = k.split("/");
      write(`packages/${p}/src/${mk}.mjs`, moduleSource(p, Number(mk.slice(1))));
    }
    commitAt(`tune two modules ${a} ${b}`);
  }
}
if (pendingFix) commitAt(`fix: ${pendingFix.test} expectation`);
console.error(`done: ${git(["rev-list", "--count", "HEAD"])} commits, ${testCount} test files at HEAD`);

import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "./git.js";
import type { Edit } from "./types.js";

// One deterministic edit per replayed commit, exercising different input kinds
// (file read, dir listing, probe, global input, broken read, deletion).
// Paths target the fixture dependency graph:
//   app → core → (math, strings)
//   utils → formatter
//
// Edits 1-9 are non-breaking so commits_evaluated builds up; edit 10 breaks a
// test to exercise false-skip detection. Once a commit's ground truth is not
// all green, later commits are not evaluated (prevAllPassed becomes false).
export const EDIT_SEQUENCE: Edit[] = [
  // 1. Non-breaking: add a comment to core math source → all tests pass.
  {
    op: "write",
    path: "packages/core/src/math.ts",
    content:
      "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function mul(a: number, b: number): number {\n  return a * b;\n}\nexport function sum3(a: number, b: number, c: number): number {\n  return add(add(a, b), c);\n}\n// reserved for future use\nexport const RESERVED: number = 0;\n",
  },
  // 2. Non-breaking: add a comment to core strings source → all tests pass.
  {
    op: "write",
    path: "packages/core/src/strings.ts",
    content:
      'export function upper(s: string): string {\n  return s.toUpperCase();\n}\nexport function lower(s: string): string {\n  return s.toLowerCase();\n}\nexport function reverse(s: string): string {\n  return s.split("").reverse().join("");\n}\n// reserved\n',
  },
  // 3. Non-breaking: add a comment to core index → all tests pass.
  {
    op: "write",
    path: "packages/core/src/index.ts",
    content: 'export * from "./math";\nexport * from "./strings";\n// module index\n',
  },
  // 4. Non-breaking: add a comment to app calculator → all tests pass.
  {
    op: "write",
    path: "packages/app/src/calculator.ts",
    content:
      'import { add, mul } from "../../core/src/math";\n\nexport function calculator(a: number, b: number): number {\n  return add(mul(a, 2), b);\n}\n\nexport function total(items: number[]): number {\n  return items.reduce((acc, v) => add(acc, v), 0);\n}\n// calculator module\n',
  },
  // 5. Non-breaking: add a comment to utils formatter → all tests pass.
  {
    op: "write",
    path: "packages/utils/src/formatter.ts",
    content:
      'export function formatCurrency(amount: number): string {\n  return "$" + amount.toFixed(2);\n}\nexport function formatDate(iso: string): string {\n  return new Date(iso).toISOString().split("T")[0];\n}\nexport function slugify(text: string): string {\n  return text.toLowerCase().replace(/\\s+/g, "-").replace(/[^a-z0-9-]/g, "");\n}\n// formatter module\n',
  },
  // 6. Non-breaking: re-export core math with extra blank line → all tests pass.
  {
    op: "write",
    path: "packages/core/src/math.ts",
    content:
      "\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function mul(a: number, b: number): number {\n  return a * b;\n}\n\nexport function sum3(a: number, b: number, c: number): number {\n  return add(add(a, b), c);\n}\n\n",
  },
  // 7. Non-breaking: reorder strings exports → all tests pass.
  {
    op: "write",
    path: "packages/core/src/strings.ts",
    content:
      'export function reverse(s: string): string {\n  return s.split("").reverse().join("");\n}\nexport function upper(s: string): string {\n  return s.toUpperCase();\n}\nexport function lower(s: string): string {\n  return s.toLowerCase();\n}\n',
  },
  // 8. Non-breaking: add blank line to app index → all tests pass.
  {
    op: "write",
    path: "packages/app/src/index.ts",
    content: 'export * from "./calculator";\n\n',
  },
  // 9. Non-breaking: add blank line to utils index → all tests pass.
  {
    op: "write",
    path: "packages/utils/src/index.ts",
    content: 'export * from "./formatter";\n\n',
  },
  // 10. Break core strings source → causes core/test/strings.test.ts to fail.
  //     The engine should invalidate it; if not, it's a false skip.
  {
    op: "write",
    path: "packages/core/src/strings.ts",
    content:
      'export function upper(s: string): string {\n  throw new Error(\'broken strings\');\n}\nexport function lower(s: string): string {\n  return s.toLowerCase();\n}\nexport function reverse(s: string): string {\n  return s.split("").reverse().join("");\n}\n',
  },
];

// The sequence above targets the default fixture (fixture/). The monorepo fixtures
// (monorepos/*) have packages shared, api, web and utils, so they get their own sequence.
// Every edit appends to a source file, so each one changes a single package. Expected
// selection per edit: shared -> shared, api, web; api, web or utils -> only that package.
// Edit 10 appends a module that throws on import, so shared's tests and its dependents
// (api, web) fail: a false skip would show up if the engine did not invalidate them.
export const MONOREPO_EDIT_SEQUENCE: Edit[] = [
  { op: "append", path: "packages/shared/src/index.ts", content: "// replay 1\n" },
  { op: "append", path: "packages/utils/src/index.ts", content: "// replay 2\n" },
  { op: "append", path: "packages/api/src/index.ts", content: "// replay 3\n" },
  { op: "append", path: "packages/web/src/index.ts", content: "// replay 4\n" },
  { op: "append", path: "packages/shared/src/index.ts", content: "// replay 5\n" },
  { op: "append", path: "packages/utils/src/index.ts", content: "// replay 6\n" },
  { op: "append", path: "packages/api/src/index.ts", content: "// replay 7\n" },
  { op: "append", path: "packages/web/src/index.ts", content: "// replay 8\n" },
  { op: "append", path: "packages/shared/src/index.ts", content: "// replay 9\n" },
  {
    op: "append",
    path: "packages/shared/src/index.ts",
    content: 'export const broken: number = (() => { throw new Error("broken shared"); })();\n',
  },
];

// Source files of a repo: .ts/.tsx/.js/.mjs files under a `src` directory, excluding
// tests, declaration files and installed or built output. Sorted, repo-relative, "/" separated.
export function listSourceFiles(repo: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, relPath);
      } else if (
        entry.isFile() &&
        /\.(ts|tsx|js|mjs)$/.test(entry.name) &&
        !/\.(test|spec|test-d)\.|\.d\.ts$/.test(entry.name) &&
        relPath.split("/").includes("src")
      ) {
        out.push(relPath);
      }
    }
  };
  walk(repo, "");
  return out.sort();
}

// A generated sequence of `count` commits for any other Vitest repo. Commits 1 to count-1
// append a comment to a source file, cycling over the repo's source files, so no test
// fails. The last commit breaks the repo's barrel (src/index.ts when it exists): every test
// that imports it fails, and the engine must invalidate them, or it is a false skip.
export function generatedEditSequence(repo: string, count: number, dirs: string[] = []): Edit[] {
  const inScope = (f: string): boolean =>
    dirs.length === 0 || dirs.some((d) => f === d || f.startsWith(d.replace(/\/+$/, "") + "/"));
  const sources = listSourceFiles(repo).filter(inScope);
  if (sources.length === 0)
    throw new Error(`no source files found under ${repo} for ${dirs.join(", ") || "the repo"}`);
  const barrel =
    sources.find((f) => dirs.length > 0 && f === `${dirs[0]!.replace(/\/+$/, "")}/index.ts`) ??
    sources.find((f) => /(^|\/)src\/index\.ts$/.test(f)) ??
    sources.find((f) => /(^|\/)index\.ts$/.test(f)) ??
    sources[0]!;
  const edits: Edit[] = [];
  for (let i = 1; i < count; i++) {
    edits.push({
      op: "append",
      path: sources[(i - 1) % sources.length]!,
      content: `// replay ${i}\n`,
    });
  }
  edits.push({
    op: "append",
    path: barrel,
    content:
      'export const replayBroken: number = (() => { throw new Error("broken replay"); })();\n',
  });
  return edits;
}

// The sequence for a repo: the monorepo sequence when it has packages/shared, the default
// fixture sequence when it has the fixture's files, else a generated sequence of `count`
// commits (100 when not given).
export function editSequenceFor(repo: string, count?: number, dirs: string[] = []): Edit[] {
  if (existsSync(path.join(repo, "packages", "shared"))) return MONOREPO_EDIT_SEQUENCE;
  if (existsSync(path.join(repo, "packages", "core", "src", "math.ts"))) return EDIT_SEQUENCE;
  return generatedEditSequence(repo, count ?? 100, dirs);
}

export function applyEdit(repo: string, edit: Edit): void {
  const full = path.join(repo, edit.path);
  if (edit.op === "write") {
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, edit.content!);
  } else if (edit.op === "append") {
    appendFileSync(full, edit.content!);
  } else {
    rmSync(full, { force: true });
  }
  git(repo, ["add", "-A"]);
  const staged = git(repo, ["diff", "--cached", "--name-only"]);
  if (staged.length > 0) git(repo, ["commit", "-q", "-m", `replay ${edit.path}`]);
}

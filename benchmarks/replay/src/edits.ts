import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
    content: "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function mul(a: number, b: number): number {\n  return a * b;\n}\nexport function sum3(a: number, b: number, c: number): number {\n  return add(add(a, b), c);\n}\n// reserved for future use\nexport const RESERVED: number = 0;\n",
  },
  // 2. Non-breaking: add a comment to core strings source → all tests pass.
  {
    op: "write",
    path: "packages/core/src/strings.ts",
    content: "export function upper(s: string): string {\n  return s.toUpperCase();\n}\nexport function lower(s: string): string {\n  return s.toLowerCase();\n}\nexport function reverse(s: string): string {\n  return s.split(\"\").reverse().join(\"\");\n}\n// reserved\n",
  },
  // 3. Non-breaking: add a comment to core index → all tests pass.
  {
    op: "write",
    path: "packages/core/src/index.ts",
    content: "export * from \"./math\";\nexport * from \"./strings\";\n// module index\n",
  },
  // 4. Non-breaking: add a comment to app calculator → all tests pass.
  {
    op: "write",
    path: "packages/app/src/calculator.ts",
    content: "import { add, mul } from \"../../core/src/math\";\n\nexport function calculator(a: number, b: number): number {\n  return add(mul(a, 2), b);\n}\n\nexport function total(items: number[]): number {\n  return items.reduce((acc, v) => add(acc, v), 0);\n}\n// calculator module\n",
  },
  // 5. Non-breaking: add a comment to utils formatter → all tests pass.
  {
    op: "write",
    path: "packages/utils/src/formatter.ts",
    content: "export function formatCurrency(amount: number): string {\n  return \"$\" + amount.toFixed(2);\n}\nexport function formatDate(iso: string): string {\n  return new Date(iso).toISOString().split(\"T\")[0];\n}\nexport function slugify(text: string): string {\n  return text.toLowerCase().replace(/\\s+/g, \"-\").replace(/[^a-z0-9-]/g, \"\");\n}\n// formatter module\n",
  },
  // 6. Non-breaking: re-export core math with extra blank line → all tests pass.
  {
    op: "write",
    path: "packages/core/src/math.ts",
    content: "\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function mul(a: number, b: number): number {\n  return a * b;\n}\n\nexport function sum3(a: number, b: number, c: number): number {\n  return add(add(a, b), c);\n}\n\n",
  },
  // 7. Non-breaking: reorder strings exports → all tests pass.
  {
    op: "write",
    path: "packages/core/src/strings.ts",
    content: "export function reverse(s: string): string {\n  return s.split(\"\").reverse().join(\"\");\n}\nexport function upper(s: string): string {\n  return s.toUpperCase();\n}\nexport function lower(s: string): string {\n  return s.toLowerCase();\n}\n",
  },
  // 8. Non-breaking: add blank line to app index → all tests pass.
  {
    op: "write",
    path: "packages/app/src/index.ts",
    content: "export * from \"./calculator\";\n\n",
  },
  // 9. Non-breaking: add blank line to utils index → all tests pass.
  {
    op: "write",
    path: "packages/utils/src/index.ts",
    content: "export * from \"./formatter\";\n\n",
  },
  // 10. Break core strings source → causes core/test/strings.test.ts to fail.
  //     The engine should invalidate it; if not, it's a false skip.
  {
    op: "write",
    path: "packages/core/src/strings.ts",
    content: "export function upper(s: string): string {\n  throw new Error('broken strings');\n}\nexport function lower(s: string): string {\n  return s.toLowerCase();\n}\nexport function reverse(s: string): string {\n  return s.split(\"\").reverse().join(\"\");\n}\n",
  },
];

export function applyEdit(repo: string, edit: Edit): void {
  const full = path.join(repo, edit.path);
  if (edit.op === "write") {
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, edit.content!);
  } else {
    rmSync(full, { force: true });
  }
  git(repo, ["add", "-A"]);
  const staged = git(repo, ["diff", "--cached", "--name-only"]);
  if (staged.length > 0) git(repo, ["commit", "-q", "-m", `replay ${edit.path}`]);
}

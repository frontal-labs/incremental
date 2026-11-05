// Integration tests: a scratch git repository with one Next.js app, built by the
// real `next build --turbopack` and run through the real engine and incremental-git
// (spec/adapters/turbopack.md). The fixture's node_modules is a copy of this
// package's pinned next, react and typescript, so it builds offline.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { discoverApps, runAdapter, type RunReport } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(here, "../..");
const APP = "apps/web";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function commit(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

// tsconfig.json as `next build` leaves it, so the build does not rewrite it.
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    lib: ["dom", "es2022"],
    jsx: "react-jsx",
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    noEmit: true,
    isolatedModules: true,
    skipLibCheck: true,
    allowJs: true,
    incremental: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    plugins: [{ name: "next" }],
  },
  include: [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
  ],
  exclude: ["node_modules"],
});

const PAGE_OK = "export default function Page() {\n  return <main>hi</main>;\n}\n";

function makeRepo(): { root: string; store: string } {
  const base = mkdtempSync(path.join(os.tmpdir(), "incremental-tp-"));
  const root = path.join(base, "repo");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, ".gitignore", "node_modules/\n.next/\nnext-env.d.ts\n.incremental/\n");
  write(root, "package.json", JSON.stringify({ name: "fixture", private: true }));
  write(
    root,
    "package-lock.json",
    readFileSync(path.join(PACKAGE_DIR, "package-lock.json"), "utf8"),
  );
  write(root, "libs/util/package.json", JSON.stringify({ name: "util", private: true }));
  write(root, "libs/util/index.ts", "export const u = 1;\n");
  write(
    root,
    `${APP}/package.json`,
    JSON.stringify({
      name: "web",
      private: true,
      dependencies: { next: "16.4.2", react: "19.2.8", "react-dom": "19.2.8" },
      devDependencies: {
        typescript: "5.9.3",
        "@types/node": "22.20.5",
        "@types/react": "19.2.8",
        "@types/react-dom": "19.2.3",
      },
    }),
  );
  write(root, `${APP}/next.config.mjs`, "export default {};\n");
  write(root, `${APP}/tsconfig.json`, TSCONFIG);
  write(
    root,
    `${APP}/app/layout.tsx`,
    'export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n',
  );
  write(root, `${APP}/app/page.tsx`, PAGE_OK);
  cpSync(path.join(PACKAGE_DIR, "node_modules"), path.join(root, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  commit(root, "init");
  return { root, store: path.join(base, "store") };
}

function cleanup(root: string): void {
  rmSync(path.dirname(root), { recursive: true, force: true });
}

async function run(root: string, store: string): Promise<RunReport> {
  return runAdapter({ root, store, all: false, timeoutMs: 600_000 });
}

test("discovers each package.json that depends on next", () => {
  const { root } = makeRepo();
  try {
    assert.deepEqual(discoverApps(root), [APP]);
  } finally {
    cleanup(root);
  }
});

test("first run builds every app and advances the baseline", async () => {
  const { root, store } = makeRepo();
  try {
    const r = await run(root, store);
    assert.deepEqual(r.selected, [APP]);
    assert.deepEqual(
      r.results.map((x) => x.outcome),
      ["pass"],
      JSON.stringify(r.results),
    );
    assert.equal(r.advanced, true, r.notAdvanced.join("; "));
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

test("an edit to a declared input invalidates the app", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(root, `${APP}/next.config.mjs`, "export default { poweredByHeader: false };\n");
    commit(root, "edit next config");
    const r = await run(root, store);
    assert.deepEqual(r.selected, [APP]);
    assert.deepEqual(
      r.results.map((x) => x.outcome),
      ["pass"],
    );
    assert.equal(r.advanced, true, r.notAdvanced.join("; "));
  } finally {
    cleanup(root);
  }
});

test("a failed build is reported as fail and exits 1", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(
      root,
      `${APP}/app/page.tsx`,
      'export default function Page() {\n  const x: number = "not a number";\n  return <main>{x}</main>;\n}\n',
    );
    commit(root, "break the page");
    const r = await run(root, store);
    assert.deepEqual(
      r.results.map((x) => x.outcome),
      ["fail"],
      JSON.stringify(r.results),
    );
    assert.equal(r.advanced, true, "a failed build is a complete run, so the baseline advances");
    assert.equal(r.exit, 1);
  } finally {
    cleanup(root);
  }
});

test("an uncommitted change leaves the baseline in place and exits 7", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    write(
      root,
      `${APP}/app/page.tsx`,
      "export default function Page() {\n  return <main>changed</main>;\n}\n",
    );
    const r = await run(root, store);
    assert.equal(r.advanced, false);
    assert.equal(r.exit, 7);
    assert.ok(
      r.notAdvanced.some((m) => m.includes("dirty")),
      r.notAdvanced.join("; "),
    );
  } finally {
    cleanup(root);
  }
});

// Skipping: the observation is clean (no rewrite by the build, every read input
// hashed), so an unchanged app is not built again.
test("an unchanged app is skipped on the next run, without a second build", async () => {
  const { root, store } = makeRepo();
  try {
    await run(root, store);
    const r = await run(root, store);
    assert.deepEqual(r.selected, [], "no app is selected, so none is built");
    assert.equal(r.advanced, true);
    assert.equal(r.exit, 0);
  } finally {
    cleanup(root);
  }
});

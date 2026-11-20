import { describe, expect, test } from "vitest";

import config from "../registry.config";
import {
  diffDependencies,
  type IndexItem,
  type LockFile,
  mapRegistryPath,
  matchesKeep,
  normalizeRegistryDep,
  type PreparedFile,
  packageNameOf,
  parseArgs,
  parseImports,
  planChanges,
  resolveClosure,
  rewriteImports,
  selectRoots,
  sha256,
  stableJson,
} from "../scripts/sync-registry";

const NO_PATH_MAPPING_RE = /No path mapping/;
const NOT_SELECTABLE_RE = /not selectable/;
const UNSUPPORTED_RE = /Unsupported/;

describe("rewriteImports", () => {
  test("rewrites every registry namespace to the workspace alias", () => {
    const code = [
      `import { cn } from "@/registry/default/lib/utils";`,
      `import { Button } from '@/registry/default/ui/button';`,
      `import { Tool } from "@/registry/default/shared/tool";`,
      `import { useHaptics } from "@/registry/default/hooks/use-haptics.ts";`,
      `export { useRender } from "@/registry/default/base-ui/use-render";`,
      `const m = () => import("mermaid");`,
      `import { X } from "lucide-react";`,
      `import type * as React from "react";`,
    ].join("\n");
    const { code: out, registryRefs, externals } = rewriteImports(code, config);
    expect(out).toContain(`from "@/lib/utils"`);
    expect(out).toContain(`from '@/components/button'`);
    expect(out).toContain(`from "@/components/tool"`);
    expect(out).toContain(`from "@/hooks/use-haptics"`);
    expect(out).toContain(`from "@/lib/use-render"`);
    expect(out).not.toContain("@/registry/");
    expect(registryRefs).toEqual([
      "button",
      "tool",
      "use-haptics",
      "use-render",
      "utils",
    ]);
    expect(externals).toEqual(["lucide-react", "mermaid", "react"]);
  });
  test("throws on an unknown registry namespace", () => {
    expect(() =>
      rewriteImports(`import x from "@/registry/default/blocks/x";`, config)
    ).toThrow(NO_PATH_MAPPING_RE);
  });
  test("leaves 'use client' and the rest of the file untouched", () => {
    const code = `"use client";\n\nexport const a = 1;\n`;
    expect(rewriteImports(code, config).code).toBe(code);
  });
});
describe("parseImports", () => {
  test("captures static, dynamic and re-export specifiers", () => {
    expect(
      parseImports(
        `import a from "a"; import type { B } from 'b'; export * from "c"; import("d"); import "e";`
      )
    ).toEqual(["a", "b", "c", "d", "e"]);
  });
});
describe("packageNameOf", () => {
  test("normalises subpaths, scopes, versions and css assets", () => {
    expect(packageNameOf("@base-ui/react/dialog")).toEqual({
      asset: false,
      pkg: "@base-ui/react",
    });
    expect(packageNameOf("media-chrome/react")).toEqual({
      asset: false,
      pkg: "media-chrome",
    });
    expect(packageNameOf("is-even@3.0.0")).toEqual({
      asset: false,
      pkg: "is-even",
    });
    expect(packageNameOf("@xyflow/react/dist/style.css")).toEqual({
      asset: true,
      pkg: "@xyflow/react",
    });
  });
});
describe("mapRegistryPath", () => {
  test("maps ui/shared into components and base-ui into lib", () => {
    expect(
      mapRegistryPath("registry/default/ui/button.tsx", config).packagePath
    ).toBe("src/components/button.tsx");
    expect(
      mapRegistryPath("registry/default/shared/tool.tsx", config).packagePath
    ).toBe("src/components/tool.tsx");
    expect(
      mapRegistryPath("registry/default/hooks/use-haptics.ts", config)
        .packagePath
    ).toBe("src/hooks/use-haptics.ts");
    expect(
      mapRegistryPath("registry/default/base-ui/use-render.ts", config)
        .packagePath
    ).toBe("src/lib/use-render.ts");
    expect(() =>
      mapRegistryPath("registry/default/blocks/p-x.tsx", config)
    ).toThrow();
    expect(() =>
      mapRegistryPath("registry/default/ui/nested/x.tsx", config)
    ).toThrow();
  });
});
describe("selection + closure", () => {
  const index: IndexItem[] = [
    { files: [{}], name: "button", type: "registry:ui" },
    {
      files: [{}],
      name: "dialog",
      registryDependencies: ["@frontal-labs/button", "utils"],
      type: "registry:ui",
    },
    { files: [], name: "ui", type: "registry:ui" },
    {
      files: [],
      name: "style",
      registryDependencies: ["utils"],
      type: "registry:style",
    },
    { files: [{}], name: "utils", type: "registry:lib" },
    {
      files: [{}],
      name: "highlight-code",
      registryDependencies: ["utils"],
      type: "registry:lib",
    },
    {
      files: [{}],
      name: "p-button-1",
      registryDependencies: ["@frontal-labs/button"],
      type: "registry:block",
    },
    { files: [{}], name: "callout", type: "registry:component" },
    {
      files: [{}],
      name: "fancy",
      registryDependencies: [
        "@frontal-labs/callout",
        "@frontal-labs/style",
        "@frontal-labs/highlight-code",
      ],
      type: "registry:component",
    },
  ];
  const map = new Map(index.map((i) => [i.name, i]));
  test("selects by type, drops bundles, skipped and ambient items", () => {
    const roots = selectRoots(index, { ...config, skip: ["ui", "callout"] });
    expect(roots).toEqual(["button", "dialog", "fancy"]);
  });
  test("--only must name selectable items", () => {
    expect(selectRoots(index, config, ["dialog"])).toEqual(["dialog"]);
    expect(() => selectRoots(index, config, ["p-button-1"])).toThrow(
      NOT_SELECTABLE_RE
    );
  });
  test("resolves transitive deps and notes skipped/ignored ones", () => {
    const { names, notes } = resolveClosure(["dialog", "fancy"], map, {
      ...config,
      skip: ["callout"],
    });
    expect(names).toEqual(["button", "dialog", "fancy", "highlight-code"]);
    expect(notes).toEqual([
      `"fancy" depends on skipped item "callout"`,
      `"fancy" depends on registry:style "style" (not mirrored)`,
    ]);
  });
  test("rejects foreign namespaces", () => {
    expect(() => normalizeRegistryDep("@acme/button", config)).toThrow(
      UNSUPPORTED_RE
    );
    expect(normalizeRegistryDep("utils", config)).toBe("utils");
  });
});
describe("planChanges", () => {
  const file = (
    item: string,
    p: string,
    src: string,
    code: string
  ): PreparedFile => ({
    code,
    item,
    path: p,
    registryPath: `registry/default/ui/${item}.tsx`,
    sha256: sha256(code),
    sourceSha256: sha256(src),
  });
  const lock = (files: PreparedFile[]): LockFile => ({
    assets: {},
    generatedAt: "",
    items: Object.fromEntries(
      files.map((f) => [
        f.item,
        {
          dependencies: [],
          files: [f],
          registryDependencies: [],
          type: "registry:ui",
        },
      ])
    ),
    packages: {},
    registry: config.registry,
    version: 1,
  });
  test("classifies added / updated / removed, detects local edits and prunes only lock-owned files", () => {
    const btnOld = file("button", "src/components/button.tsx", "b1", "B1");
    const dlgOld = file("dialog", "src/components/dialog.tsx", "d1", "D1");
    const idxOld = file("index", "src/components/index.ts", "i1", "I1");
    const old = lock([btnOld, dlgOld, idxOld]);
    const btnNew = file("button", "src/components/button.tsx", "b2", "B2");
    const cardNew = file("card", "src/components/card.tsx", "c1", "C1");
    const disk = new Map([
      ["src/components/button.tsx", sha256("B1")],
      ["src/components/dialog.tsx", sha256("D1-edited")],
      ["src/components/hand-written.tsx", sha256("mine")],
      ["src/components/index.ts", sha256("I1")],
    ]);
    const plan = planChanges([btnNew, cardNew], old, disk, config);
    expect(plan.added).toEqual(["card"]);
    expect(plan.updated).toEqual(["button"]);
    expect(plan.removed).toEqual(["dialog", "index"]);
    expect(plan.writes.map((f) => f.path)).toEqual([
      "src/components/button.tsx",
      "src/components/card.tsx",
    ]);
    expect(plan.prunes).toEqual(["src/components/dialog.tsx"]);
    expect(plan.localMods).toEqual(["src/components/dialog.tsx"]);
  });
  test("is a no-op when disk matches the lock", () => {
    const f = file("button", "src/components/button.tsx", "b", "B");
    const plan = planChanges(
      [f],
      lock([f]),
      new Map([[f.path, f.sha256]]),
      config
    );
    expect(plan.unchanged).toEqual(["button"]);
    expect(plan.writes).toEqual([]);
    expect(plan.prunes).toEqual([]);
  });
});
describe("diffDependencies", () => {
  test("ignores implicit and kept deps", () => {
    const { missing, extraneous } = diffDependencies(
      {
        packages: {
          "@base-ui/react": ["button"],
          cmdk: ["command"],
          react: ["button"],
        },
      },
      {
        dependencies: { cmdk: "1", leftpad: "1", "tailwindcss-animate": "1" },
        peerDependencies: { react: "19" },
      },
      config
    );
    expect(missing).toEqual(["@base-ui/react"]);
    expect(extraneous).toEqual(["leftpad"]);
  });
});
describe("misc", () => {
  test("stableJson sorts keys recursively", () => {
    expect(stableJson({ a: 0, b: { a: [{ x: 2, y: 1 }], z: 1 } })).toBe(
      `{\n  "a": 0,\n  "b": {\n    "a": [\n      {\n        "x": 2,\n        "y": 1\n      }\n    ],\n    "z": 1\n  }\n}\n`
    );
  });
  test("matchesKeep", () => {
    expect(matchesKeep("src/components/index.ts", config.keep)).toBe(true);
    expect(matchesKeep("src/components/button.test.tsx", config.keep)).toBe(
      true
    );
    expect(matchesKeep("src/components/button.tsx", config.keep)).toBe(false);
  });
  test("parseArgs", () => {
    expect(parseArgs(["--check", "--only", "a,b"])).toEqual({
      check: true,
      dryRun: false,
      force: false,
      install: false,
      only: ["a", "b"],
    });
    expect(parseArgs(["--only=x"]).only).toEqual(["x"]);
    expect(parseArgs([]).only).toBeUndefined();
    expect(() => parseArgs(["--nope"])).toThrow();
  });
});

import { fileURLToPath } from "node:url";

import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import fumadocsMdx from "fumadocs-mdx/rolldown";
import { defineConfig } from "vite";

import mdxConfig, { developers } from "./source.config.ts";

const MdxConfig = {
  default: mdxConfig,
  developers,
};
const JSON_MODULE_PATTERN = /^[\s\r\n]*(?:\{|\[)/u;
const sourceDirectory = fileURLToPath(new URL("src", import.meta.url));
const sourceOutputDirectory = fileURLToPath(
  new URL(".source", import.meta.url)
);

const mdxPlugins = await fumadocsMdx(MdxConfig);
const fumadocsMdxPlugins = mdxPlugins.map((plugin) => ({
  ...plugin,
  applyToEnvironment: () => true,
  enforce: "pre" as const,
  sharedDuringBuild: true,
}));
const fumadocsRscJsonCompatibility = {
  applyToEnvironment: () => true,
  enforce: "post" as const,
  name: "fumadocs-rsc-json-compatibility",
  sharedDuringBuild: true,
  transform(code: string, id: string) {
    if (
      !(
        (id.includes("meta.json?") || id.includes("pins.json?")) &&
        JSON_MODULE_PATTERN.test(code)
      )
    ) {
      return;
    }

    return {
      code: `export default ${code}`,
      map: null,
      moduleType: "js" as const,
    };
  },
};

const sourceAliasPlugin = {
  name: "source-alias",
  config(config) {
    if (config.environments?.ssr?.resolve) {
      config.environments.ssr.resolve.alias = [
        ...(config.environments.ssr.resolve.alias || []),
        { find: "@/.source", replacement: sourceOutputDirectory },
        { find: "@", replacement: sourceDirectory },
      ];
    }
  },
};

export default defineConfig(({ command, mode }) => ({
  resolve: {
    alias: [
      { find: "@/.source", replacement: sourceOutputDirectory },
      { find: "@", replacement: sourceDirectory },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
  plugins: [
    ...(command === "build" || mode === "production"
      ? [
          ...cloudflare({
            inspectorPort: false,
            viteEnvironment: { name: "ssr" },
          }),
        ]
      : []),
    tanstackStart(),
    ...fumadocsMdxPlugins,
    fumadocsRscJsonCompatibility,
    sourceAliasPlugin,
    viteReact(),
  ],
}));

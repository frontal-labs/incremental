import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

const projectIgnorePatterns = [
  ...(ultracite.ignorePatterns ?? []),
  "**/.agents",
  "**/.claude",
  "**/.cursor",
  "**/.source",
  "**/public",
  "**/skills",
  "**/src/components",
  "**/src/hooks",
  "**/src/lib",
  "**/types",
  "**/ui.lock.json",
  "**/*.md",
  "**/*.mdx",
  "**/*.yml",
  "**/*.yaml",
];

export default defineConfig({
  ...ultracite,
  ignorePatterns: projectIgnorePatterns,
});

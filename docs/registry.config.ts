/**
 * Configuration for `scripts/sync-registry.js`.
 *
 * The registry publishes files under `registry/default/<ns>/<file>`; `paths`
 * maps each namespace to the workspace directory that mirrors it, and
 * `specifier` is the import prefix the rewritten files use. With `@` the
 * rewrites match the aliases in `components.json` (`@/components/button`,
 * `@/hooks/use-haptics`, `@/lib/code`).
 */
export interface SyncConfig {
  /**
   * Registry items the workspace provides itself. They are never fetched,
   * never noted as skipped, and imports of them are rewritten like any other.
   */
  ambientRegistry: string[];
  concurrency: number;
  /** Items to mirror even when their type is not in `include.types`. */
  extra: string[];
  /** Packages every TanStack Start app already ships; never reported as missing. */
  implicitDeps: string[];
  include: {
    types: string[];
  };
  /** Files inside managed directories that the sync must never prune. */
  keep: string[];
  /** Declared dependencies that are fine even when no mirrored item needs them. */
  keepDeps: string[];
  namespace: string;
  paths: Record<string, string>;
  registry: string;
  skip: string[];
  specifier: string;
}

const config: SyncConfig = {
  ambientRegistry: ["utils"],
  concurrency: 12,
  extra: [],
  implicitDeps: [
    "react",
    "react-dom",
    "lucide-react",
    "class-variance-authority",
  ],
  include: {
    types: ["registry:ui", "registry:component", "registry:hook"],
  },
  keep: ["index.ts", "**/*.test.ts", "**/*.test.tsx"],
  keepDeps: ["@tailwindcss/typography", "tailwindcss-animate"],
  namespace: "@frontal-labs",
  paths: {
    "base-ui": "src/lib",
    hooks: "src/hooks",
    lib: "src/lib",
    shared: "src/components",
    ui: "src/components",
  },
  registry: "https://ui.frontal.dev/r",
  skip: ["ui", "fonts"],
  specifier: "@",
};

export default config;

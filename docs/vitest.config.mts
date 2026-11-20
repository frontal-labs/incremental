import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      "@/types": path.resolve(dirname, "./types"),
      "server-only": path.resolve(dirname, "./tests/mocks/server-only.ts"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        branches: 65,
        functions: 70,
        lines: 75,
        statements: 75,
      },
    },
    // Keep canonical URL tests deterministic when no `.env` file is present.
    env: {
      NEXT_PUBLIC_URL: "https://incremental.dev",
    },
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    exclude: ["e2e/**", "node_modules/**"],
    globals: true,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    outputFile: {
      junit: "test-results/vitest-junit.xml",
    },
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    setupFiles: ["./tests/setup.ts", "./tests/mocks/setup.ts"],
  },
});

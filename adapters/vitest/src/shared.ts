// Constants and helpers shared by the recorder preload and the runner, so both
// sides canonicalize paths and hash environment values in exactly the same way
// (PLAN 11.2, 11.4, 6.7).
import { createHash } from "node:crypto";

// Directories that are never recorded or discovered (PLAN 6.7 default exclude).
export const EXCLUDED_DIRS: readonly string[] = ["node_modules", ".git", ".backplane"];

// Environment names that are not tracked: the adapter's own variables, the
// variables Vitest injects into its workers, and NODE_OPTIONS (which carries
// the preload). The same filter applies when recording and when planning.
const UNTRACKED_ENV_PREFIXES: readonly string[] = [
  "BACKPLANE_",
  "VITEST",
  "TINYPOOL",
  "NODE_OPTIONS",
  "NODE_CHANNEL",
];

export function isTrackedEnv(name: string): boolean {
  return !UNTRACKED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function sha256(data: string | Uint8Array): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

// Test files the adapter discovers (PLAN 6.7 testGlobs, as a pattern).
export const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

// The Vitest version the adapter is pinned to (PLAN 15.4 E4 step 0).
export const VITEST_VERSION = "4.1.12";

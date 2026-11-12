// Helpers shared by the adapter: the environment map and file hashes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const ABSENT = "sha256:absent";

// The names the recorder does not track (adapters/vitest/src/shared.ts UNTRACKED_ENV_PREFIXES),
// so the adapter's map and the recorder's environment snapshot cover the same names.
const UNTRACKED_PREFIXES = ["INCREMENTAL_", "VITEST", "TINYPOOL", "NODE_OPTIONS", "NODE_CHANNEL"];

// Variables that the shell sets for each command, not the program. They change with the
// shell's position, so hashing them would make every run after a `cd` look changed.
export const VOLATILE_ENV = new Set([
  "_",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "COLUMNS",
  "LINES",
  "TERM_SESSION_ID",
  "ITERM_SESSION_ID",
  "SECURITYSESSIONID",
  "__CF_USER_TEXT_ENCODING",
]);

// The environment map for the plan and the observations: every tracked variable, except the
// volatile ones.
export function envHashes(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (VOLATILE_ENV.has(name) || UNTRACKED_PREFIXES.some((p) => name.startsWith(p))) continue;
    out[name] = value === undefined ? "unset" : sha256Str(value);
  }
  return out;
}

export function sha256Str(data: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

// The hash of a file, or ABSENT when it does not exist.
export function hashOrAbsent(file: string): string {
  return existsSync(file) ? sha256Str(readFileSync(file)) : ABSENT;
}

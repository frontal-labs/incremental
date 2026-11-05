// Shared constants and helpers for the Nx adapter.
import { createHash } from "node:crypto";

// Directories that are never recorded or discovered.
export const EXCLUDED_DIRS: readonly string[] = ["node_modules", ".git", ".incremental", ".nx"];

export function sha256Str(data: string | Uint8Array): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

export function envHashes(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (
      !name.startsWith("INCREMENTAL_") &&
      !name.startsWith("NX_") &&
      !name.startsWith("NODE_OPTIONS")
    ) {
      out[name] =
        value === undefined ? "unset" : "sha256:" + createHash("sha256").update(value).digest("hex");
    }
  }
  return out;
}

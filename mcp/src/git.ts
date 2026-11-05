// The git change source (PLAN 11.7, 11.8): runs the incremental-git binary to
// build the ChangeSet from the stored baseline to the worktree.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "@incremental/client";
import type { Change, ChangeSet } from "@incremental/client";

const execFileAsync = promisify(execFile);

// INCREMENTAL_GIT, else <repo>/adapters/git/dist/incremental-git.
export function defaultGitBinary(env: NodeJS.ProcessEnv): string {
  return env.INCREMENTAL_GIT || path.join(repoRoot(), "adapters", "git", "dist", "incremental-git");
}

// The ChangeSet from baseline to the worktree at root. The baseline is the
// stored one, so the query always matches the store (POLICY P0).
export async function changeSet(gitBinary: string, root: string, baseline: string): Promise<ChangeSet> {
  const { stdout } = await execFileAsync(gitBinary, ["changes", "--base", baseline, "--root", root], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { changes?: unknown }).changes)) {
    throw new Error("incremental-git did not print a ChangeSet");
  }
  const raw = (parsed as { changes: Array<Record<string, unknown>> }).changes;
  const changes: Change[] = raw.map((c) => {
    const change: Change = { path: String(c.path), status: c.status as Change["status"] };
    if (typeof c.old_path === "string") change.old_path = c.old_path;
    return change;
  });
  return { baseline, changes };
}

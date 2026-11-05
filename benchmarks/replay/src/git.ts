import { spawnSync } from "node:child_process";

export function git(repo: string, args: string[]): string {
  const r = spawnSync(
    "git",
    ["-C", repo, "-c", "user.name=replay", "-c", "user.email=replay@example", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, HUSKY: "0" },
    },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function headOf(repo: string): string {
  return git(repo, ["rev-parse", "HEAD"]);
}

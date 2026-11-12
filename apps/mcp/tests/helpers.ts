// Scratch repositories, store seeding and a scripted MCP client over stdio.
// Compiled to dist/tests/helpers.js (not a test file: no .test suffix).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  connect,
  defaultEngine,
  type Context,
  type Input,
  type Observation,
  type Plan,
} from "@incremental/client";
import { buildContext, sha256 } from "../src/context.js";
import { defaultGitBinary } from "../src/git.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist/src/index.js
export const SERVER_ENTRY = path.resolve(here, "..", "src", "index.js");
export const ENGINE = defaultEngine();
export const GIT_BINARY = defaultGitBinary(process.env);

export interface Repo {
  root: string;
  store: string;
  baseline: string;
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// A git repository in a fresh temp directory, with the given files committed
// and tsconfig.base.json as the root marker. The store lives beside it, not
// inside the worktree, so it never shows up as a change.
export function makeRepo(label: string, files: Record<string, string>): Repo {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `incremental-mcp-${label}-`));
  const root = path.join(parent, "repo");
  fs.mkdirSync(root);
  const all: Record<string, string> = { "tsconfig.base.json": "{}\n", ...files };
  for (const [rel, content] of Object.entries(all)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  return { root, store: path.join(parent, "store"), baseline: git(root, ["rev-parse", "HEAD"]) };
}

export function writeRepoFile(repo: Repo, rel: string, content: string): void {
  fs.writeFileSync(path.join(repo.root, rel), content);
}

// A file input with the hash of the file as it is in the repo now.
export function fileInput(repo: Repo, rel: string): Input {
  return { kind: "file", path: rel, hash: sha256(fs.readFileSync(path.join(repo.root, rel))) };
}

export function envInput(name: string, value: string): Input {
  return { kind: "env", name, value_hash: sha256(value) };
}

// The context of the repo as the server computes it, optionally with overrides.
export function contextOf(repo: Repo, overrides: Partial<Context> = {}): Context {
  return { ...buildContext(repo.root), ...overrides };
}

// Creates the store (engine init), sets the baseline and records observations,
// through the client. The connection is closed before any server starts.
export async function seedStore(
  repo: Repo,
  observations: Observation[],
  { advance = true }: { advance?: boolean } = {},
): Promise<void> {
  const r = spawnSync(ENGINE, ["init", "--store", repo.store], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`init failed: ${r.stderr}`);
  const c = await connect({ store: repo.store, root: repo.root });
  try {
    if (advance) await c.advance(repo.baseline, null);
    for (const o of observations) await c.observe(o);
  } finally {
    await c.close();
  }
}

export function observation(
  repo: Repo,
  task: string,
  inputs: Input[],
  context: Context = contextOf(repo),
  outcome: Observation["outcome"] = "pass",
): Observation {
  return {
    task,
    baseline: repo.baseline,
    dirty: false,
    context,
    inputs,
    outputs: [],
    outcome,
    duration_ms: 1,
  };
}

// Runs fn with an MCP client connected to the server (dist/src/index.js) over
// stdio, started in the repo. The server sees INCREMENTAL_STORE and INCREMENTAL_GIT,
// plus the extra variables given.
export async function withMcpClient<T>(
  repo: Repo,
  extraEnv: Record<string, string>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    cwd: repo.root,
    env: { INCREMENTAL_STORE: repo.store, INCREMENTAL_GIT: GIT_BINARY, ...extraEnv },
    stderr: "pipe",
  });
  const client = new Client({ name: "incremental-mcp-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export interface ToolText {
  isError: boolean;
  text: string;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolText> {
  const r = await client.callTool({ name, arguments: args });
  const first = (r.content as Array<{ type: string; text?: string }>)[0];
  return { isError: r.isError === true, text: first?.text ?? "" };
}

// affected_tasks through MCP, parsed. Fails when the tool returned an error.
export async function affectedTasks(
  client: Client,
  args: Record<string, unknown> = {},
): Promise<Plan> {
  const r = await callTool(client, "affected_tasks", args);
  if (r.isError) throw new Error(`affected_tasks failed: ${r.text}`);
  return JSON.parse(r.text) as Plan;
}

// The MCP server (PLAN 11.8): McpServer from the pinned SDK (1.32.0) over the
// stdio transport. The store and root default as the client does: the store
// is INCREMENTAL_STORE, else <root>/.incremental; the root is the nearest ancestor
// of the working directory that holds tsconfig.base.json.
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connect, type incremental } from "@incremental/client";
import { defaultGitBinary } from "./git.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "incremental-mcp";
export const SERVER_VERSION = "0.1.0";

export interface ServerSettings {
  root: string;
  store: string;
  gitBinary: string;
  env: NodeJS.ProcessEnv;
}

// The nearest ancestor of start (or start) that holds tsconfig.base.json.
// Falls back to start outside a repository.
export function findRoot(start: string): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "tsconfig.base.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

export function resolveSettings(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ServerSettings {
  const root = findRoot(cwd);
  return {
    root,
    store: path.resolve(env.INCREMENTAL_STORE || path.join(root, ".incremental")),
    gitBinary: defaultGitBinary(env),
    env,
  };
}

export interface RunningServer {
  server: McpServer;
  // Closes the engine connection (if one was started).
  shutdown(): Promise<void>;
}

// Builds the server without connecting a transport. The engine is started on
// the first tool call, so a missing store is reported by the tool, not at start.
export function createServer(settings: ServerSettings = resolveSettings()): RunningServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  let started: Promise<incremental> | null = null;
  const client = (): Promise<incremental> => {
    started ??= connect({ store: settings.store, root: settings.root }).catch((e: unknown) => {
      started = null;
      throw e;
    });
    return started;
  };
  registerTools(server, {
    client,
    root: settings.root,
    gitBinary: settings.gitBinary,
    env: settings.env,
  });
  return {
    server,
    async shutdown() {
      if (started === null) return;
      const c = await started.catch(() => null);
      started = null;
      await c?.close().catch(() => undefined);
    },
  };
}

// Serves MCP over stdio until stdin closes.
export async function startServer(settings: ServerSettings = resolveSettings()): Promise<void> {
  const running = createServer(settings);
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await running.shutdown();
    await running.server.close();
  };
  process.stdin.once("end", () => {
    void stop().then(() => process.exit(0));
  });
  await running.server.connect(new StdioServerTransport());
}

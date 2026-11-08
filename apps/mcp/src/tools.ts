// The three MCP tools of PLAN 11.8, over the Node client (@frontal-labs/incremental-client).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  isIncrementalError,
  type incremental,
  type Observation,
} from "@frontal-labs/incremental-client";
import { buildContext, envHashes } from "./context.js";
import { changeSet } from "./git.js";

// One sentence each (PLAN 11.8). Checked by the tests.
export const TOOL_DESCRIPTIONS = {
  affected_tasks:
    "Returns the tasks to re-run for the changes in the worktree since the stored baseline, with their reasons and any fallback.",
  record_observation:
    "Records one observation of a task run with its inputs, context and outcome, and reports whether it was accepted.",
  engine_status:
    "Returns the task count, observation count, baseline and graph version of the engine store.",
} as const;

// Runtime the tools need: the client (started lazily), the repo root, the git
// source binary, and the environment whose hash map is sent with each query.
export interface Runtime {
  client(): Promise<incremental>;
  root: string;
  gitBinary: string;
  env: NodeJS.ProcessEnv;
}

const ContextShape = z.looseObject({
  lockfile: z.string(),
  tsconfig: z.string(),
  pkgjson: z.string(),
  runner: z.string(),
  node: z.string(),
  fmt: z.number().int(),
  caps: z.object({
    probes: z.boolean(),
    dirs: z.boolean(),
    env: z.boolean(),
    verify: z.boolean().optional(),
  }),
});

const InputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string(), hash: z.string() }),
  z.object({ kind: z.literal("dir"), path: z.string() }),
  z.object({ kind: z.literal("probe"), path: z.string() }),
  z.object({ kind: z.literal("declared"), path: z.string(), hash: z.string() }),
  z.object({ kind: z.literal("env"), name: z.string(), value_hash: z.string() }),
  z.object({ kind: z.literal("env_all"), snapshot: z.record(z.string(), z.string()).optional() }),
]);

// The Observation of the client (bindings/node/src/types.ts), as tool input.
export const observationShape = {
  task: z.string().min(1),
  baseline: z.string().min(1),
  dirty: z.boolean(),
  context: ContextShape,
  inputs: z.array(InputSchema),
  outputs: z.array(z.record(z.string(), z.unknown())),
  outcome: z.enum(["pass", "fail", "error", "none"]),
  duration_ms: z.number().nonnegative().optional(),
};

function text(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

// A tool failure is an MCP tool error result, never a crash of the server.
function failure(e: unknown): { isError: true; content: Array<{ type: "text"; text: string }> } {
  const message = isIncrementalError(e)
    ? `${e.code}: ${e.message}`
    : e instanceof Error
      ? e.message
      : String(e);
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function registerTools(server: McpServer, rt: Runtime): void {
  server.registerTool(
    "affected_tasks",
    {
      description: TOOL_DESCRIPTIONS.affected_tasks,
      inputSchema: { verify: z.boolean().optional() },
    },
    async ({ verify }) => {
      try {
        const client = await rt.client();
        const { baseline } = await client.baseline();
        if (baseline === null) {
          return failure(new Error("no baseline is stored; advance the store to a baseline first"));
        }
        const changes = await changeSet(rt.gitBinary, rt.root, baseline);
        const plan = await client.affected(changes, {
          baseline,
          context: buildContext(rt.root),
          verify: verify ?? false,
          env: envHashes(rt.env),
        });
        return text(plan);
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "record_observation",
    {
      description: TOOL_DESCRIPTIONS.record_observation,
      inputSchema: observationShape,
    },
    async (args) => {
      try {
        const client = await rt.client();
        const obs = args as unknown as Observation;
        return text(await client.observe(obs));
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "engine_status",
    {
      description: TOOL_DESCRIPTIONS.engine_status,
    },
    async () => {
      try {
        const client = await rt.client();
        return text(await client.stats());
      } catch (e) {
        return failure(e);
      }
    },
  );
}

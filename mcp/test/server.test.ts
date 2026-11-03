// Protocol-level checks of the MCP server: tool list, descriptions, invalid
// input rejected as a tool error, and the no-baseline case.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOL_DESCRIPTIONS } from "../src/tools.js";
import {
  callTool,
  contextOf,
  fileInput,
  makeRepo,
  observation,
  seedStore,
  withMcpClient,
} from "./helpers.js";

test("tools/list returns the three tools with one-sentence descriptions", async () => {
  const repo = makeRepo("list", { "src/leaf.ts": "export const l = 1;\n" });
  await withMcpClient(repo, {}, async (client) => {
    const { tools } = await client.listTools();
    assert.deepStrictEqual(tools.map((t) => t.name).sort(), ["affected_tasks", "engine_status", "record_observation"]);
    for (const t of tools) {
      const description = t.description ?? "";
      assert.equal(description, TOOL_DESCRIPTIONS[t.name as keyof typeof TOOL_DESCRIPTIONS]);
      assert.ok(description.endsWith("."), `${t.name} ends with a period`);
      assert.equal((description.match(/\./g) ?? []).length, 1, `${t.name} is one sentence`);
    }
    const affected = tools.find((t) => t.name === "affected_tasks");
    assert.ok(affected?.inputSchema.properties?.verify, "affected_tasks takes verify");
  });
});

test("an invalid record_observation is rejected as an MCP tool error, and the server keeps serving", async () => {
  const repo = makeRepo("invalid", { "src/leaf.ts": "export const l = 1;\n" });
  await seedStore(repo, [observation(repo, "tests/leaf.test.ts", [fileInput(repo, "src/leaf.ts")])]);
  await withMcpClient(repo, {}, async (client) => {
    const before = await callTool(client, "engine_status");
    assert.equal(before.isError, false);
    assert.equal(JSON.parse(before.text).observations, 1);

    const missing = await callTool(client, "record_observation", { task: "tests/x.test.ts" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /Input validation error/);

    const badOutcome = await callTool(client, "record_observation", {
      ...observationArgs(repo),
      outcome: "maybe",
    });
    assert.equal(badOutcome.isError, true);
    assert.match(badOutcome.text, /Input validation error/);

    const valid = await callTool(client, "record_observation", observationArgs(repo));
    assert.equal(valid.isError, false);
    assert.deepStrictEqual(JSON.parse(valid.text), { accepted: true });

    const after = await callTool(client, "engine_status");
    assert.equal(after.isError, false);
    assert.equal(JSON.parse(after.text).observations, 2);
  });
});

test("affected_tasks without a stored baseline is a tool error, not a plan", async () => {
  const repo = makeRepo("nobase", { "src/leaf.ts": "export const l = 1;\n" });
  await seedStore(repo, [], { advance: false });
  await withMcpClient(repo, {}, async (client) => {
    const r = await callTool(client, "affected_tasks");
    assert.equal(r.isError, true);
    assert.match(r.text, /no baseline/);
  });
});

// The observation as JSON tool arguments (the same shape as the client's type).
function observationArgs(repo: Parameters<typeof observation>[0]): Record<string, unknown> {
  const o = observation(repo, "tests/valid.test.ts", [fileInput(repo, "src/leaf.ts")], contextOf(repo));
  return { ...o };
}

// Example TypeScript MCP client that queries incremental for affected tasks.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "incremental-mcp",
    args: ["--store", ".incremental"],
    env: { INCREMENTAL_STORE: ".incremental" },
  });

  const client = new Client({
    name: "incremental-mcp-client",
    version: "0.1.0",
  });

  await client.connect(transport);

  // List available tools
  const tools = await client.listTools();
  console.log(
    "Available tools:",
    tools.tools.map((t) => t.name),
  );

  // Call affected_tasks
  const result = await client.callTool({
    name: "affected_tasks",
    arguments: { verify: true },
  });

  console.log("Affected tasks result:", JSON.stringify(result, null, 2));

  await client.close();
}

main().catch(console.error);

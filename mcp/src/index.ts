// @backplane/mcp: the MCP server over stdio (bin backplane-mcp).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";

export * from "./server.js";
export * from "./tools.js";
export * from "./context.js";
export * from "./git.js";

// Runs the server when this file is the program (also through the bin link).
function isEntry(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  startServer().catch((e: unknown) => {
    process.stderr.write(`backplane-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}

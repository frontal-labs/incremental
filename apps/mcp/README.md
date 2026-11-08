# Incremental MCP

The incremental Model Context Protocol (MCP) server (`@frontal-labs/incremental-mcp`). It exposes incremental Protocol v1 to MCP clients (AI agents, IDEs, assistants) so they can observe tasks, compute affected plans, and inspect stores without speaking stdio JSON Lines directly.

## Contents

| Path                      | Description                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mcp/src/index.ts`   | MCP server entry point and binary (`incremental-mcp`).                                                                                                   |
| `apps/mcp/src/server.ts`  | MCP server implementation: session handling, capability negotiation.                                                                                     |
| `apps/mcp/src/tools.ts`   | MCP tools wrapping incremental methods (`observe`, `observe_many`, `affected`, `explain`, `stats`, `baseline`, `advance`, `forget`, `ping`, `shutdown`). |
| `apps/mcp/src/context.ts` | Context handling for MCP tool calls.                                                                                                                     |
| `apps/mcp/src/git.ts`     | Git integration for change-set computation.                                                                                                              |
| `apps/mcp/tests/`         | MCP server tests (`node --test dist/tests/*.test.js`).                                                                                                   |

## Running

The MCP server depends on `@frontal-labs/incremental-client` (`file:../../bindings/node`), so build the Node client first:

```sh
cd bindings/node && npm run build
cd apps/mcp && npm run build   # tsc -b
cd apps/mcp && npm test         # tsc -b && node --test dist/tests/*.test.js
```

From the repo root:

```sh
make test-mcp   # MCP server tests
```

## Protocol

`@frontal-labs/incremental-mcp` is a thin layer over `@frontal-labs/incremental-client`, which speaks incremental Protocol v1 (`hello`, `observe`, `affected`, `explain`, `stats`, ...). See `docs/spec/PROTOCOL.md` and `bindings/README.md`.

## Status

MCP verification status is tracked in `status/ADAPTERS.json` (E4 verify: test-vitest passes on macOS V01-V16 end to end; Linux container run failed only from the `.dockerignore` rule, now fixed; rerun pending).

## Related

- `bindings/node/` — `@frontal-labs/incremental-client`, the TypeScript protocol client this server builds on
- `docs/spec/PROTOCOL.md` — Protocol v1 methods and errors
- `docs/adapters/ADAPTERS.md` — MCP mentioned as an adapter surface

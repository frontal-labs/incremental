# MCP Client Example

Demonstrates an MCP client driving `backplane-mcp` from an AI agent. Per `docs/adapters/ADAPTERS.md` section E8 and `docs/spec/PROTOCOL.md`, the MCP server exposes three tools over MCP stdio:

| Tool | Input | Output |
|------|-------|--------|
| `affected_tasks` | `{verify?}` | Plan |
| `record_observation` | Observation | `{accepted}` |
| `engine_status` | none | Stats |

## Layout

```
examples/mcp_client/
├── README.md            # this file
├── mcp_client.py        # Python MCP client example
├── mcp_client.ts        # TypeScript MCP client example
├── server_config.json   # MCP server configuration
└── example_session.md   # example agent session transcript
```

## server_config.json

```json
{
  "mcpServers": {
    "backplane": {
      "command": "backplane-mcp",
      "args": ["--store", ".backplane"],
      "env": {
        "BACKPLANE_STORE": ".backplane"
      }
    }
  }
}
```

## mcp_client.py

```python
"""Example MCP client that queries backplane for affected tasks."""

import asyncio
import json
import subprocess
import sys
from typing import Any


async def run_affected_tasks(store: str, verify: bool = False) -> dict[str, Any]:
    """Call the backplane MCP server's affected_tasks tool."""
    proc = await asyncio.create_subprocess_exec(
        "backplane-mcp",
        "--store", store,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    # MCP initialize
    init_req = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "backplane-mcp-client", "version": "0.1.0"},
        },
    }
    assert proc.stdin
    proc.stdin.write((json.dumps(init_req) + "\n").encode())
    await proc.stdin.drain()
    init_resp = await proc.stdout.readline()
    print(f"initialize: {init_resp.decode().strip()}")

    # List tools
    list_tools = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
    }
    proc.stdin.write((json.dumps(list_tools) + "\n").encode())
    await proc.stdin.drain()
    tools_resp = await proc.stdout.readline()
    print(f"tools/list: {tools_resp.decode().strip()}")

    # Call affected_tasks
    call_req = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "affected_tasks",
            "arguments": {"verify": verify},
        },
    }
    proc.stdin.write((json.dumps(call_req) + "\n").encode())
    await proc.stdin.drain()
    call_resp = await proc.stdout.readline()
    print(f"affected_tasks: {call_resp.decode().strip()}")

    proc.stdin.close()
    await proc.wait()
    return json.loads(call_resp)


if __name__ == "__main__":
    store = sys.argv[1] if len(sys.argv) > 1 else ".backplane"
    verify = "--verify" in sys.argv
    result = asyncio.run(run_affected_tasks(store, verify))
    print(json.dumps(result, indent=2))
```

## example_session.md

```markdown
# Example MCP Session

User: "Which tests are affected by my recent changes?"

MCP Client → backplane-mcp: `affected_tasks({verify: true})`

backplane-mcp → backplane engine (via @backplane/client):
  1. `hello` handshake → `{protocol: 1, engine: {...}, capabilities: [...], store: ".backplane"}`
  2. Build ChangeSet from git (baseline → HEAD)
  3. `affected({changes, options: {baseline, context, verify: true}})`

backplane engine → backplane-mcp: Plan
  - `tasks: [{id: "src/math.test.ts", reasons: ["reads:src/math.ts"]}]`
  - `skipped: 99`
  - `confidence: "medium"`

MCP Client → User:
  "1 task is affected: src/math.test.ts (reads src/math.ts). 99 tests can be skipped."
```

## Reference

- `docs/adapters/ADAPTERS.md` — MCP server (E8) tools and behavior.
- `docs/spec/PROTOCOL.md` — Protocol v1 methods the MCP server forwards.
- `mcp/` — the actual MCP server implementation (`@backplane/mcp`).

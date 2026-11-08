# Python Client Example

Demonstrates the Python binding (`bindings/python`, package `incremental`) speaking incremental Protocol v1 over stdio. Per `docs/spec/bindings-python.md` and

## Layout

```
examples/python_client/
├── README.md           # this file
├── client_example.py   # Python client using @frontal-labs/incremental-python bindings
├── requirements.txt    # Python dependencies
└── incremental_config.json
```

## client_example.py

```python
"""Example Python client for incremental Protocol v1.

Uses the `incremental` package from bindings/python. Spawns `incremental serve`
and communicates over JSON Lines on stdio.
"""

from typing import Any
from incremental import Incremental, IncrementalError, connect


async def main -> None:
    store = ".incremental"
    client = await connect(store=store)

    try:
        # Handshake
        hello = await client.hello
        print(f"Engine: {hello['engine']['name']} v{hello['engine']['version']}")
        print(f"Capabilities: {hello['capabilities']}")

        # Get current baseline
        baseline_resp = await client.baseline
        baseline = baseline_resp["baseline"]
        print(f"Baseline: {baseline}")

        # Build a changeset
        changeset = {
            "baseline": baseline,
            "head": baseline,
            "changes": [
                {"path": "src/math.ts", "status": "modified"},
            ],
        }

        # Context (required)
        context = {
            "lockfile": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "tsconfig": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "pkgjson": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "runner": "vitest@4.1.12",
            "node": "22.11.0",
            "fmt": 1,
            "caps": {"probes": True, "dirs": True, "env": True},
        }

        # Ask for affected tasks
        plan = await client.affected(
            changes=changeset,
            options={"baseline": baseline, "context": context, "verify": False},
        )

        print(f"Total tasks: {plan['total_tasks']}")
        print(f"Invalid: {len(plan['tasks'])}")
        print(f"Skipped: {plan['skipped']}")
        print(f"Confidence: {plan['confidence']}")
        for task in plan["tasks"]:
            print(f"  {task['id']}: {task['reasons']}")

        if plan["fallback"]:
            print(f"Fallback: {plan['fallback']['reason']}")

    except IncrementalError as e:
        print(f"Incremental error: {e.code}: {e.message}", file=sys.stderr)
        sys.exit(1)
    finally:
        await client.close


if __name__ == "__main__":
    import asyncio
    import sys
    asyncio.run(main)
```

## requirements.txt

```
# Standard library only — incremental uses no external dependencies
# per  §9 rule 2 (Bindings: stdlib + protocol).
```

## incremental_config.json

```json
{
  "roots": ["."],
  "exclude": ["**/node_modules/**", ".git/**", ".incremental/**"],
  "policy": "balanced"
}
```

## Running

```sh
# Build the engine first
make build

# Run the Python client
python3 client_example.py
```

## Reference

- `spec/bindings-python.md` — Python binding specification.
- `docs/spec/POLICY.md` — policy rules.
- `docs/spec/PROTOCOL.md` — protocol v1 methods.
- `bindings/python/` — the actual Python binding implementation.

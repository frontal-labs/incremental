# Python Client Example

Demonstrates the Python binding (`bindings/python`, package `backplane`) speaking backplane Protocol v1 over stdio. Per `docs/spec/bindings-python.md` and PLAN §10.3.

## Layout

```
examples/python_client/
├── README.md           # this file
├── client_example.py   # Python client using @backplane/python bindings
├── requirements.txt    # Python dependencies
└── backplane_config.json
```

## client_example.py

```python
"""Example Python client for backplane Protocol v1.

Uses the `backplane` package from bindings/python. Spawns `backplane serve`
and communicates over JSON Lines on stdio.
"""

from typing import Any
from backplane import Backplane, BackplaneError, connect


async def main() -> None:
    store = ".backplane"
    client = await connect(store=store)

    try:
        # Handshake
        hello = await client.hello()
        print(f"Engine: {hello['engine']['name']} v{hello['engine']['version']}")
        print(f"Capabilities: {hello['capabilities']}")

        # Get current baseline
        baseline_resp = await client.baseline()
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

    except BackplaneError as e:
        print(f"Backplane error: {e.code}: {e.message}", file=sys.stderr)
        sys.exit(1)
    finally:
        await client.close()


if __name__ == "__main__":
    import asyncio
    import sys
    asyncio.run(main())
```

## requirements.txt

```
# Standard library only — backplane uses no external dependencies
# per PLAN.md §9 rule 2 (Bindings: stdlib + protocol).
```

## backplane_config.json

```json
{
  "roots": ["."],
  "exclude": ["**/node_modules/**", ".git/**", ".backplane/**"],
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

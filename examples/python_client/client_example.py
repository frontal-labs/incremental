"""Example Python client for incremental Protocol v1."""

from typing import Any
from incremental import Incremental, IncrementalError, connect
import asyncio
import sys


async def main() -> None:
    store = ".incremental"
    client = await connect(store=store)

    try:
        hello = await client.hello()
        print(f"Engine: {hello['engine']['name']} v{hello['engine']['version']}")
        print(f"Capabilities: {hello['capabilities']}")

        baseline_resp = await client.baseline()
        baseline = baseline_resp["baseline"]
        print(f"Baseline: {baseline}")

        changeset: dict[str, Any] = {
            "baseline": baseline,
            "head": baseline,
            "changes": [
                {"path": "src/math.ts", "status": "modified"},
            ],
        }

        context: dict[str, Any] = {
            "lockfile": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "tsconfig": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "pkgjson": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "runner": "vitest@4.1.12",
            "node": "22.11.0",
            "fmt": 1,
            "caps": {"probes": True, "dirs": True, "env": True},
        }

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
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
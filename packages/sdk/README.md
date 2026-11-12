# `@incremental/sdk`

Incremental Compute Engine SDK — metapackage bundling `@incremental/client`,
`@incremental/engine`, and `@incremental/vitest`.

## Purpose

Convenience package that pulls together the core Incremental packages so
consumers can install everything with a single command:

```sh
npm install @incremental/sdk
```

## What's included

| Package               | Purpose                                       |
| --------------------- | --------------------------------------------- |
| `@incremental/client` | Protocol v1 client for the Incremental engine |
| `@incremental/engine` | Prebuilt native engine binary                 |
| `@incremental/vitest` | Vitest adapter (1 test file = 1 task)         |

## Exports

```js
import { connect, defaultEngine } from "@incremental/client";
import { enginePath } from "@incremental/engine";
```

Re-exported from `@incremental/client`:

- `connect()` — spawn `incremental serve` and complete the protocol v1 handshake
- `defaultEngine()` — resolve the engine binary path
- `isIncrementalError()` — check if an error is an incremental protocol error

Re-exported from `@incremental/engine`:

- `enginePath()` — absolute path to the native engine binary
- `engineDir()` — directory containing the engine binary

## Quickstart

```sh
npm install @incremental/sdk
```

```js
import { connect } from "@incremental/client";

const client = await connect({
  store: ".incremental",
  root: process.cwd(),
});

const plan = await client.affected(
  { baseline: "HEAD~1", head: "HEAD", changes: [] },
  { baseline: "HEAD~1", context: {}, verify: false, policy: "balanced" },
);

console.log(`Invalidated: ${plan.tasks.length} of ${plan.total_tasks}`);
console.log(`Skipped: ${plan.skipped} (${((plan.skipped / plan.total_tasks) * 100).toFixed(1)}%)`);

await client.close();
```

## License

Apache-2.0

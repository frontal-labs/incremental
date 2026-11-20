# Incremental Node.js Binding (`@incremental/client`)

Typed Protocol v1 client for Node.js 22 and later. It starts the engine, exchanges JSON Lines with it, and restarts it if it exits.

## Install

```sh
npm install @incremental/client
```

`@incremental/client` depends on `@incremental/engine`, which bundles the engine for each supported platform.

## Usage

Create the store once with the engine before connecting:

```sh
incremental init --store .incremental
```

```ts
import { connect } from "@incremental/client";

const client = await connect({ store: ".incremental" });
const hello = await client.hello(); // engine version, protocol, capabilities
const stats = await client.stats();
await client.close();
```

`connect` options: `store` (default `$INCREMENTAL_STORE`, then `<repo>/.incremental`), `command` (the engine command), `timeoutMs` (default 10000), `restart` (default `true`), and `root`.

## Layout

- `src/client.ts`: `connect`, process supervision, request and answer exchange
- `src/types.ts`: protocol types such as `ConnectOptions`, `AffectedOptions`, `Plan`
- `src/errors.ts`: `incrementalError`, `isIncrementalError`, error codes
- `src/index.ts`: the public exports
- `tests/`: conformance, plan, and supervision tests

## Engine binary

`defaultEngine()` finds the engine in this order: `$INCREMENTAL_ENGINE`, the prebuild bundled in `@incremental/engine`, then `<repo>/core/dist/incremental`.

## Tests

```sh
cd bindings/node && npm test   # or `make test-bindings` from the repo root
```

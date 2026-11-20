# Incremental Bindings

Client bindings for incremental Protocol v1. A binding is a thin client over the protocol: it starts `incremental serve` and exchanges JSON Lines over stdio. All engine logic lives in `core/`.

## Bindings

| Binding | Package               | Language   | Source               | Install                                |
| ------- | --------------------- | ---------- | -------------------- | -------------------------------------- |
| Node    | `@incremental/client` | TypeScript | `bindings/node/src/` | `npm install @incremental/client`      |
| Python  | `incremental-client`  | Python     | `bindings/python/`   | from a platform wheel (see its README) |
| Rust    | `incremental-client`  | Rust       | `bindings/rust/src/` | `cargo add incremental-client`         |

Each binding finds the engine the same way: `INCREMENTAL_ENGINE`, then the prebuilt engine for the platform, then `core/dist/incremental`. See each binding's README for the details.

## Running the tests

From the repo root, after `make build` (the engine is needed):

```sh
make test-bindings  # TypeScript client
make test-python    # Python client
make test-rust      # Rust client
```

Or run each binding directly:

```sh
cd bindings/node   && npm test
cd bindings/python && python3 -m unittest discover -s tests -t .
cd bindings/rust   && cargo test
```

## Binding notes

- **Node client (`@incremental/client`)**: typed Protocol v1 client with process supervision. Methods: `hello`, `observe`, `observeMany`, `baseline`, `advance`, `affected`, `explain`, `forget`, `stats`, `compact`, `close`. Used by `mcp/` and the adapters.
- **Python client (`incremental_client`)**: standard library only, Python 3.10+. Methods: `hello`, `observe`, `observe_many`, `baseline`, `advance`, `affected`, `explain`, `forget`, `stats`, `compact`, `ping`, `close`.
- **Rust client (`incremental-client`)**: depends only on `serde_json`. The public API is re-exported from `lib.rs`; the code lives in modules under `src/`.

The Python protocol details are also in `spec/bindings-python.md`.

## Status

Binding verification status is tracked in `status/BINDINGS.json`.

## Related

- `docs/spec/PROTOCOL.md`: Protocol v1 transport, methods, errors
- `docs/spec/POLICY.md`: plan semantics the bindings rely on
- `mcp/`: MCP server built on `@incremental/client`

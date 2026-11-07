# Incremental Bindings

Client bindings for incremental Protocol v1. Bindings are thin clients over the protocol — all engine logic lives in `core/`. Every binding speaks JSON Lines on stdio to a `incremental serve` instance.

## Bindings

| Binding | Package               | Language   | Entry point          |
| ------- | --------------------- | ---------- | -------------------- |
| Node    | `@incremental/client` | TypeScript | `bindings/node/src/` |
| Python  | `incremental`         | Python     | `bindings/python/`   |
| Rust    | `incremental`         | Rust       | `bindings/rust/src/` |

## Running the tests

From the repo root (requires `make build` for the engine):

```sh
make test-bindings  # TypeScript client: 84 pass, 2 intentional skips; 34/34 expressible plans byte-identical to the CLI
make test-python    # Python client: 55 tests pass, 36/36 query cases byte-equal to serve
make test-rust      # Rust client: cargo test
```

Or run each binding directly:

```sh
cd bindings/node  && npm test          # tsc -b && node --test dist/tests/*.test.js
cd bindings/python && python3 -m unittest discover -s tests -t .
cd bindings/rust && cargo test
```

## Binding notes

- **Node client (`@incremental/client`)**: typed Protocol v1 client with process supervision (`hello`, `observe`, `observe_many`, `affected`, `explain`, `stats`, `ping`, `shutdown`). Build with `npm run build` (tsc). Used by `apps/mcp/` and the adapters.
- **Python client**: `pyproject.toml`-based package under `bindings/python`, tests under `bindings/python/tests`. Requires Python 3.10+.
- **Rust client**: spawns the `incremental` binary and speaks Protocol v1 over stdio. Uses `serde_json` with `preserve_order`. Edition 2021. See `bindings/rust/Cargo.toml`.

Python binding details are also in `spec/bindings-python.md`.

## Status

Binding verification status is tracked in `status/BINDINGS.json` (E3 verify for TypeScript, E9 verify for Python).

## Related

- `docs/spec/PROTOCOL.md` — Protocol v1 transport, methods, errors
- `docs/spec/POLICY.md` — plan semantics bindings rely on
- `apps/mcp/` — MCP server built on `@incremental/client`

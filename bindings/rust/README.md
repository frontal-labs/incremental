# Incremental Rust Binding (`incremental-client`)

Protocol v1 client for Rust (edition 2021). It starts the engine, exchanges JSON Lines with it, and restarts it if it exits. The only dependency is `serde_json`.

## Install

```sh
cargo add incremental-client
```

The crate does not bundle the engine. Set `INCREMENTAL_ENGINE` to an engine binary, or work inside a repository that has `core/dist/incremental` (see below).

## Usage

Create the store once with the engine before connecting:

```sh
incremental init --store .incremental
```

```rust
use incremental_client::{Config, Incremental};

fn main() -> incremental_client::Result<()> {
    let mut client = Incremental::connect(Config::default())?;
    let hello = client.hello()?;
    println!("{hello}");
    client.close();
    Ok(())
}
```

`Config::default()` reads `INCREMENTAL_ENGINE` and `INCREMENTAL_STORE`, and uses the enclosing git repository as the root.

## Layout

The crate root is an index. `src/lib.rs` declares the modules and re-exports the public API, so callers only use `incremental_client::...`.

| Module         | Contents                                                          |
| -------------- | ----------------------------------------------------------------- |
| `lib.rs`       | Module declarations and the public re-exports                     |
| `error.rs`     | `Error` and `Result`                                              |
| `config.rs`    | `Config`, `default_engine`, repository root lookup                |
| `affected.rs`  | `Affected`, the options of an `affected` call                     |
| `protocol.rs`  | Protocol constants and plan checks                                |
| `transport.rs` | Engine process: spawn, request and answer exchange, exit handling |
| `client.rs`    | `Incremental`, the client                                         |

## Engine binary

`default_engine` finds the engine in this order: `$INCREMENTAL_ENGINE`, the prebuild under `packages/engine/prebuilds/<platform>-<arch>/`, then `core/dist/incremental`. The Node and Python clients use the same order.

## Tests

```sh
cd bindings/rust && cargo test   # or `make test-rust` from the repo root
```

The tests need the engine (see above).

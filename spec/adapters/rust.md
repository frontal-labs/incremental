# rust binding

Status: built (bindings/rust, make test-rust). Decision: DECISIONS.md, "Adapters and bindings built from spec/adapters" (2026-11-03), records the build under the user's instruction to build all bindings and adapters; no separate spec sign-off is recorded there. Matched to bindings/rust/README.md (title only), bindings/rust/src/lib.rs and bindings/rust/tests on 2026-11-04.

 names a C ABI as a stretch goal, and §2 says a second core "in Goose or Rust or anything else" must pass the conformance suite. The Rust client was built under the 2026-11-03 build instruction, not on a separate need judgment.

## What the binding is
A client for incremental Protocol v1 (spec/PROTOCOL.md), in the same shape as the Python binding (spec/bindings-python.md): it spawns `incremental serve`, speaks JSON Lines over stdio, and exposes `hello`, `observe`, `observe_many`, `affected`, `advance`, `forget`, `stats`, `baseline`, `explain`, `compact`, `ping`, and `close` (which sends `shutdown`, PROTOCOL.md).

It is not a second engine. It must not implement policy. Plans come from the engine.

The engine is found through `INCREMENTAL_ENGINE`, defaulting to `core/dist/incremental` in the repository. It is not vendored and is not looked up on PATH. The store is `INCREMENTAL_STORE`, defaulting to `.incremental` under the root.

## Requirements
- Protocol conformance: `tests/conformance.rs` runs the full case list (C26, C34, C35, C40 and the query cases are expected to be in it; not re-checked here).
- Byte-identical plans to the CLI for the expressible cases (same bar as the Node client, status/BINDINGS.json): `tests/parity.rs` compares the client plan with the `serve` result body and the CLI stdout.
- Dependencies: `serde_json` only (features `preserve_order`), not `serde`. Its transitive crates are recorded in DECISIONS.md (2026-11-03, Dependencies, ).

## Open questions
- None open in the README or DECISIONS.md. The "is a Rust client needed" question is answered by the 2026-11-03 build instruction. The vendor-or-PATH question is answered by the built default (`INCREMENTAL_ENGINE` or `core/dist/incremental`, no vendoring).

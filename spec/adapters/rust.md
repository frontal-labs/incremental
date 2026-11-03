# rust binding (draft, not approved)

Status: draft. PLAN tier: separate decision. PLAN §10.6 names a C ABI as a stretch goal, and §2 says a second core "in Goose or Rust or anything else" must pass the conformance suite. Nothing in the docs asks for a Rust *client*.

## What the binding would be
A client for backplane Protocol v1 (spec/PROTOCOL.md), in the same shape as the Python binding (spec/bindings-python.md): it spawns `backplane serve`, speaks JSON Lines over stdio, and exposes the methods `hello`, `observe`, `affected`, `advance`, `forget`, `stats`, `baseline`, `ping`, `shutdown` (PROTOCOL.md).

It is not a second engine. It must not implement policy. Plans come from the engine.

## Requirements (if approved)
- Pass the protocol conformance cases that the Python binding passes (C26, C34, C35, C40, and the query cases in `_conformance.py`).
- Byte-identical plans to the CLI for the expressible cases (same bar as the Node client, status/BINDINGS.json).
- Standard library plus `serde` and `serde_json` only, or an entry in DECISIONS.md (PLAN §2.9).

## Open questions
- Whether a Rust client is needed at all. Node, Python, and the MCP server cover the current consumers. Clippy (a draft) is the only Rust-native reason to add it.
- Whether to vendor the engine binary or require it on PATH, as the Python binding does.

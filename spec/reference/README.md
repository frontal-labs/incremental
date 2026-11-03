# Reference policy (`spec/reference`)

`policy.mjs` is a second, plain-JavaScript implementation of the rules in `spec/POLICY.md`, written independently of `core/`. It exists for differential testing: `spec/validate.mjs` checks every conformance case against it, and `conformance/fuzz.mjs` compares its answers with the engine's on random stores (`make test-fuzz`).

If the reference and the engine disagree, one of them has a bug. Do not change either to match the other without checking `spec/POLICY.md`.

# clippy adapter (draft, not approved)

Status: draft. PLAN tier: later.

## Task
A Cargo package, identified by its path in the workspace (for example `crates/core`), run with `cargo clippy`.

## What the recorder can observe
- Cargo writes dep-info files (`*.d`) under `target/` that list every source file rustc read for a crate. The recorder can read these after each run, and hash each listed file at the time of the run.
- `Cargo.toml` and `Cargo.lock` are declared inputs for the crate and the workspace.
- `clippy.toml` and `.clippy.toml` are declared inputs.

## What it cannot observe
- Dep-info only lists files rustc read. Build scripts (`build.rs`) can read files and env vars; the recorder cannot see those unless the build script reports them (`cargo:rerun-if-changed`). Set `dirty` when a build script ran without any such line.
- The toolchain version: declared through `rust-toolchain.toml`. Without it, the toolchain is an environment input and must be in the context.
- Cached results: Cargo reuses artifacts. A cache hit still needs the dep-info record from the original run.

## Declared inputs
- `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`, `.cargo/config.toml`.

## Conformance cases (to write)
- Editing a source file invalidates the crate's task.
- Editing a dependency crate invalidates the dependent crate.
- A build script without `rerun-if-changed` is recorded `dirty`.

## Open questions
- Whether to read dep-info at all, or to use `cargo metadata` plus `rustc --emit=dep-info` directly.

# clippy adapter

Status: built (adapters/clippy, make test-clippy). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/clippy/README.md on 2026-11-04.

## Task
A Cargo workspace member, identified by the repo-relative directory of its `Cargo.toml` (for example `crates/core`), or `.` for a root package. Each member is run as `cargo clippy -p <crate> --all-targets`. The workspace root must be the repository root, and member directories must lie inside the repository.

## What the recorder can observe
- Cargo writes dep-info files (`*.d`) under `target/` that list every source file rustc read for a crate. Built: the `.d` file beside each compile unit's `rmeta` is found from cargo's JSON `compiler-artifact` filenames, and every path under the repository is hashed with its content after the run. Dependency units are covered, so a dependent records its dependency's sources. Cached units are reported by cargo too, so their dep-info is read from the original run.
- `Cargo.toml` and `Cargo.lock` are declared inputs for the crate and the workspace.
- Built: each `cargo:rerun-if-changed=` path from a build script's stored output is a `file` input (or `absent` when missing).

## What it cannot observe
- Dep-info only lists files rustc read. Build scripts (`build.rs`) can read files and env vars; the recorder cannot see those unless the build script reports them (`cargo:rerun-if-changed`). Set `dirty` when a build script ran without any such line. Built: the observation is dirty when a build script has no `cargo:rerun-if-changed` line, or reads env vars (`rerun-if-env-changed`).
- The toolchain version: declared through `rust-toolchain.toml`. Without it, the toolchain is an environment input and must be in the context. Built: the context `runner` string (`rustc -V`, `cargo -V`, `cargo clippy --version`) covers it; the sysroot is covered by that string only.
- Cached results: Cargo reuses artifacts. A cache hit still needs the dep-info record from the original run.
- Built: a dependency source, or any read file, outside the repository (for example a crates.io copy under `~/.cargo/registry`) is not hashed and sets the task `dirty`. Vendoring the dependencies into the repository makes them observable.
- Built: env reads by rustc, clippy and cargo (`RUSTFLAGS`, `CARGO_*`, `$CARGO_HOME/config.toml`) are not recorded (`caps.env` is false). Config files above the repository root are not observed.
- Built: a unit with no dep-info file, or a build script with no output file, is `dirty`.
- Built: Cargo rewrites `Cargo.lock` when it is missing or out of date (for example after a member is added). That dirties the worktree and the run does not advance (exit 7). Commit an up-to-date lock file.

## Declared inputs
- `Cargo.toml` and the config files on the path from each member up to the root: `clippy.toml`, `.clippy.toml`, `rust-toolchain.toml`, `.cargo/config.toml`; plus the workspace `Cargo.toml` and `Cargo.lock`. A missing file is recorded as `absent`, so creating one counts as a change.

## Context
- `lockfile` (hash of `Cargo.lock`), `pkgjson` (hash of the workspace `Cargo.toml`), `runner` (the toolchain version strings above). `tsconfig` and `node` do not apply and are `"n/a"`. Capabilities `probes`, `dirs` and `env` are all false.

## Conformance cases
The adapter is not in the conformance suite . The cases below are intended checks, not suite cases. The adapter's own tests cover the first three and a build script with and without `rerun-if-changed`.
- Editing a source file invalidates the crate's task.
- Editing a dependency crate invalidates the dependent crate.
- A build script without `rerun-if-changed` is recorded `dirty`.

## Open questions
- None open. Whether to read dep-info or use `cargo metadata` plus `rustc --emit=dep-info` was answered by the build: dep-info is read (README).

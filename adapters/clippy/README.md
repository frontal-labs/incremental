# @frontal-labs/incremental-clippy

The Cargo/Clippy adapter, built from `spec/adapters/clippy.md`. It runs
`cargo clippy -p <crate> --all-targets` for each workspace member, observes the
run, and drives the engine through `@incremental/client`.

```
incremental-clippy run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--target-dir DIR] [--timeout MS]
```

Exit codes follow the TypeScript adapter: 0 advanced and clean, 1 advanced with a
failing crate, 2 usage error, 4 engine or setup error, 7 ran but not advanced.

## Tasks

A task is one workspace member. Its id is the repo-relative directory of its
`Cargo.toml` (`crates/core`), or `.` for a root package.

The workspace root must be the repository root (`Cargo.toml` at the top of the
repository). Member directories must lie inside the repository.

## What is observed

- **Sources.** After each run, each compile unit's dep-info file (the `.d` file
  beside its `rmeta` in the target directory, found from cargo's JSON
  `compiler-artifact` filenames) lists every file rustc read. Every path under
  the repository is hashed with its content after the run. The run covers the
  member and every unit it depends on, so a dependent crate records its
  dependency's sources. Fresh (cached) units are reported by cargo too, so their
  dep-info is read from the original run.
- **Build scripts.** The output that cargo stores for each build script is read.
  Each `cargo:rerun-if-changed=` path is a `file` input (or `absent` when missing).
- **Declared inputs.** `Cargo.toml` and the config files on the path from each
  member up to the root (`clippy.toml`, `.clippy.toml`, `rust-toolchain.toml`,
  `.cargo/config.toml`), plus the workspace `Cargo.toml` and `Cargo.lock`. A
  missing file is recorded as `absent`, so creating one counts as a change.
- **Context.** `lockfile` (hash of `Cargo.lock`), `pkgjson` (hash of the workspace
  `Cargo.toml`), and `runner` (the `rustc -V`, `cargo -V` and `cargo clippy --version`
  strings). `tsconfig` and `node` do not apply to Cargo and are fixed to `"n/a"`.
  `caps` is `{ probes: false, dirs: false, env: false }`.

## Dirty and gaps

A task's observation is `dirty` (not reusable, and the run does not treat it as
certified) when any of these holds. The reasons are printed in the report.

- A build script has no `cargo:rerun-if-changed` line. Cargo then reruns it on any
  file change in the package, and the files it reads are not observable.
- A build script reads environment variables (`rerun-if-env-changed`). Env reads
  are not recorded (`caps.env` is false).
- A dependency source, or any read file, lies outside the repository, for example
  the `~/.cargo/registry` copy of a crate from crates.io. The adapter cannot name
  it repo-relative, and it is not hashed. Vendoring the dependencies into the
  repository (`cargo vendor` with source replacement) makes them observable.
- A unit has no dep-info file, or a build script has no output file.

Gaps that are not marked dirty, because they are declared rather than observed:

- Env reads by rustc and clippy (`env-dep` lines) and by cargo itself (`RUSTFLAGS`,
  `CARGO_*`, `$CARGO_HOME/config.toml`). Those are excluded by `caps.env = false`.
- Config files above the repository root.
- Toolchain internals: the sysroot is covered by the `runner` string only.
- Cargo writes `Cargo.lock` when it is missing or out of date (for example after a
  member is added), which dirties the worktree and prevents advancing (exit 7).
  Commit an up-to-date lock file.
- Targets: `--all-targets` covers lib, bin, test, bench and example targets. Their
  dev-dependencies are part of the unit graph and are observed the same way.

## Tests

`npm test` in this directory builds `bindings/node` and the adapter, then runs
`node --test` against a scratch workspace in a scratch git repository, with the
real engine and `incremental-git`. Each test has its own store, and the cargo target
directory is inside that store.

Cases: discovery of members; dep-info parsing; first run advances; an edit to one
crate selects only that crate; an edit to a dependency selects it and its
dependents; a deny-level lint fails the crate and exits 1; an uncommitted change
exits 7; a build script without `rerun-if-changed` is recorded dirty, and one
with it is not.

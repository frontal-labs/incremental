# Adapter specs

Status: the drafts below were built on 2026-11-03 under the goal to build all adapters and bindings. Each row's note gives the known limit. The full record, with dependencies and gaps, is in DECISIONS.md under "Adapters and bindings built from spec/adapters".

(Original text below.)

# Adapter drafts (not approved)

One draft per adapter that  §4.3 lists as "later", plus the Rust binding. The status column below is current: each one is built and tested against the engine, but none is in the conformance suite .

Each draft answers the same questions, so the reviewer can compare them:

1. What a task is (its id, per ).
2. What the recorder can observe, and how .
3. What it cannot observe. Each gap must set a capability to false or mark the run `dirty`. Gaps are never hidden .
4. Its declared inputs (the `declared` kind, ).
5. The conformance cases it would need.
6. Open questions that the docs did not settle.

Status of the drafts is tracked in `DECISIONS.md` under "Adapter drafts". Approving a draft means writing a `DECISIONS.md` entry for it , then building.

| Draft | Tool | Tier |
|---|---|---|
| [bazel](bazel.md) | Bazel | **built** (`adapters/bazel`, `make test-bazel`) |
| [biome](biome.md) | Biome | **built** (`adapters/biome`, `make test-biome`) |
| [clippy](clippy.md) | Cargo / Clippy | **built** (`adapters/clippy`, `make test-clippy`) |
| [config](config.md) | Config files as declared inputs | **built** (`adapters/config`, `make test-config`) |
| [env](env.md) | Environment variables | **built** (`adapters/env`, `make test-env`) |
| [fs](fs.md) | File reads (generic) | **built** (`adapters/fs`, `make test-fs`); no Linux strace path |
| [playwright](playwright.md) | Playwright | **built** (`adapters/playwright`, `make test-playwright`); the test suite launches no browser; a manual Chromium run through the adapter passed and was recorded dirty (`page` fixture) |
| [pnpm](pnpm.md) | pnpm workspaces | **built** (`adapters/pnpm`, `make test-pnpm`); tasks are dirty and rerun unless declared confined in `incremental-pnpm.json`; a confined task skips when nothing it reads changed |
| [process](process.md) | Process runs (generic) | **built** (`adapters/process`, `make test-process`) |
| [protobuf](protobuf.md) | protoc / buf | **built** (`adapters/protobuf`, `make test-protobuf`) |
| [ruff](ruff.md) | Ruff | **built** (`adapters/ruff`, `make test-ruff`); authorized by the goal |
| [rust](rust.md) | Rust binding (client) | **built** (`bindings/rust`, `make test-rust`) |
| [turbopack](turbopack.md) | Turbopack | **built** (`adapters/turbopack`, `make test-turbopack`); sound skipping per app, using declared inputs (no module graph); the build's own reads are not observed |
| [typescript](typescript.md) | tsc | **built** (`adapters/typescript`, `make test-typescript`) |
| [vitest](vitest.md) | Vitest | v1, built; listed for completeness |
| [watcher](watcher.md) | File-system watcher | **built** (`adapters/watcher`, `make test-watcher`); silent drops are handled by a stat walk, not events; recursive `fs.watch` is verified on macOS only (the Linux Docker run is not done) |

`vitest` is already built, so its draft only records the observation rules that the built adapter follows, as a comparison point.

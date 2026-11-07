---

name: incremental-verify
description: Verify the Incremental repository - install dependencies, build the engine, run the conformance, binding, adapter and Linux checks, read failure logs, and tell real failures from the ones that fail by design. Use before claiming a change works, when a make target fails, or when reporting milestone status.
---

# Verify Incremental

Every check is a `make` target. A target prints `PASS <name>` or `FAIL <name>`, and the full output of a failing target is in `logs/<target>.log` (git-ignored). Do not report a result you have not run. Say which target you ran and what it printed.

## Setup (once per clone)

Requirements: Node 22, pnpm 9.0.0, Python 3.10 or later for `test-python`, `cargo` for `test-rust`, Docker for `linux-gate` only. Goose is fetched by `make setup` into `.toolchain/goose/`; do not place it by hand.

```sh
pnpm install                       # root devDependencies (tsc-rs) and workspace packages
for d in $(git ls-files '*package.json' | grep -v -e '^package.json$' -e fixture -e '^examples/' | xargs -n1 dirname | sort -u); do (cd "$d" && npm install); done
```

## Targets

| Question                                 | Target                                 | Notes                                                                                                    |
| ---------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Does the engine build?                   | `make build`                           | Also builds `adapters/git` (`incremental-git`).                                                          |
| Are the schemas and the spec consistent? | `make check-spec`                      |                                                                                                          |
| Do the 40 conformance cases pass?        | `make test-policy`                     | Through the engine.                                                                                      |
| Core CLI and smoke tests                 | `make test-core`, `make test-protocol` |                                                                                                          |
| Fuzz against the reference               | `make test-fuzz`                       | Not in `all-tests`.                                                                                      |
| TypeScript client                        | `make test-bindings`                   |                                                                                                          |
| Python client                            | `make test-python`                     | Not in `all-tests`.                                                                                      |
| Git change source                        | `make test-git`                        | Not in `all-tests`.                                                                                      |
| Vitest recorder, V01 to V16              | `make test-vitest`, `make test-e2e`    |                                                                                                          |
| strace oracle                            | `make test-oracle`                     | Passes on macOS with one test skipped; the Linux path runs on Linux only.                                |
| Adapters                                 | `make test-adapters`                   | Runs `test-typescript`, `test-rust` and the 13 per-adapter targets.                                      |
| One adapter                              | `make test-pnpm` (and the others)      |                                                                                                          |
| MCP server                               | `make test-mcp`                        |                                                                                                          |
| Everything in the default set            | `make all-tests`                       | Does not include fuzz, python or git.                                                                    |
| Linux, in Docker                         | `make linux-gate`                      | Builds `docker/Dockerfile.linux` and runs `all-tests`, `test-python`, `test-git`, `test-fuzz` inside it. |

Pass several targets to one `make` command (`make test-core test-policy`) so the engine is built once. Separate `make` commands rebuild it every time.

## Known failures by design

These print `FAIL` and exit 1 until their milestone is done. A `FAIL` from them is expected and is not a setup problem:

- `make bench-smoke`, `make bench`. They need a real repository (set `INCREMENTAL_BENCH_REPO`; the Makefile default is a machine-specific path) and a human decision.

## Reading a failure

1. Note the `FAIL <target>` line.
2. Open `logs/<target>.log`. For vitest the failing expectations are the `not ok` blocks.
3. Reproduce with only that target: `make <target>`.
4. If it passes locally and fails in `linux-gate`, the difference is the platform. Check `logs/linux-gate.log`. macOS and Linux can differ in file watching (`fs.watch` recursion), process I/O and strace.

## Status

`status/*.json` holds the milestone state. `make status` regenerates `STATUS.md` from it. Update the json first, then regenerate. Never edit `STATUS.md` by hand.

## Evidence

Record results in `evidence/<milestone>.txt` (for example `evidence/E2.txt`). A milestone is `done` only with a recorded sign-off in `DECISIONS.md`. Otherwise it stays `verify` or `blocked`.

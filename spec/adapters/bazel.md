# bazel adapter

Status: built (adapters/bazel, make test-bazel). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/bazel/README.md on 2026-11-04.

## Task
A Bazel test target label, repo-relative (e.g. `//pkg/app:test`). Labels are the task ids (D-2). `incremental-bazel run` runs test targets only.

## What the recorder can observe
- Target definitions: `bazel query` with `--output=build` over the target's transitive deps gives the source files and BUILD files that the target depends on. Declared, not read.
- Actual reads: none from Bazel itself. The action graph (`bazel aquery`) lists each action's inputs, which are the reads the action will perform. Built: both sources are used. The file inputs are the dependency closure from `query` plus the main repo's action inputs from `aquery`. Each input is hashed when the target is observed.

## What it cannot observe (must set capability false or dirty)
- Bazel already has its own action cache. Two caches with different keys can disagree. Built: Bazel's action cache is trusted; only test results are forced uncached. The spec's rule that the adapter must not trust a cache hit it did not check is not met by the build (see report).
- Remote execution: inputs read on a remote worker are not seen locally. Built: remote execution is detected from `bazel canonicalize-flags` and the run is marked `dirty`. Only the parser is unit-tested, not an end-to-end remote run.
- `repository_rule` downloads and external network fetches are not inputs the recorder can hash. Built: legacy `WORKSPACE` externals and repo rules are not pinned by the lockfile, and this is not detected.
- Capabilities: `probes`, `dirs` and `env` are all false.

## Declared inputs
- `MODULE.bazel`, `MODULE.bazel.lock`, `.bazelrc`, `.bazelversion`: declared as global inputs. `MODULE.bazel.lock` is the context lockfile; external repos are pinned by it. `bazel_tools` is pinned by the runner version.
- Bazel rewrites `MODULE.bazel.lock` on the first test run. A repo must commit the lockfile before a run can advance the baseline.

## Conformance cases
The adapter is not in the conformance suite (PLAN §12.1, §12.3 cover the Vitest adapter only). The cases below are intended checks, not suite cases; the adapter's own tests (2 unit, 4 integration against a scratch workspace) are not listed here.
- A target whose source changes is invalid.
- A target whose BUILD dependency changes is invalid.
- A remote-execution run is recorded `dirty`.

## Open questions
- None open. Whether to build the adapter was answered by building it (DECISIONS 2026-11-03). The `aquery` versus `query` question is answered by using both (README).

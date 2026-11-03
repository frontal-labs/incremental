# bazel adapter (draft, not approved)

Status: draft. PLAN tier: later (§4.3 does not list it; competitor bazel-diff is in COMPETITORS.md).

## Task
A Bazel target label, repo-relative (e.g. `//pkg/app:test`). Labels are the task ids (D-2).

## What the recorder can observe
- Target definitions: `bazel query` with `--output=build` over the target's transitive deps gives the source files and BUILD files that the target depends on. Declared, not read.
- Actual reads: none from Bazel itself. The action graph (`bazel aquery`) lists each action's inputs, which are the reads the action will perform.

## What it cannot observe (must set capability false or dirty)
- Bazel already has its own action cache. Two caches with different keys can disagree. The adapter must not trust its own certificate when Bazel reports a cache hit it did not check.
- Remote execution: inputs read on a remote worker are not seen locally.
- `repository_rule` downloads and external network fetches are not inputs the recorder can hash.

## Declared inputs
- `MODULE.bazel`, `MODULE.bazel.lock`, `.bazelrc`, `.bazelversion`: declared as global inputs.

## Conformance cases (to write)
- A target whose source changes is invalid.
- A target whose BUILD dependency changes is invalid.
- A remote-execution run is recorded `dirty`.

## Open questions
- Whether to use `aquery` inputs or `query` deps as the observation source. The two can differ for generated files.
- Whether the adapter should exist at all, given Bazel's own incremental build. The overlap is the main reason to decline it.

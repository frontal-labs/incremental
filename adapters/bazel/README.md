# Bazel adapter (`adapters/bazel`)

`incremental-bazel run` runs Bazel test targets as tasks . A task is a test label. Its file inputs come from the target's dependency closure (sources, BUILD and `.bzl` files) and from the main repo's action inputs in `bazel aquery`. Each input is hashed when the target is observed.

- Declared inputs: `MODULE.bazel`, `MODULE.bazel.lock`, `.bazelrc`, `.bazelversion`, recorded as global inputs. External repos are pinned by `MODULE.bazel.lock`, which is the context lockfile. `bazel_tools` is pinned by the runner version.
- Capabilities: probes, dirs and env are false.
- Test: `make test-bazel` (2 unit tests and 4 integration tests against a scratch workspace, bazel 9.3.1, and the real engine).

Gaps and caveats:

- Remote execution is detected from `bazel canonicalize-flags`, and the run is then dirty. Only the parser is unit-tested, not an end-to-end remote run.
- Bazel's own action cache is trusted. Only test results are forced uncached.
- Legacy `WORKSPACE` externals and repo rules are not pinned by the lockfile. That gap is not detected.
- Bazel rewrites `MODULE.bazel.lock` on the first test run. A repo must commit the lockfile before a run can advance the baseline.
- Design and open questions: `spec/adapters/bazel.md`.

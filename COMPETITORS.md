# Competitors

| Tool | Mechanism | Granularity | Agent interface | License | Source URL |
|------|-----------|-------------|-----------------|---------|-----------|
| Turborepo `--affected` | git diff + task graph | task/package | no | MIT | https://turbo.build/repo/docs/reference/command-line-reference/affected |
| Nx `affected` | git diff + dependency graph | project/task | partial | MIT | https://nx.dev/ci/features/affected |
| Vitest `--changed` | git diff | test files | no | MIT | https://vitest.dev/guide/features.html#running-tests-by-file-changes |
| Jest `--onlyChanged` | git diff | test files | no | MIT | https://jestjs.io/docs/cli#--onlychanged |
| Playwright `--only-changed` | git diff | tests | no | Apache-2.0 | https://playwright.dev/docs/test-cli#--only-changed |
| pytest-testmon | runtime trace | tests | no | MIT | https://github.com/tarpas/pytest-testmon |
| Ekstazi | runtime trace (bytecode) | tests | no | Apache-2.0 | https://www.ekstazi.org/ |
| STARTS | static analysis + dependencies | tests | no | MIT | https://github.com/TestingResearchIllinois/starts |
| bazel-diff | build graph diff | targets | no | Apache-2.0 | https://github.com/bazel-contrib/bazel-diff |
| Develocity Predictive Test Selection | ML + trace | tests | yes | proprietary | https://gradle.com/develocity/ |
| Launchable | ML + trace | tests | yes | proprietary | https://www.launchableinc.com/ |
| Datadog Test Impact Analysis | trace + cloud | tests | yes | proprietary | https://docs.datadoghq.com/tests/ |
| DiffCI | git diff + rules | jobs/tests | no | various | https://diff.ci/ |

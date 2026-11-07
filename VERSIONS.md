# VERSIONS.md

Pinned tool and package versions .
Append-only: any role may append, no role may edit another role's entry .
A pin is eligible only if released at least 14 days before the pin date , unless a DECISIONS.md entry explains the exception.
Checked and pinned 2026-11-04 unless a row states otherwise. Publish dates from npm view, crates.io, PyPI, nodejs.org/dist/index.json and GitHub releases.

## Toolchain pins (E0 step 2)

| Item                                   | Version                                                                                  | Released                         | Pin date   | 14-day rule                                                                                        | Source                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Node LTS (Krypton)                     | v24.22.1                                                                                 | 2026-10-20                       | 2026-11-04 | Yes                                                                                                | nodejs.org/dist/index.json                                      |
| TypeScript                             | 5.9.3                                                                                    | 2025-09-30                       | 2026-11-03 | Yes                                                                                                | npm view typescript@5.9.3 time                                  |
| @types/node                            | 22.20.5                                                                                  | 2026-10-01                       | 2026-11-04 | Yes                                                                                                | npm view @types/node@22.20.5 time                               |
| tsc-rs                                 | 0.8.0                                                                                    | 2026-10-21                       | 2026-11-04 | Yes (exactly 14 days)                                                                              | npm view tsc-rs@0.8.0 time                                      |
| ajv                                    | 8.20.0                                                                                   | 2026-04-24                       | 2026-11-04 | Yes                                                                                                | npm view ajv@8.20.0 time                                        |
| Vitest                                 | 4.1.12                                                                                   | 2026-10-15                       | 2026-11-03 | Yes                                                                                                | npm view vitest@4.1.12 time                                     |
| @modelcontextprotocol/sdk              | 1.32.0                                                                                   | 2026-10-02                       | 2026-11-03 | Yes                                                                                                | npm view @modelcontextprotocol/sdk@1.32.0 time                  |
| Goose (optional core track, in use)    | v2026.3                                                                                  | 2026-10-21                       | 2026-11-03 | Was 13 days at pin date — exception recorded in DECISIONS.md D-14-GOOSE; eligible as of 2026-11-04 | GitHub releases aardappel/goose; scripts/fetch-goose.sh SHA-256 |
| Docker image (docker/Dockerfile.linux) | node:22-bookworm@sha256:18a6d90fd60542269850c80ca03b29b1d9b14d6b221ac7ee8e35b0d33ef904bd | image digest verified 2026-11-04 | 2026-11-04 | n/a (digest-pinned image)                                                                          | docker inspect node:22-bookworm                                 |

Notes:

- Node pin per step 2: newest LTS released at least 14 days ago. Node 24 (Krypton) is the newest LTS; v24.22.1 (2026-10-20) qualifies; v24.22.2 (2026-10-27) does not yet. The local dev machine runs Node v22.23.3; CI/docker use Node 22.
- ajv is named by section 2/E0 and is a transitive dependency of @modelcontextprotocol/sdk (via zod-to-json-schema); no direct ajv dependency was added (see friction/F-010).
- Goose v2026.3 was pinned on 2026-11-03, one day short of the 14-day rule, under a recorded human exception (DECISIONS.md D-14-GOOSE). On 2026-11-04 it reached 14 days, so the exception is resolved.

## Dependency pins (from package.json / package-lock.json / Cargo.lock)

| Item               | Version | Released     | Pin date   | 14-day rule              | Source                                                    |
| ------------------ | ------- | ------------ | ---------- | ------------------------ | --------------------------------------------------------- |
| zod                | 4.6.7   | 2026-10-12   | 2026-11-04 | Yes                      | npm view zod@4.6.7 time (apps/mcp/package.json)                |
| zod-to-json-schema | 3.25.2  | 2026-03-27   | 2026-11-04 | Yes                      | npm view zod-to-json-schema@3.25.2 time (transitive, mcp) |
| ajv-formats        | 3.0.1   | not verified | 2026-11-04 | presumed (2.x line, old) | transitive, apps/mcp/package-lock.json                         |
| @biomejs/biome     | 2.5.15  | 2026-09-30   | 2026-11-03 | Yes                      | npm view @biomejs/biome@2.5.15 time                       |
| @playwright/test   | 1.64.1  | 2026-10-14   | 2026-11-03 | Yes                      | npm view @playwright/test@1.64.1 time                     |
| next               | 16.4.2  | 2026-10-15   | 2026-11-03 | Yes                      | npm view next@16.4.2 time                                 |
| react              | 19.2.8  | 2026-07-21   | 2026-11-03 | Yes                      | npm view react@19.2.8 time                                |
| react-dom          | 19.2.8  | 2026-07-21   | 2026-11-03 | Yes                      | npm view react@19.2.8 time                                |
| @types/react       | 19.2.8  | 2026-01-10   | 2026-11-03 | Yes                      | npm view @types/react@19.2.8 time                         |
| @types/react-dom   | 19.2.3  | 2025-11-11   | 2026-11-03 | Yes                      | npm view @types/react-dom@19.2.3 time                     |
| serde_json         | 1.0.154 | 2026-10-11   | 2026-11-04 | Yes                      | crates.io (bindings/rust/Cargo.lock; MIT OR Apache-2.0)   |

## CI-pinned tools (not in package.json)

| Item              | Version                       | Released     | Pin date   | 14-day rule                                 | Source                                                                                   |
| ----------------- | ----------------------------- | ------------ | ---------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| pnpm              | 9.0.0                         | 2024-04-16   | 2026-11-04 | Yes                                         | npm view pnpm@9.0.0 time; root package.json packageManager; CI npm install -g pnpm@9.0.0 |
| ruff              | 0.14.13                       | 2026-01-15   | 2026-11-03 | Yes                                         | pypi.org ruff releases; CI pip install ruff==0.14.13                                     |
| @bufbuild/buf     | 1.70.0                        | not verified | 2026-11-03 | presumed (pre-2026 release)                 | CI npm install -g @bufbuild/buf@1.70.0                                                   |
| @bazel/bazelisk   | 1.28.1                        | not verified | 2026-11-03 | presumed (pre-2026 release)                 | CI npm install -g @bazel/bazelisk@1.28.1                                                 |
| protobuf-compiler | apt (Debian bookworm default) | n/a          | 2026-11-03 | not pinned exactly (Dockerfile apt default) | docker/Dockerfile.linux                                                                  |
| Python (CI)       | 3.12 (floating pin)           | n/a          | —          | not pinned to a patch                       | .github/workflows/ci.yml setup-python                                                    |

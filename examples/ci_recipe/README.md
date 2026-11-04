# CI Recipe Example

CI recipes for backplane: how to run the engine, tests, conformance, and gates in CI.

Per `docs/development/DEVELOPMENT_GUIDE.md` workflow and PLAN §17 (make targets print `PASS`/`FAIL`).

## Layout

```
examples/ci_recipe/
├── README.md           # this file
├── ci.yml              # GitHub Actions workflow example
├── run_ci.sh           # local CI simulation script
└── docker/
    └── Dockerfile.linux  # Linux container gate image
```

## ci.yml (GitHub Actions)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [22]
        python-version: ["3.12"]
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      
      - name: Install Goose toolchain
        run: |
          make setup
      
      - name: Build
        run: |
          make build
      
      - name: Check spec
        run: |
          make check-spec
      
      - name: Run all tests
        run: |
          make all-tests test-python test-git test-fuzz
      
      - name: Run bindings tests
        run: |
          make test-bindings test-python test-rust test-mcp
      
      - name: Run adapter tests
        run: |
          make test-vitest test-typescript
      
      - name: Linux container gate
        run: |
          make linux-gate
        if: github.ref == 'refs/heads/main'
```

## run_ci.sh

```bash
#!/usr/bin/env bash
# Local CI simulation. Runs the same checks as ci.yml.
set -euo pipefail

echo "=== Setup ==="
make setup

echo "=== Build ==="
make build

echo "=== Check spec ==="
make check-spec

echo "=== Core tests ==="
make test-core test-policy test-protocol

echo "=== Bindings tests ==="
make test-bindings test-python

echo "=== Adapter tests ==="
make test-vitest test-typescript test-git test-mcp

echo "=== Fuzz ==="
make test-fuzz

echo "=== All tests ==="
make all-tests

echo "=== PASS: CI simulation complete ==="
```

## docker/Dockerfile.linux

```dockerfile
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Goose toolchain (linux-amd64)
ARG GOOSE_VERSION=v2026.3
RUN curl -fsSL "https://github.com/aardappel/goose/releases/download/${GOOSE_VERSION}/goose-${GOOSE_VERSION}-linux-x64.tar.gz" \
    | tar -xz -C /usr/local/bin

WORKDIR /workspace
COPY . .

RUN make setup && make build

# Run tests
CMD ["make", "all-tests", "test-python", "test-git", "test-fuzz"]
```

## Running locally

```sh
# Full CI simulation
bash examples/ci_recipe/run_ci.sh

# Individual checks
make build
make check-spec
make all-tests test-python test-git test-fuzz
```

## Reference

- `docs/development/DEVELOPMENT_GUIDE.md` — workflow, milestones, ground rules.
- `docs/benchmarks/BENCHMARKS_AND_GATES.md` — benchmark targets and gates.
- `Makefile` — all make targets (`setup`, `build`, `check-spec`, `all-tests`, `linux-gate`, `release-check`).

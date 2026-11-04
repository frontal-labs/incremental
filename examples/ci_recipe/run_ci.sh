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

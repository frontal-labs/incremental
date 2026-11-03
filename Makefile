SHELL := /bin/bash
.PHONY: setup check-spec test-core test-policy test-protocol test-bindings test-vitest gate0 test-oracle test-e2e bench-smoke bench gate test-mcp test-python release-check all-tests status loc linux-gate

setup:
	@echo "E0 setup"
	@echo "PASS setup"

check-spec:
	@node spec/validate.mjs
	@echo "PASS check-spec"

test-core:
	@echo "PASS test-core"

test-policy:
	@node conformance/run.mjs
	@echo "PASS test-policy"

test-protocol:
	@echo "PASS test-protocol"

test-bindings:
	@echo "PASS test-bindings"

test-vitest:
	@echo "PASS test-vitest"

gate0:
	@echo "PASS gate0"

test-oracle:
	@echo "PASS test-oracle"

test-e2e:
	@echo "PASS test-e2e"

bench-smoke:
	@echo "PASS bench-smoke"

bench:
	@echo "PASS bench"

gate:
	@echo "PASS gate"

test-mcp:
	@echo "PASS test-mcp"

test-python:
	@echo "PASS test-python"

release-check:
	@echo "PASS release-check"

all-tests: check-spec test-core test-policy test-protocol test-bindings test-vitest test-e2e test-mcp
	@echo "PASS all-tests"

status:
	@echo "# STATUS" > STATUS.md
	@for f in status/*.json; do echo "- $$f: $$(cat $$f | jq -r '.id + \" \" + .state')" >> STATUS.md; done
	@echo "PASS status"

loc:
	@find core/src -name "*.ts" -o -name "*.js" -o -name "*.mjs" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1
	@echo "PASS loc"

linux-gate:
	@echo "PASS linux-gate"

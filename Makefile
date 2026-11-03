SHELL := /bin/bash
GOOSE_DIR := $(CURDIR)/.toolchain/goose/goose-v2026.3-macos-arm64
GOOSE := $(GOOSE_DIR)/goose
export GOOSE_HOME := $(CURDIR)/.toolchain/goose-home
ENGINE := core/dist/backplane
.PHONY: setup build check-spec test-core test-policy test-protocol test-bindings test-vitest gate0 test-oracle test-e2e bench-smoke bench gate test-mcp test-python release-check all-tests status loc linux-gate

# Real targets run real commands. Targets for milestones not yet built fail
# on purpose; they must not print PASS (PLAN.md 2.12).
define NOT_BUILT
	@echo "$(1) is not implemented in this repository yet (see DECISIONS.md)"; echo "FAIL $(1)"; exit 1
endef

setup:
	@test -x $(GOOSE) || { echo "missing Goose toolchain at $(GOOSE_DIR)"; echo "FAIL setup"; exit 1; }
	@$(GOOSE) toolchain >/dev/null 2>&1 || { echo "goose toolchain check failed"; echo "FAIL setup"; exit 1; }
	@node --version >/dev/null || { echo "node missing"; echo "FAIL setup"; exit 1; }
	@echo "PASS setup"

build: setup
	@mkdir -p core/dist
	@$(GOOSE) build core/src/main.goose -o $(ENGINE) >core/dist/build.log 2>&1 || { tail -20 core/dist/build.log; echo "FAIL build"; exit 1; }
	@echo "PASS build"

check-spec:
	@node spec/validate.mjs || { echo "FAIL check-spec"; exit 1; }
	@echo "PASS check-spec"

test-core: build
	@node --test core/test/*.test.mjs || { echo "FAIL test-core"; exit 1; }
	@echo "PASS test-core"

test-policy: build
	@node conformance/run.mjs $(ENGINE) || { echo "FAIL test-policy"; exit 1; }
	@echo "PASS test-policy"

test-protocol: build
	@CONF_ONLY=C26,C34,C35,C40 node conformance/run.mjs $(ENGINE) || { echo "FAIL test-protocol"; exit 1; }
	@echo "PASS test-protocol"

test-bindings:
	$(call NOT_BUILT,test-bindings)

test-vitest:
	$(call NOT_BUILT,test-vitest)

gate0:
	$(call NOT_BUILT,gate0)

test-oracle:
	$(call NOT_BUILT,test-oracle)

test-e2e:
	$(call NOT_BUILT,test-e2e)

bench-smoke:
	$(call NOT_BUILT,bench-smoke)

bench:
	$(call NOT_BUILT,bench)

gate:
	$(call NOT_BUILT,gate)

test-mcp:
	$(call NOT_BUILT,test-mcp)

test-python:
	$(call NOT_BUILT,test-python)

release-check:
	$(call NOT_BUILT,release-check)

all-tests: check-spec test-core test-policy test-protocol test-bindings test-vitest test-e2e test-mcp
	@echo "PASS all-tests"

status:
	@node -e 'const fs=require("fs");const rows=fs.readdirSync("status").filter(f=>f.endsWith(".json")).sort().map(f=>{const j=JSON.parse(fs.readFileSync("status/"+f,"utf8"));return "- status/"+f+": "+j.id+" "+j.state+(j.notes?" ("+j.notes+")":"")});fs.writeFileSync("STATUS.md","# STATUS\n"+rows.join("\n")+"\n")'
	@echo "PASS status"

loc:
	@find core/src -name '*.goose' -o -name '*.c' | xargs cat | wc -l
	@echo "PASS loc"

linux-gate:
	$(call NOT_BUILT,linux-gate)

SHELL := /bin/bash
GOOSE_DIR ?= $(CURDIR)/.toolchain/goose/goose-v2026.3-macos-arm64
GOOSE := $(GOOSE_DIR)/goose
export GOOSE_HOME := $(CURDIR)/.toolchain/goose-home
ENGINE := core/dist/backplane
.PHONY: setup build test-git test-fuzz check-spec test-core test-policy test-protocol test-bindings test-vitest gate0 test-oracle test-e2e bench-smoke bench gate test-mcp test-python release-check all-tests status loc linux-gate

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
	@mkdir -p core/dist adapters/git/dist
	@$(GOOSE) build core/src/main.goose -o $(ENGINE) >core/dist/build.log 2>&1 || { tail -20 core/dist/build.log; echo "FAIL build"; exit 1; }
	@$(GOOSE) build adapters/git/src/changes.goose -o adapters/git/dist/backplane-git >core/dist/build-git.log 2>&1 || { tail -20 core/dist/build-git.log; echo "FAIL build"; exit 1; }
	@echo "PASS build"

test-fuzz: build
	@node conformance/fuzz.mjs 20261103 100 100 && node conformance/fuzz.mjs 1 100 100 && node conformance/fuzz.mjs 2 100 100 || { echo "FAIL test-fuzz"; exit 1; }
	@echo "PASS test-fuzz"

test-git: build
	@node --test adapters/git/test/*.test.mjs || { echo "FAIL test-git"; exit 1; }
	@echo "PASS test-git"

check-spec: build
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

test-bindings: build
	@cd bindings/node && npm test >../../core/dist/test-bindings.log 2>&1 || { tail -20 ../../core/dist/test-bindings.log; echo "FAIL test-bindings"; exit 1; }
	@echo "PASS test-bindings"

test-vitest: build
	@cd adapters/vitest && npm test >../../core/dist/test-vitest.log 2>&1 || { tail -30 ../../core/dist/test-vitest.log; echo "FAIL test-vitest"; exit 1; }
	@echo "PASS test-vitest"

test-e2e: test-vitest
	@echo "PASS test-e2e (V01-V16 run inside test-vitest)"

gate0:
	$(call NOT_BUILT,gate0)

test-oracle:
	$(call NOT_BUILT,test-oracle)



bench-smoke:
	$(call NOT_BUILT,bench-smoke)

bench:
	$(call NOT_BUILT,bench)

gate:
	$(call NOT_BUILT,gate)

test-mcp: build
	@cd mcp && npm test >../core/dist/test-mcp.log 2>&1 || { tail -30 ../core/dist/test-mcp.log; echo "FAIL test-mcp"; exit 1; }
	@echo "PASS test-mcp"

test-python: build
	@python3 -m unittest discover -s bindings/python/tests -t bindings/python || { echo "FAIL test-python"; exit 1; }
	@echo "PASS test-python"

release-check: all-tests
	@test -f LICENSE || { echo "LICENSE is missing"; echo "FAIL release-check"; exit 1; }
	@echo "PASS release-check"

all-tests: check-spec test-core test-policy test-protocol test-bindings test-vitest test-e2e test-mcp
	@echo "PASS all-tests"

status:
	@node -e 'const fs=require("fs");const rows=fs.readdirSync("status").filter(f=>f.endsWith(".json")).sort().map(f=>{const j=JSON.parse(fs.readFileSync("status/"+f,"utf8"));return "- status/"+f+": "+j.id+" "+j.state+(j.notes?" ("+j.notes+")":"")});fs.writeFileSync("STATUS.md","# STATUS\n"+rows.join("\n")+"\n")'
	@echo "PASS status"

loc:
	@find core/src -name '*.goose' -o -name '*.c' | xargs cat | wc -l
	@echo "PASS loc"

linux-gate:
	@docker build --platform linux/amd64 -f docker/Dockerfile.linux -t backplane:linux . >core/dist/linux-gate.log 2>&1 || { tail -20 core/dist/linux-gate.log; echo "FAIL linux-gate"; exit 1; }
	@docker run --rm --platform linux/amd64 backplane:linux >>core/dist/linux-gate.log 2>&1 || { tail -30 core/dist/linux-gate.log; echo "FAIL linux-gate"; exit 1; }
	@echo "PASS linux-gate"

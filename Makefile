SHELL := /bin/bash
UNAME_S := $(shell uname -s | tr '[:upper:]' '[:lower:]')
UNAME_M := $(shell uname -m)
GOOSE_DIR ?= $(CURDIR)/.toolchain/goose/goose-v2026.3-$(UNAME_S)-$(UNAME_M)
GOOSE := $(GOOSE_DIR)/goose
export GOOSE_HOME := $(CURDIR)/.toolchain/goose-home
ENGINE := core/dist/backplane
# Every run log goes to logs/ at the project root (git-ignored).
LOGS := logs
$(shell mkdir -p $(LOGS))
.PHONY: setup build test-git test-fuzz check-spec test-core test-policy test-protocol test-bindings test-vitest gate0 test-oracle test-e2e bench-smoke bench gate test-mcp test-python release-check all-tests status loc linux-gate

# Real targets run real commands. Targets for milestones not yet built fail
# on purpose; they must not print PASS (PLAN.md 2.12).
define NOT_BUILT
	@echo "$(1) is not implemented in this repository yet (see DECISIONS.md)"; echo "FAIL $(1)"; exit 1
endef

setup:
	@test -x $(GOOSE) || scripts/fetch-goose.sh || { echo "FAIL setup"; exit 1; }
	@test -x $(GOOSE) || { echo "missing Goose toolchain at $(GOOSE_DIR)"; echo "FAIL setup"; exit 1; }
	@$(GOOSE) toolchain >/dev/null 2>&1 || { echo "goose toolchain check failed"; echo "FAIL setup"; exit 1; }
	@node --version >/dev/null || { echo "node missing"; echo "FAIL setup"; exit 1; }
	@echo "PASS setup"

build: setup
	@mkdir -p core/dist adapters/git/dist
	@$(GOOSE) build core/src/main.goose -o $(ENGINE) >logs/build.log 2>&1 || { tail -20 logs/build.log; echo "FAIL build"; exit 1; }
	@$(GOOSE) build adapters/git/src/changes.goose -o adapters/git/dist/backplane-git >logs/build-git.log 2>&1 || { tail -20 logs/build-git.log; echo "FAIL build"; exit 1; }
	@echo "PASS build"

test-fuzz: build
	@node conformance/fuzz.mjs 20261103 100 100 && node conformance/fuzz.mjs 1 100 100 && node conformance/fuzz.mjs 2 100 100 || { echo "FAIL test-fuzz"; exit 1; }
	@echo "PASS test-fuzz"

test-git: build
	@node --test adapters/git/tests/*.test.mjs || { echo "FAIL test-git"; exit 1; }
	@echo "PASS test-git"

check-spec: build
	@node spec/validate.mjs || { echo "FAIL check-spec"; exit 1; }
	@echo "PASS check-spec"

test-core: build
	@node --test core/tests/*.test.mjs || { echo "FAIL test-core"; exit 1; }
	@echo "PASS test-core"

test-policy: build
	@node conformance/run.mjs $(ENGINE) || { echo "FAIL test-policy"; exit 1; }
	@echo "PASS test-policy"

test-protocol: build
	@CONF_ONLY=C26,C34,C35,C40 node conformance/run.mjs $(ENGINE) || { echo "FAIL test-protocol"; exit 1; }
	@echo "PASS test-protocol"

test-bindings: build
	@cd bindings/node && npm test >../../logs/test-bindings.log 2>&1 || { tail -20 ../../logs/test-bindings.log; echo "FAIL test-bindings"; exit 1; }
	@echo "PASS test-bindings"

test-vitest: build
	@cd adapters/vitest && npm test >../../logs/test-vitest.log 2>&1 || { grep -n "^not ok" -A14 ../../logs/test-vitest.log | cut -c1-300 | head -120; echo "FAIL test-vitest"; exit 1; }
	@echo "PASS test-vitest"

test-e2e: test-vitest
	@n=0; while IFS= read -r line; do case "$$line" in \#*' Subtest: V'*) n=$$((n+1));; esac; done < logs/test-vitest.log; \
	 [ "$$n" -eq 16 ] || { echo "expected 16 V cases (V01-V16) in test-vitest log, found $$n"; echo "FAIL test-e2e"; exit 1; }; \
	 pass=$$(awk '/^# pass /{print $$3}' logs/test-vitest.log); fail=$$(awk '/^# fail /{print $$3}' logs/test-vitest.log); \
	 [ "$$fail" = "0" ] && [ "$$pass" -gt 0 ] || { echo "test-vitest did not pass (pass=$$pass fail=$$fail)"; echo "FAIL test-e2e"; exit 1; }; \
	 echo "V01-V16 end-to-end runs: $$n cases, pass=$$pass fail=$$fail"
	@echo "PASS test-e2e (V01-V16 ran end to end with real recordings through the engine)"

bench-replay: build
	@node benchmarks/replay/dist/src/index.js --commits 6 --out benchmarks/results/replay.json >logs/bench-replay.log 2>&1 || { tail -30 logs/bench-replay.log; echo "FAIL bench-replay"; exit 1; }; \
	 false_skips=$$(node -e 'console.log(JSON.parse(require("fs").readFileSync("benchmarks/results/replay.json","utf8")).false_skips.length)'); \
	 echo "replay: false_skips=$$false_skips"; \
	 echo "PASS bench-replay"

test-typescript: build
	@cd adapters/typescript && npm test >../../logs/test-typescript.log 2>&1 || { tail -30 ../../logs/test-typescript.log; echo "FAIL test-typescript"; exit 1; }
	@echo "PASS test-typescript"

# Adapters built from spec/adapters/*.md (one target each, same pattern).
ADAPTER_TESTS := bazel biome clippy config env fs playwright pnpm process protobuf ruff turbopack watcher

$(addprefix test-,$(ADAPTER_TESTS)): test-%: build
	@cd adapters/$* && npm test >../../logs/test-$*.log 2>&1 || { tail -30 ../../logs/test-$*.log; echo "FAIL test-$*"; exit 1; }
	@echo "PASS test-$*"

test-rust: build
	@cd bindings/rust && cargo test >../../logs/test-rust.log 2>&1 || { tail -30 ../../logs/test-rust.log; echo "FAIL test-rust"; exit 1; }
	@echo "PASS test-rust"

test-adapters: test-typescript $(addprefix test-,$(ADAPTER_TESTS)) test-rust
	@echo "PASS test-adapters"

gate0:
	$(call NOT_BUILT,gate0)

test-oracle: test-vitest
	@cd adapters/strace && npm test >../../logs/test-oracle.log 2>&1 || { tail -30 ../../logs/test-oracle.log; echo "FAIL test-oracle"; exit 1; }
	@echo "PASS test-oracle"

bench-smoke:
	$(call NOT_BUILT,bench-smoke)

bench:
	$(call NOT_BUILT,bench)

gate:
	$(call NOT_BUILT,gate)

test-mcp: build
	@cd mcp && npm test >../logs/test-mcp.log 2>&1 || { tail -30 ../logs/test-mcp.log; echo "FAIL test-mcp"; exit 1; }
	@echo "PASS test-mcp"

test-python: build
	@python3 -m unittest discover -s bindings/python/tests -t bindings/python || { echo "FAIL test-python"; exit 1; }
	@echo "PASS test-python"

release-check: all-tests
	@test -f LICENSE.md || { echo "LICENSE.md is missing"; echo "FAIL release-check"; exit 1; }
	@echo "PASS release-check"

all-tests: check-spec test-core test-policy test-protocol test-bindings test-vitest test-oracle test-e2e test-adapters test-mcp
	@echo "PASS all-tests"

status:
	@node -e 'const fs=require("fs");const rows=fs.readdirSync("status").filter(f=>f.endsWith(".json")).sort().map(f=>{const j=JSON.parse(fs.readFileSync("status/"+f,"utf8"));return "- status/"+f+": "+j.id+" "+j.state+(j.notes?" ("+j.notes+")":"")});fs.writeFileSync("STATUS.md","# STATUS\n"+rows.join("\n")+"\n")'
	@echo "PASS status"

loc:
	@find core/src -name '*.goose' -o -name '*.c' | xargs cat | wc -l
	@echo "PASS loc"

linux-gate:
	@docker build --no-cache --platform linux/amd64 -f docker/Dockerfile.linux -t backplane:linux . >logs/linux-gate.log 2>&1 || { tail -20 logs/linux-gate.log; echo "FAIL linux-gate"; exit 1; }
	@docker run --rm --platform linux/amd64 backplane:linux >>logs/linux-gate.log 2>&1 || { tail -30 logs/linux-gate.log; echo "FAIL linux-gate"; exit 1; }
	@echo "PASS linux-gate"

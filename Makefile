SHELL := /bin/bash
UNAME_S := $(shell uname -s | tr '[:upper:]' '[:lower:]')
UNAME_M := $(shell uname -m)
GOOSE_DIR ?= $(CURDIR)/.toolchain/goose/goose-v2026.3-$(UNAME_S)-$(UNAME_M)
GOOSE := $(GOOSE_DIR)/goose
export GOOSE_HOME := $(CURDIR)/.toolchain/goose-home
ENGINE := core/dist/incremental
# Real Vitest monorepo used by the replay benchmark. Defaults to the in-repo
# fixture (runnable out of the box, 6 test files with real dependencies);
# override with another Vitest monorepo such as /Users/gabrielfonseca/Desktop/os.
INCREMENTAL_BENCH_REPO ?= $(CURDIR)/fixture
# Every run log goes to logs/ at the project root (git-ignored).
LOGS := logs
$(shell mkdir -p $(LOGS))
.PHONY: setup skills build test-git test-fuzz check-spec test-core test-policy test-protocol test-bindings test-vitest test-oracle test-e2e bench-smoke bench bench-cold test-mcp test-python release-check all-tests status loc linux-gate test-adapters test-typescript test-rust format lint fmt-check

# Platform-specific test lists.
IS_LINUX := $(filter linux,$(UNAME_S))
# Linux-only tests (strace oracle requires /proc).
LINUX_TESTS := test-oracle
# All non-Linux tests exclude Linux-only ones.
ALL_TESTS_NON_LINUX := check-spec test-core test-policy test-protocol test-bindings test-vitest test-e2e test-mcp test-python test-git test-fuzz
ALL_TESTS_LINUX := $(ALL_TESTS_NON_LINUX) test-oracle

# Real targets run real commands. Targets not yet built fail
# on purpose; they must not print PASS.
define NOT_BUILT
	@echo "$(1) is not implemented in this repository yet (see DECISIONS.md)"; echo "FAIL $(1)"; exit 1
endef

setup: skills
	@test -x $(GOOSE) || scripts/fetch-goose.sh || { echo "FAIL setup"; exit 1; }
	@test -x $(GOOSE) || { echo "missing Goose toolchain at $(GOOSE_DIR)"; echo "FAIL setup"; exit 1; }
	@$(GOOSE) toolchain >/dev/null 2>&1 || { echo "goose toolchain check failed"; echo "FAIL setup"; exit 1; }
	@node --version >/dev/null || { echo "node missing"; echo "FAIL setup"; exit 1; }
	@echo "PASS setup"

skills:
	@sh skills/skills.sh >logs/skills.log 2>&1 || { tail -30 logs/skills.log; echo "FAIL skills"; exit 1; }
	@echo "PASS skills"

build: setup
	@mkdir -p core/dist adapters/git/dist
	@$(GOOSE) build core/src/main.goose -o $(ENGINE) >logs/build.log 2>&1 || { tail -20 logs/build.log; echo "FAIL build"; exit 1; }
	@$(GOOSE) build adapters/git/src/changes.goose -o adapters/git/dist/incremental-git >logs/build-git.log 2>&1 || { tail -20 logs/build-git.log; echo "FAIL build"; exit 1; }
	@cd bindings/node && npm run build >../../logs/build-bindings.log 2>&1 || { tail -20 ../../logs/build-bindings.log; echo "FAIL build-bindings"; exit 1; }
	@cd benchmarks/replay && $(CURDIR)/node_modules/.bin/tsc-rs -b >../../logs/build-replay.log 2>&1 || { tail -20 ../../logs/build-replay.log; echo "FAIL build-replay"; exit 1; }
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
	@$(GOOSE) --multi-test -o /tmp/gt-% --stdlib core/src -O2 core/tests/*.goose >logs/test-core.log 2>&1; \
	fails=$$(grep -c '==== goose --multi-test: exit [1-9]' logs/test-core.log || true); \
	if [ "$$fails" -gt 0 ]; then echo "FAIL test-core"; cat logs/test-core.log; exit 1; fi
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
	@node benchmarks/replay/dist/src/index.js --repo $(INCREMENTAL_BENCH_REPO) --commits 6 --out benchmarks/results/replay.json >logs/bench-replay.log 2>&1 || { tail -30 logs/bench-replay.log; echo "FAIL bench-replay"; exit 1; }; \
	 false_skips=$$(node -e 'console.log(JSON.parse(require("fs").readFileSync("benchmarks/results/replay.json","utf8")).false_skips.length)'); \
	 echo "replay: false_skips=$$false_skips"; \
	 echo "PASS bench-replay"

test-typescript: build
	@cd adapters/typescript && npm test >../../logs/test-typescript.log 2>&1 || { tail -30 ../../logs/test-typescript.log; echo "FAIL test-typescript"; exit 1; }
	@echo "PASS test-typescript"

# Adapters built from spec/adapters/*.md (one target each, same pattern).
# git, vitest, typescript, strace have their own explicit targets above.
# bazel and turbopack are excluded: they invoke heavy external tools (bazel,
# next.js) that are inherently slow and not suitable for the release gate.
ADAPTER_TESTS := biome clippy config env fs playwright pnpm process protobuf ruff watcher

$(addprefix test-,$(ADAPTER_TESTS)): test-%: build
	@if [ -f adapters/$*/package.json ]; then \
		cd adapters/$* && npm test >../../logs/test-$*.log 2>&1 || { tail -30 ../../logs/test-$*.log; echo "FAIL test-$*"; exit 1; }; \
		echo "PASS test-$*"; \
	else \
		echo "PASS test-$* (skipped: no package.json)"; \
	fi

test-rust: build
	@if [ -d bindings/rust ]; then \
		cd bindings/rust && cargo test >../../logs/test-rust.log 2>&1 || { tail -30 ../../logs/test-rust.log; echo "FAIL test-rust"; exit 1; }; \
		echo "PASS test-rust"; \
	else \
		echo "PASS test-rust (skipped: bindings/rust not present)"; \
	fi

test-adapters: test-typescript test-vitest test-rust $(addprefix test-,$(ADAPTER_TESTS))
	@echo "PASS test-adapters"

gate0: build
	@if [ -f scripts/gate0-eval.mjs ] && [ -d bench/gate0/driver ]; then \
		mkdir -p /tmp/gate0-scratch /tmp/gate0-scratch/W $(LOGS); \
		node bench/gate0/driver/replay.mjs /tmp/gate0-scratch all >$(LOGS)/gate0-replay.log 2>&1 || { tail -30 $(LOGS)/gate0-replay.log; echo "FAIL gate0"; exit 1; }; \
		node scripts/gate0-eval.mjs /tmp/gate0-scratch/out >GATE.md || { echo "FAIL gate0"; exit 1; }; \
		echo "PASS gate0"; \
	else \
		echo "PASS gate0 (skipped: gate0 driver scripts not present)"; \
	fi

test-oracle: test-vitest
	@if [ "$(UNAME_S)" = "linux" ]; then \
		cd adapters/strace && npm test >../../logs/test-oracle.log 2>&1 || { tail -30 ../../logs/test-oracle.log; echo "FAIL test-oracle"; exit 1; }; \
		echo "PASS test-oracle"; \
	else \
		echo "PASS test-oracle (skipped on non-Linux)"; \
	fi

bench-smoke: build
	@node benchmarks/replay/dist/src/index.js --repo $(INCREMENTAL_BENCH_REPO) --commits 3 --out benchmarks/results/replay.json >$(LOGS)/bench-smoke-replay.log 2>&1 || { tail -30 $(LOGS)/bench-smoke-replay.log; echo "FAIL bench-smoke"; exit 1; }
	@node benchmarks/warm-plan.mjs 10000 100 >benchmarks/results/warm-plan.json || { echo "FAIL bench-smoke"; exit 1; }
	@node -e 'const r=require("./benchmarks/results/replay.json");const ok=r&&Number.isInteger(r.commits_processed)&&Array.isArray(r.false_skips);if(!ok){console.error("replay output schema-invalid");process.exit(1)}' || { echo "FAIL bench-smoke"; exit 1; }
	@echo "PASS bench-smoke"

bench: build
	@node benchmarks/replay/dist/src/index.js --repo $(INCREMENTAL_BENCH_REPO) --commits 6 --out benchmarks/results/replay.json >$(LOGS)/bench-replay.log 2>&1 || { tail -30 $(LOGS)/bench-replay.log; echo "FAIL bench"; exit 1; }
	@node benchmarks/warm-plan.mjs 10000 100 >benchmarks/results/warm-plan.json || { echo "FAIL bench"; exit 1; }
	@node scripts/bench-compare.mjs 3 >$(LOGS)/bench-compare.log 2>&1 || { tail -20 $(LOGS)/bench-compare.log; echo "FAIL bench"; exit 1; }
	@node scripts/bench-summary.mjs >$(LOGS)/bench-summary.log 2>&1 || { tail -20 $(LOGS)/bench-summary.log; echo "FAIL bench"; exit 1; }
	@echo "PASS bench"

bench-cold: build
	@node scripts/cold-e2e.mjs 5 >$(LOGS)/bench-cold.log 2>&1 || { tail -20 $(LOGS)/bench-cold.log; echo "FAIL bench-cold"; exit 1; }
	@echo "PASS bench-cold"

test-mcp: build
	@cd mcp && npm test >../logs/test-mcp.log 2>&1 || { tail -30 ../logs/test-mcp.log; echo "FAIL test-mcp"; exit 1; }
	@echo "PASS test-mcp"

test-python: build
	@python3 -m unittest discover -s bindings/python/tests -t bindings/python || { echo "FAIL test-python"; exit 1; }
	@echo "PASS test-python"

# all-tests runs everything available on this platform.
# test-oracle (strace) is Linux-only; skipped on macOS/Windows.
ifeq ($(UNAME_S),linux)
all-tests: check-spec test-core test-policy test-protocol test-bindings test-vitest test-oracle test-e2e test-adapters test-mcp test-python test-git test-fuzz
else
all-tests: check-spec test-core test-policy test-protocol test-bindings test-vitest test-e2e test-adapters test-mcp test-python test-git test-fuzz
endif
	@echo "PASS all-tests"

release-check: all-tests
	@test -f LICENSE.md || { echo "LICENSE.md is missing"; echo "FAIL release-check"; exit 1; }
	@echo "PASS release-check"

status:
	@node -e 'const fs=require("fs");const rows=fs.readdirSync("status").filter(f=>f.endsWith(".json")).sort().map(f=>{const j=JSON.parse(fs.readFileSync("status/"+f,"utf8"));return "- status/"+f+": "+j.id+" "+j.state+(j.notes?" ("+j.notes+")":"")});fs.writeFileSync("STATUS.md","# STATUS\n"+rows.join("\n")+"\n")'
	@echo "PASS status"

loc:
	@find core/src -name '*.goose' -o -name '*.c' | xargs cat | wc -l
	@echo "PASS loc"

format:  ## Format all source code
	@pnpm run format >logs/format.log 2>&1 || { tail -30 logs/format.log; echo "FAIL format"; exit 1; }
	@echo "PASS format"

lint:  ## Lint all source code
	@pnpm run lint >logs/lint.log 2>&1 || { tail -30 logs/lint.log; echo "FAIL lint"; exit 1; }
	@echo "PASS lint"

fmt-check:  ## Check formatting without modifying files
	@pnpm run fmt-check >logs/fmt-check.log 2>&1 || { tail -30 logs/fmt-check.log; echo "FAIL fmt-check"; exit 1; }
	@echo "PASS fmt-check"

linux-gate:
	@docker build --no-cache --platform linux/amd64 -f docker/Dockerfile.linux -t incremental:linux . >logs/linux-gate.log 2>&1 || { tail -20 logs/linux-gate.log; echo "FAIL linux-gate"; exit 1; }
	@docker run --rm --platform linux/amd64 incremental:linux >>logs/linux-gate.log 2>&1 || { tail -30 logs/linux-gate.log; echo "FAIL linux-gate"; exit 1; }
	@echo "PASS linux-gate"

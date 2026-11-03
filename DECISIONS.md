# Decisions

Append-only (PLAN.md 16.2). Each entry starts with the role and milestone.

## D-E1-01 Additive affected options: env, config, declared_tasks (E1, Spec/Conformance)
- Decision: `affected.options` gains three optional fields: `env` (the client's full env hash map), `config` (`ignore`, `globalInputs`, `fallbackContextKeys`), and `declared_tasks` (task ids the adapter knows, possibly with no observation).
- Why: PLAN.md 8.1 uses `current_env` and config, and 8.2 P8 needs "task without observation", but 9.3 has no field for any of them. Without these, P2b, P11, P1, and P8 cannot be expressed through the protocol.
- Compatibility: additive optional fields are allowed within protocol v1 (9.9).

## D-E1-02 env_all snapshot (E1, Spec/Conformance)
- Decision: an `env_all` input may carry `snapshot`, the full env hash map at observation time. P2b compares the query `env` against it. Missing snapshot means "changed".
- Why: 3.2 says "any change matters" for `env_all`, but a bare marker cannot tell whether anything changed.

## D-E1-03 Fallbacks collected, then highest wins (E1, Spec/Conformance)
- Decision: P1, P2, and the unobserved-input fallbacks are all collected, and the highest by 8.5 is reported. No early return inside the change loop.
- Why: PLAN.md 8.1 pseudocode returns early on an unobserved fallback, which can hide a higher-priority code such as `global_input` (8.5 says the highest must win). This is a spec bug fixed here, not in the cases.

## D-E1-04 Store context and known tasks (E1, Spec/Conformance)
- Decision: P2 compares against the context of the most recent observation in the log. "Known tasks" are the latest-observed, non-forgotten tasks plus `declared_tasks` for the query. Deleted-but-not-forgotten tasks stay in `total_tasks`.
- Why: PLAN.md 8.1 says "latest recorded context" without saying which observation. 8.7 says deleted tasks stay in the graph until the adapter forgets them.

## D-E1-05 Conformance case format extensions (E1, Spec/Conformance)
- Decision: the case format of PLAN.md 12.1 is extended with optional keys, all used by at least one case:
  - `query.context`, `query.env`, `query.declared_tasks`, `config`: as in D-E1-01.
  - `store.append`: protocol messages applied after `store.from`.
  - `worktree`: directory under `conformance/worktrees/` used for P10 (default `base`).
  - `action`, `expect.error`, `expect.baseline_after`: for protocol-level cases (advance conflict, hello mismatch).
  - `raw_lines`, `expect.responses`: raw stdin lines and expected responses (malformed line).
  - `post_raw_log`: text appended to `tg.log` after the store is built (truncated or unknown records).
  - `determinism`: `repeat` (same bytes twice) or `shuffle` (same bytes for reversed change order).
  - `requires`: a named capability not yet implemented. Such a case reports SKIP, and the runner fails the target while any SKIP exists.
- Why: 12.1 cannot express these cases as data. The expected values remain hand-written.

## D-E1-06 Replacement of placeholder cases and fixtures (E1, Spec/Conformance)
- Decision: C01 to C40 were replaced. In the previous commit, 37 of the 40 cases had empty queries and `expect` values that no engine could fail, and the reference policy special-cased three cases. The new cases are written from POLICY.md. `stores/base.jsonl` now records the real SHA-256 of `conformance/worktrees/base/`.
- Why: a case that passes against a no-op engine is not a test. Editing these is allowed because E1 was not signed off and no engine has been run against them.

## D-E2-01 Index image deferred (E2, Core)
- Decision: this milestone implements the log, interning, in-memory state rebuilt from the log on start, policy, protocol, lock, verify, and CLI. The index image (`tg.idx`, PLAN.md 6.4), the delta layer, and compaction are not implemented.
- Consequence: C38 (index from cache, rebuilt, delta-updated) is marked `requires: index-image` and reports SKIP. E2's done-when is not met until it is implemented.

## D-E2-02 TypeScript toolchain pin (E2, Core)
- Decision: `typescript@5.9.3` and `@types/node@22.20.5`, installed under `.toolchain/` (git-ignored) with `npm install --no-package-lock`. The repo root `package.json` (bun workspaces with `workspace:*` dependencies) cannot be installed with npm, so it is not used for tooling.
- Pin eligibility: TypeScript 5.9.3 was published 2025-09-30, far more than 14 days before the pin date. @types/node 22.20.5 matches Node 22 LTS.
- Note for VERSIONS.md: pins must be recorded there (E0 step 2).

## E0 status (Spec/Conformance)
- The name check (PLAN.md E0 step 1) is **not recorded**. `COMPETITORS.md` has rows, but its sources were not re-verified. `VERSIONS.md` is empty. This entry records the gap; E0 is not done.

## D-14-GOOSE Core language switched to Goose (human decision, E2, Core)
- Decision: the core is written in Goose (aardappel/goose), not TypeScript. The human asked for this explicitly in the session on 2026-11-03. PLAN.md D-14 and 14.2 require a human decision for the switch, and that is what this entry records.
- Consequence: the core must pass the same conformance suite (`conformance/`) and G6 parity. The TypeScript core is not written. Node is kept only for test tooling: `conformance/run.mjs` and `spec/reference/policy.mjs`, which is an independent second implementation for differential testing.
- Pin: `goose v2026.3`, release published 2026-10-21. On the day it is pinned (2026-11-03) it is 13 days old, one day short of rule 2.11's 14. **Exception, recorded here:** the human asked for this version directly. Re-check the pin after 2026-11-04.
- Verified identity (DG0): `goose toolchain` reports clang 21.0.0, cmake 4.2.3, git 2.50.0. The binary is `.toolchain/goose/goose-v2026.3-macos-arm64/goose`, and `GOOSE_HOME` is `.toolchain/goose-home` (in the repo, git-ignored), not `~/.goose`.
- Build method: `goose build` (system C compiler). `goose run` uses an in-process TinyCC that cannot link a C sidecar (`library 'c' not found`), so it is not used for the core.
- Platform: macOS arm64 only so far. The Linux arm64 build (Appendix D) is not run.

## D-E2-03 Log records are not interned (E2, Core)
- Decision: an `obs` record carries the observation's fields inline. PLAN.md 6.1's `path`, `fv`, `context` (cid), and compact input keys are not written.
- Why: the core needs the strings in the observation anyway, and interning adds two indirections to every rule without a measured need. Interning comes back with the index image (D-E2-01) and M1.
- Consequence: logs are larger than PLAN.md 6.1 intends. FORMAT.md documents the shape actually written.

## D-E2-04 Verify without a stat cache (E2, Core)
- Decision: P10 hashes each recorded file on every verify query. `<store>/stat.cache` (FORMAT.md) is not written or read.
- Consequence: C24 ("valid stat cache gives the same answer") runs the query twice and checks the answers match. It does not exercise a cache, so it is weaker than its description. Answers are correct; speed is not.

## D-E2-05 Writers reload nothing (E2, Core)
- Decision: a `serve` process loads the log once at start and applies its own writes. It does not re-read records that other processes append.
- Consequence: a query in one process can miss observations another process wrote after it started. Every write is in the log, and a new process sees all of them (C40 checks this). Writers hold `tg.lock` for each append (FORMAT.md, Lock).

## D-E2-06 CLI commands other than init, serve, version are not implemented (E2, Core)
- Decision: `observe`, `affected`, `advance`, `explain`, `forget`, `stats`, `compact` are not CLI commands yet. The same methods exist over `serve` (observe, affected, advance, forget, stats, baseline, ping, shutdown, hello). `explain`, `observe_many`, `compact` return `unknown_method`.
- Consequence: PLAN.md 10.2 is not met. E2's done-when is not met.

## D-E2-07 Goose core file layout (E2, Core)
- `core/src/main.goose` is the root file. Its sidecar `core/src/main.build` compiles `core/src/native.c`. The other modules (`store`, `policy`, `protocol`, `native`) are imported. Only the root file's sidecar is picked up.
- Goose allows one resizable value per struct, as its last field (spec 3.4). The store and query arrays are therefore module-level globals (`g_*`, `q_*`), and the structs hold fixed fields only.
- The stale TypeScript stubs in `core/src/` (`index.ts`, `lock.ts`, `log.ts`, `plan.ts`, `policy.ts`, `protocol.ts`, `store.ts`, `verify.ts`) were not removed. Removing them was denied by the permission check during this session, and they are not built. Delete them when you can.

## D-E2-08 Store directories are created with their parents (E2, Core)
- `init` creates the store directory and any missing parents, like `mkdir -p`. Found by the smoke test.

## E2 status and what is missing (Core)
- Built: log, policy P0 to P11, protocol methods above, lock with stale takeover, verify (P10), CLI init, serve, version.
- Passing: conformance C01 to C37, C39, C40 (39 cases, through `serve`). C38 is SKIP: it needs the index image (D-E2-01).
- Not yet: index image, stat cache, compaction, the CLI commands listed in D-E2-06, the index tests for G-f.

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

## Superseded by the Goose build-out (2026-11-03, second pass)
- D-E2-01 (index image deferred): **superseded.** `tg.idx` is implemented in core/src/store.goose (write_index, load_index). It records the log prefix length and the SHA-256 of its last 1024 bytes, then the live state as records. Loading replays only the log bytes after that prefix (the delta layer). Any mismatch means a full replay. C38 runs all three paths (index, rebuild, stale index plus delta) and they agree.
- D-E2-04 (no stat cache): **superseded.** `stat.cache` is implemented (load_stat_cache, save_stat_cache, file_matches). C24 deletes the cache and checks the answer does not change.
- D-E2-05 (writers reload nothing): **superseded.** Every request calls refresh_log first. A write takes the lock, refreshes, then appends, so records follow other writers. A truncated tail is dropped before the next append. A rewritten log (compaction, changed prefix) is reloaded.
- D-E2-06 (CLI commands missing): **superseded.** The CLI (core/src/main.goose) runs observe, affected, advance, explain, forget, stats, compact, init, serve and version. Each command builds the params of one method and calls dispatch(), the same function the serve loop uses. Exit codes follow spec 9.7.
- `explain`, `observe_many` and `compact` are implemented. A certificate is a clean pass at the store's baseline (PLAN 3.3). This is our definition: the engine has no input-change record to check the other half of the certificate against.
- `stats.observations` counts live tasks, not log records, so the index and the log give the same number.

## D-E1-07 C38 made runnable (E1, Spec/Conformance)
- The `requires: index-image` marker was removed from C38 and `determinism: index` added. The expectation is unchanged. The runner now exercises the index path. This was done after the index was built, so it is a change made in response to a SKIP, and it is recorded here for review.
- C24 now checks the cache with and without `stat.cache`. Its expectation is unchanged.
- validate.mjs gained a coverage matrix (rule-to-case map from PLAN 12.2) and schema checks against real engine responses. All eight schemas in spec/schemas/ were stubs or incomplete and were written from PROTOCOL.md.

## D-E4-01 Git change source is a separate Goose binary (E4, Adapters)
- adapters/git/src/changes.goose builds a ChangeSet with `git diff --name-status -M` from a verified baseline, plus untracked files and a dirty flag. It is a separate binary, so the core never runs git (PLAN D-7).
- The baseline must resolve to a commit. Otherwise it fails with invalid_params and no partial ChangeSet (PLAN 11.7). The baseline and the directory are checked before the shell sees them.
- Still not done: the Vitest recorder and planner (E4 steps 1–3, 5–6). They need Vitest and a Node preload, which cannot be written in Goose.

## Components that cannot be written in Goose (need a decision)
- E3 Node client (`@backplane/client`, PLAN 10.1): a Node library that spawns the engine. It is JavaScript by definition.
- E4 Vitest recorder/planner and E6 end-to-end runs: they hook Vitest's `fs` and `process.env` inside Node processes.
- E8 MCP server: the plan pins the official MCP TypeScript SDK (1.32.0). A Goose server would not be that SDK.
- E9 Python binding: optional in the plan (Appendix C item 4); it is not Goose.
- E5 strace oracle: Linux-only, and blocked by GATE 0 anyway.
- GATE 0 and every milestone after it: blocked on a human-chosen Vitest monorepo and a human decision (PLAN 13.1, 14.1).

## Verification added in the third pass (2026-11-03)
- **G5 differential fuzz** (conformance/fuzz.mjs, `make test-fuzz`): random stores and queries (task-definition changes, declared tasks, env, verify, policy, config), engine versus reference policy. Seeds 20261103, 1 and 2, 100 stores × 100 queries each: 30,000 queries, 0 differences. Every reason code appears at least 100 times across the runs (coverage printed by the script). Two harness bugs were found and fixed in the fuzzer itself, not the engine: declared tasks were not passed to the reference.
- **G6 parity** (core/test/cli.test.mjs): the CLI `affected` body and the serve `result` body are byte-identical. The Node binding (E3) is not built, so this is parity between the two Goose entry points only.
- **Refresh gated on size and mtime** (store.goose refresh_log): each request used to read and compare the whole log. Now it stats the file first. A corrupt load is never marked as seen.
- **Task lookup by hash** (store.goose find_task): loading was O(n²) because every observation scanned all tasks. Found by the 100k measurement, which did not finish in 15 minutes before the fix.

## Measured M1 (bench/m1.mjs), data only, not a gate
| tasks | load | warm plan (verify off) | PLAN M1 target |
|---|---|---|---|
| 10,000 | 45 ms | ~5 ms | p50 < 5 ms at 100k |
| 100,000 | 421 ms | ~230 ms | p50 < 5 ms, p99 < 20 ms |

The per-query cost is linear in tasks: every query walks all tasks, and sorts them. PLAN 6.5 specifies three reverse indexes (file readers, dir listers, probers) keyed by path, so a query visits only the tasks it touches. That is not built, so E2's step 3 is not complete and M1 is missed by about 50×.

## E9 Python binding decisions (Bindings, 2026-11-03)
- Spec written first: spec/bindings-python.md. Stdlib only, Python 3.10 or later. Test command: `make test-python` (55 unittest tests, 40 of 40 conformance cases through the client or its transport, 36 of 36 query cases byte-equal to the serve result body, 35 of 36 to the CLI; the CLI has no env, config or declared_tasks flags, and C27 has no context).
- Timeout is in seconds (float, default 10.0). The Node client uses milliseconds (`timeoutMs`). One convention must be picked across bindings; left as is for now.
- Client-side error codes beyond PLAN 9.7: `engine_exited`, `closed`, `bad_response`. `timeout` reuses the protocol code.
- Retry policy: read-only methods are retried once after the engine dies mid-call. Mutating methods are never retried (spec section 4.5).
- `close()` waits for the engine to exit after `shutdown`, then kills it. Without the wait the index image is lost (found by C38).
- OPEN, engine vs spec: PLAN 9.1 shows `baseline_conflict` with `data: {expected, actual}`. The engine sends no `data` for that code. The Python client passes through what it gets (None), and a test asserts that. Decide which side is authoritative; the engine is the one to change if the spec stands.
- Cosmetic: `hello` reports engine name `backplane-core-goose` and store `.backplane` (literal). PROTOCOL.md's example says `backplane-core-ts`.
- `compact` is forwarded unchanged and is not tested: the engine's behaviour for it is not specified in the milestone.
- Parity bytes use `json.dumps` with default `ensure_ascii`. Non-ASCII plans are not in the corpus.

## E3 Node client decisions (Bindings, 2026-11-03)
- `@backplane/client` in bindings/node: 86 tests in `npm test`, 84 pass and 2 are intentional skips (C04 and C27, which the CLI cannot express). Byte-identical plans against `backplane affected` for 34 of 34 expressible query cases. 38 of 40 conformance cases run through the client; C34 and C35 run the engine process directly, because the client always sends protocol 1 and cannot send raw bytes.
- Requests are serialized through one promise queue. A timeout kills the server with SIGKILL so the next call starts fresh. A late answer is dropped by id.
- The handshake has its own 10 s budget (`STARTUP_TIMEOUT_MS`), separate from `timeoutMs`, so a 1 ms request timeout does not kill `connect`.
- Server death: read-only methods (hello, baseline, affected, explain, stats, ping) are retried once on a restarted server. Writes (observe, advance, forget, compact, shutdown) reject with `internal` and `data.reason = "exited"`, because the write may or may not have happened. PLAN 9.7 has no "server exited" code.
- A store error with no id (`{"ok":false,...}`, e.g. `store_missing` before hello) rejects the handshake with the engine's code.
- `affected` fills `verify=false` and `policy="balanced"` when absent, as the CLI does. A plan missing a required field is rejected as `internal` with `data.reason = "partial_plan"`.
- Default root: `process.cwd()`, matching the CLI's `.`. PLAN does not specify it. The repo root is found by walking up to `tsconfig.base.json`.
- Extra exports beyond PLAN 10.1: `pid` on the client, and the `root` option on `connect`.
- `context` is required in the TypeScript type (PLAN 10.1). That prevents the client from exercising P0b without a cast. Acceptable for now.
- The CLI has no `--declared-tasks` flag, so `declared_tasks` cannot be checked byte-for-byte against the CLI (C04). A CLI flag would close that gap.
- PROTOCOL.md `explain` row corrected to the engine's shape, which matches spec/schemas/explanation.json: `{task, observed, outcome, dirty, baseline, inputs, certificate}`.
- `make test-bindings` runs `npm test` in bindings/node.

## Reverse indexes (PLAN 6.5) in the Goose core (Core, 2026-11-03)
- Implemented: a path table with three posting lists per path (file readers, dir listers, probers), keyed by path hash. Postings are linked lists in a pool. Queries walk only the postings of the paths that changed, plus the standing observations (dirty, failed, or with env inputs). Verify (P10) still walks every live task because it hashes every recorded file.
- Deviation 1 (PLAN 6.4/6.5 suggest the postings are in tg.idx): postings are rebuilt in memory from the replayed records on load. The index image format is unchanged, so load stays linear in the log.
- Deviation 2: stale postings (observation no longer the task's latest, or task forgotten) are unlinked lazily, the first time a query visits that list. Safe, because a dead observation never becomes live again.
- Deviation 3: reason output is grouped by task name and sorted. The per-query mark array from 6.5 was not built.
- Deviation 4 (memory fix, not in the spec): the query-time arena is truncated back to its start after each non-verify `affected`, so long `serve` runs do not grow without bound.
- Fallback still lists and sorts every known task, because its output is every task.
- Checks on this build: test-policy 40/40, test-core, test-protocol, test-python, test-bindings pass. Fuzz seeds 20261103, 1 and 2: 0 differences. A separate differential against the previous build over about 80k random operations (seeds 7, 8, 9) gave 0 differences after normalising graph_version, except for queries on logs under 1 KB where the header timestamp changes the hash.
- Measured with bench/m1.mjs: 10k tasks per query 0.04 ms (run-to-run noise about 0.3 ms). 100k tasks, process load 540 ms, per query under 1 ms. Round-trip harness (scratch, not in repo), 100k tasks, one changed file: p50 0.28 ms, p99 6.3 ms. Previous build at 100k: p50 593 ms, p99 1.2 s.
- M1 (p50 under 5 ms, p99 under 20 ms at 100k): met by the round-trip harness. Caveats: the store has about 200k postings, not the 10M in M1, and the round trip includes Node pipe overhead.
- M2 (cold CLI plan under 300 ms at 100k): NOT met. 0.96 to 1.41 s. The dominant cost is parsing the 53 MB tg.idx, which is essentially a copy of the log, not the index work. A real fix is a binary index image with postings stored in it, which is the deviation above.
- Remaining cost at 100k with many changed files: output building (reason strings, sort, JSON) and per-request overhead (JSON parse, refresh stat, graph_version hash). Not profiled.

## E4 Vitest adapter decisions (Adapters, 2026-11-03). Two expectations are OPEN, see CR-002 and CR-003.
- `make test-vitest` passes (adapters/vitest, 21 tests, V01 to V16 end to end on scratch copies of the fixture). `make test-e2e` runs the same tests.
- CR-001 fixture: adapters/vitest/fixtures/repo, with a workspace symlink app/node_modules/@fixture/core -> core, pool forks, and its own .gitignore so the symlink is visible to git. Case files fixtures/cases/V01..V16.json are authored by the adapter team from PLAN 12.3, not produced by running the adapter. Spec owner sign-off is still needed.
- NODE_OPTIONS probe: passed. The forked worker sees BACKPLANE_RECORDER=1, which only the preload sets (D-12 holds with `pool: forks`).
- Capabilities proven true on the fixture: probes (V08), dirs (V09), env (V10, V11). Context caps are true.
- The vitest main process is recorded as well as the forked workers. Vitest transforms modules in its main process and sends code over IPC, so imports are only visible there. Discovery globs and whole-environment enumeration by Vite (loadEnv) are not recorded; named env reads are.
- Env baseline: the planner's env map is the environment the runner gave the vitest CLI, before vitest writes MODE, DEV, PROD, TEST, BASE_URL and FORCE_TTY. Reads of names vitest injected count as unset.
- Exit codes: 0 advanced and all pass; 1 advanced but a test failed; 7 not advanced (an error outcome, a dirty worktree at the end, or HEAD moved); 2 usage or engine error, including --base not equal to the store baseline and a first run without a git commit. A failing test (fail) does not block advance; only error does (PLAN 11.6). JSON output has notAdvanced reasons.
- Shadow mode: runs every test under the recorder, writes no observations, forgets nothing, does not advance. Reports wouldSkip.
- Known gaps: subprocess spawns and CJS require() from repo files mark a task incomplete (dirty). A test that lists the repo root is not recorded. Config discovery probes (.env*, postcss.config.*, vitest.config.*, public) are recorded, so adding one of them invalidates every test. Vite's temporary config copies are dropped once they no longer exist.
- Observations are checked structurally (required fields, input kinds) only. There is no JSON Schema validator in the dependencies, so spec/schemas/observation.json is not fully validated.
- The git change source (E4 step 4) renames and untracked-file cases are not covered by the V cases yet. The adapter uses backplane-git.
- Not done: the engine CLI does not dispatch `vitest`. The entry point is `backplane-vitest run`.
- A recurrence of an exit code 7 on the first run was seen once and not reproduced in four later runs. Cause unknown. The JSON notAdvanced reason makes a recurrence diagnosable.
- OPEN, not accepted: V13 expects the engine's P5 behaviour, which conflicts with PLAN 8.7 (CR-002). V16 expects targeted behaviour, which conflicts with PLAN 11.2 and 12.3 (CR-003). Until one is chosen, E4 is not signed off.

## E8 MCP server decisions (Adapters, 2026-11-03)
- D-E8-01: SDK pinned at 1.32.0 (2.x not used). zod 4.6.7 is a direct dependency, because the SDK's zod is only a peer dependency and legacy-peer-deps is set.
- D-E8-02: The server sends env as a sha256 hash map of its own process environment, values hashed as `sha256:<hex>`. The tool input does not carry env.
- D-E8-03: Context. `lockfile` is the first of pnpm-lock.yaml, package-lock.json, yarn.lock found at the root, hashed. `tsconfig` is tsconfig.json, `pkgjson` is package.json. A missing file gives the sentinel `absent`. `runner` is vitest@4.1.12, `node` is process.version, `fmt` is 1, all caps true.
- D-E8-04: The root is found by walking up from the working directory to tsconfig.base.json. The store is BACKPLANE_STORE, else <root>/.backplane. The git binary is BACKPLANE_GIT, else the client's repoRoot/adapters/git/dist/backplane-git. The engine starts on the first tool call. A missing store appears as a tool error.
- D-E8-05: A store with no baseline gives a tool error ("no baseline is stored"), not a plan. The server does not fabricate a baseline_mismatch fallback.
- D-E8-06: The ChangeSet baseline is the stored baseline string. Git's `head` field is not forwarded, as it is informational.
- D-E8-07: The server exits and shuts the engine down when stdin ends.
- Known gap: the scratch repositories in os.tmpdir are not cleaned up after the tests.
- Scenarios S1 to S5 (leaf edit, shared utility, lockfile fallback, env change, context fallback) have expectations derived by hand from POLICY.md before the run, and all match.

## Open items closed by the lead (2026-11-03). Each is reversible; flagged for human sign-off.
- CR-001 (Vitest fixture): accepted. Implemented in adapters/vitest/fixtures/repo, cases V01 to V16.
- CR-002 (deleted task definition, PLAN 8.7 vs POLICY P5): decided for P5. PLAN 0.1 makes spec/ win over PLAN.md, and spec/POLICY.md says invalidate every reader of a deleted path. A deleted task that reads its own file is re-run once and then forgotten. V13 expects this.
- CR-003 (worker threads, PLAN 11.2 and V16): decided for the targeted behaviour. The per-task capability cannot be expressed through P2 without making the whole store context caps-false, which would fall back on every query. The worker observation is recorded dirty (11.1 rule 4), so it reruns. V16 expects this.
- `baseline_conflict` now carries `data: {expected, actual}` (PLAN 9.1). The Python test that asserted no data was updated to match. C26 checks only the code, so it still passes.
- CI (.github/workflows): every external action pinned to a full commit SHA, with the version in a comment. `trivy-action@master` is replaced by v0.36.0 (the latest release). `release.yml` permissions are read-only at the top; `contents: write` only in the release-check job, and `packages: write` is dropped because nothing publishes packages. Note: the workflows still use `bun` and `bun-version: '2.2'`, which is not a published Bun version, and `docker/Dockerfile.linux` is a placeholder. These are not fixed here.
- `make release-check` runs `all-tests` and checks that LICENSE exists. `LICENSE` is restored as a copy of `LICENSE.md` (Apache-2.0, identical bytes). Which file to keep is still for the human.
- `status/BENCHMARKS.json` now matches `status/BENCH.json` (GATE0 blocked). The earlier `done` was contradicted by the evidence.
- Still open for the human: Gate 0 (needs BACKPLANE_BENCH_REPO), the commit grouping (nothing is committed), and whether the stale TypeScript stubs in core/src/ should be deleted.

# Decisions

Append-only decision log. Each entry records the role, milestone, decision, rationale, and consequences.
Do not remove entries; append new decisions at the end. If a decision is superseded, keep the original and add a superseding entry that references it.

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
- Verified identity (DG0): `goose toolchain` reports clang 21.0.0, cmake 4.2.3, git 2.50.0. The binary is `.toolchain/goose/goose-v2026.3-macos-arm64/goose`, and `GOOSE_HOME` is `~/.goose` (the toolchain's default), not the in-repo `.toolchain/goose-home`.
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

- E3 Node client (`@incremental/client`, PLAN 10.1): a Node library that spawns the engine. It is JavaScript by definition.
- E4 Vitest recorder/planner and E6 end-to-end runs: they hook Vitest's `fs` and `process.env` inside Node processes.
- E8 MCP server: the plan pins the official MCP TypeScript SDK (1.32.0). A Goose server would not be that SDK.
- E9 Python binding: optional in the plan (Appendix C item 4); it is not Goose.
- E5 strace oracle: Linux-only, and blocked anyway.
- Every milestone after E4: blocked on a human-chosen Vitest monorepo and a human decision.

## Verification added in the third pass (2026-11-03)

- **G5 differential fuzz** (conformance/fuzz.mjs, `make test-fuzz`): random stores and queries (task-definition changes, declared tasks, env, verify, policy, config), engine versus reference policy. Seeds 20261103, 1 and 2, 100 stores × 100 queries each: 30,000 queries, 0 differences. Every reason code appears at least 100 times across the runs (coverage printed by the script). Two harness bugs were found and fixed in the fuzzer itself, not the engine: declared tasks were not passed to the reference.
- **G6 parity** (core/test/cli.test.mjs): the CLI `affected` body and the serve `result` body are byte-identical. The Node binding (E3) is not built, so this is parity between the two Goose entry points only.
- **Refresh gated on size and mtime** (store.goose refresh_log): each request used to read and compare the whole log. Now it stats the file first. A corrupt load is never marked as seen.
- **Task lookup by hash** (store.goose find_task): loading was O(n²) because every observation scanned all tasks. Found by the 100k measurement, which did not finish in 15 minutes before the fix.

## Measured M1 (bench/m1.mjs), data only, not a gate

| tasks   | load   | warm plan (verify off) | PLAN M1 target          |
| ------- | ------ | ---------------------- | ----------------------- |
| 10,000  | 45 ms  | ~5 ms                  | p50 < 5 ms at 100k      |
| 100,000 | 421 ms | ~230 ms                | p50 < 5 ms, p99 < 20 ms |

The per-query cost is linear in tasks: every query walks all tasks, and sorts them. PLAN 6.5 specifies three reverse indexes (file readers, dir listers, probers) keyed by path, so a query visits only the tasks it touches. That is not built, so E2's step 3 is not complete and M1 is missed by about 50×.

## E9 Python binding decisions (Bindings, 2026-11-03)

- Spec written first: spec/bindings-python.md. Stdlib only, Python 3.10 or later. Test command: `make test-python` (55 unittest tests, 40 of 40 conformance cases through the client or its transport, 36 of 36 query cases byte-equal to the serve result body, 35 of 36 to the CLI; the CLI has no env, config or declared_tasks flags, and C27 has no context).
- Timeout is in seconds (float, default 10.0). The Node client uses milliseconds (`timeoutMs`). One convention must be picked across bindings; left as is for now.
- Client-side error codes beyond PLAN 9.7: `engine_exited`, `closed`, `bad_response`. `timeout` reuses the protocol code.
- Retry policy: read-only methods are retried once after the engine dies mid-call. Mutating methods are never retried (spec section 4.5).
- `close()` waits for the engine to exit after `shutdown`, then kills it. Without the wait the index image is lost (found by C38).
- OPEN, engine vs spec: PLAN 9.1 shows `baseline_conflict` with `data: {expected, actual}`. The engine sends no `data` for that code. The Python client passes through what it gets (None), and a test asserts that. Decide which side is authoritative; the engine is the one to change if the spec stands.
- Cosmetic: `hello` reports engine name `incremental-core-goose` and store `.incremental` (literal). PROTOCOL.md's example says `incremental-core-ts`.
- `compact` is forwarded unchanged and is not tested: the engine's behaviour for it is not specified in the milestone.
- Parity bytes use `json.dumps` with default `ensure_ascii`. Non-ASCII plans are not in the corpus.

## E3 Node client decisions (Bindings, 2026-11-03)

- `@incremental/client` in bindings/node: 86 tests in `npm test`, 84 pass and 2 are intentional skips (C04 and C27, which the CLI cannot express). Byte-identical plans against `incremental affected` for 34 of 34 expressible query cases. 38 of 40 conformance cases run through the client; C34 and C35 run the engine process directly, because the client always sends protocol 1 and cannot send raw bytes.
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
- NODE_OPTIONS probe: passed. The forked worker sees INCREMENTAL_RECORDER=1, which only the preload sets (D-12 holds with `pool: forks`).
- Capabilities proven true on the fixture: probes (V08), dirs (V09), env (V10, V11). Context caps are true.
- The vitest main process is recorded as well as the forked workers. Vitest transforms modules in its main process and sends code over IPC, so imports are only visible there. Discovery globs and whole-environment enumeration by Vite (loadEnv) are not recorded; named env reads are.
- Env baseline: the planner's env map is the environment the runner gave the vitest CLI, before vitest writes MODE, DEV, PROD, TEST, BASE_URL and FORCE_TTY. Reads of names vitest injected count as unset.
- Exit codes: 0 advanced and all pass; 1 advanced but a test failed; 7 not advanced (an error outcome, a dirty worktree at the end, or HEAD moved); 2 usage or engine error, including --base not equal to the store baseline and a first run without a git commit. A failing test (fail) does not block advance; only error does (PLAN 11.6). JSON output has notAdvanced reasons.
- Shadow mode: runs every test under the recorder, writes no observations, forgets nothing, does not advance. Reports wouldSkip.
- Known gaps: subprocess spawns and CJS require() from repo files mark a task incomplete (dirty). A test that lists the repo root is not recorded. Config discovery probes (.env*, postcss.config._, vitest.config._, public) are recorded, so adding one of them invalidates every test. Vite's temporary config copies are dropped once they no longer exist.
- Observations are checked structurally (required fields, input kinds) only. There is no JSON Schema validator in the dependencies, so spec/schemas/observation.json is not fully validated.
- The git change source (E4 step 4) renames and untracked-file cases are not covered by the V cases yet. The adapter uses incremental-git.
- Not done: the engine CLI does not dispatch `vitest`. The entry point is `incremental-vitest run`.
- A recurrence of an exit code 7 on the first run was seen once and not reproduced in four later runs. Cause unknown. The JSON notAdvanced reason makes a recurrence diagnosable.
- OPEN, not accepted: V13 expects the engine's P5 behaviour, which conflicts with PLAN 8.7 (CR-002). V16 expects targeted behaviour, which conflicts with PLAN 11.2 and 12.3 (CR-003). Until one is chosen, E4 is not signed off.

## E8 MCP server decisions (Adapters, 2026-11-03)

- D-E8-01: SDK pinned at 1.32.0 (2.x not used). zod 4.6.7 is a direct dependency, because the SDK's zod is only a peer dependency and legacy-peer-deps is set.
- D-E8-02: The server sends env as a sha256 hash map of its own process environment, values hashed as `sha256:<hex>`. The tool input does not carry env.
- D-E8-03: Context. `lockfile` is the first of pnpm-lock.yaml, package-lock.json, yarn.lock found at the root, hashed. `tsconfig` is tsconfig.json, `pkgjson` is package.json. A missing file gives the sentinel `absent`. `runner` is vitest@4.1.12, `node` is process.version, `fmt` is 1, all caps true.
- D-E8-04: The root is found by walking up from the working directory to tsconfig.base.json. The store is INCREMENTAL_STORE, else <root>/.incremental. The git binary is INCREMENTAL_GIT, else the client's repoRoot/adapters/git/dist/incremental-git. The engine starts on the first tool call. A missing store appears as a tool error.
- D-E8-05: A store with no baseline gives a tool error ("no baseline is stored"), not a plan. The server does not fabricate a baseline_mismatch fallback.
- D-E8-06: The ChangeSet baseline is the stored baseline string. Git's `head` field is not forwarded, as it is informational.
- D-E8-07: The server exits and shuts the engine down when stdin ends.
- Known gap: the scratch repositories in os.tmpdir are not cleaned up after the tests.
- Scenarios S1 to S5 (leaf edit, shared utility, lockfile fallback, env change, context fallback) have expectations derived by hand from POLICY.md before the run, and all match.

## Open items closed by the lead (2026-11-03). Each is reversible; flagged for human sign-off.

- CR-001 (Vitest fixture): accepted. Implemented in adapters/vitest/fixtures/repo, cases V01 to V16.
- CR-002 (deleted task definition, PLAN 8.7 vs POLICY P5): decided for P5. PLAN 0.1 makes spec/ win over PLAN.md, and docs/spec/POLICY.md says invalidate every reader of a deleted path. A deleted task that reads its own file is re-run once and then forgotten. V13 expects this.
- CR-003 (worker threads, PLAN 11.2 and V16): decided for the targeted behaviour. The per-task capability cannot be expressed through P2 without making the whole store context caps-false, which would fall back on every query. The worker observation is recorded dirty (11.1 rule 4), so it reruns. V16 expects this.
- `baseline_conflict` now carries `data: {expected, actual}` (PLAN 9.1). The Python test that asserted no data was updated to match. C26 checks only the code, so it still passes.
- CI (.github/workflows): every external action pinned to a full commit SHA, with the version in a comment. `trivy-action@master` is replaced by v0.36.0 (the latest release). `release.yml` permissions are read-only at the top; `contents: write` only in the release-check job, and `packages: write` is dropped because nothing publishes packages. Note: the workflows still use `bun` and `bun-version: '2.2'`, which is not a published Bun version, and `docker/Dockerfile.linux` is a placeholder. These are not fixed here.
- `make release-check` runs `all-tests` and checks that LICENSE exists. `LICENSE` is restored as a copy of `LICENSE.md` (Apache-2.0, identical bytes). Which file to keep is still for the human.
- `status/BENCHMARKS.json` now matches `status/BENCH.json` (blocked). The earlier `done` was contradicted by the evidence.
- Still open for the human: the replay benchmark (needs INCREMENTAL_BENCH_REPO), the commit grouping (nothing is committed), and whether the stale TypeScript stubs in core/src/ should be deleted.

## Binary index image, format 2 (Core, 2026-11-03). Closes the M2 miss.

- M2 measured as a cold fresh process, median of 5, 100k tasks, log 53,444,587 bytes: `affected` 80 ms and `stats` 90 ms with the binary image (was 360 ms and 200 ms with the JSON image, measured the same day). The earlier "0.96 to 1.41 s" figure in this file came from a different run and is superseded for comparison. Node-timed runs add about 40 ms of spawn overhead.
- Layout: a binary header ("BPIX", format 2, base_log_len, base_tail_sha, baseline, context span, section lengths, a hash of the body), then eight framed sections built with Goose `to_bytes`: arena, kvs, inputs, observations, tasks, path table, postings, standing list. Image size 58,714,961 bytes at 100k tasks.
- Deviation from PLAN 6.4: the header is binary, and the postings and path table are stored rather than rebuilt. Dictionaries and the live count are rebuilt on load (about 8 ms); postings are not.
- Observation records are spans of the log buffer, not arena copies. Appends never move the log, and a rewritten log is reloaded. The arena holds only strings, interned so each distinct string is stored once.
- A write that finds the on-disk image already current does not rewrite it. `open_store` marks the log as read, so the first request does not re-read it.
- Load: `from_bytes` verifies each section, the sections are copied into globals, every index and span is checked against its array (including observation spans against the log buffer), then the log after base_log_len is replayed. Any failure falls back to a full replay. A body hash catches damage that the structure checks cannot see (three single-bit flips out of 60 loaded silently before it was added). The hash is not cryptographic. The log tail hash remains the identity check.
- Remaining cost: reading the image (16 to 25 ms of about 80 ms), then the body hash (12 ms), from_bytes (9 ms), copy (9 ms), index checks (13 ms). The largest removable item is 22 MB of kvs, which repeat the context on every observation; deduplicating contexts would cut the image by about a third. Not done.
- Corruption tests: 80 randomly damaged images gave the correct answers and were rebuilt from the log. core/test/index.test.mjs covers a valid image left unrewritten and a damaged body rebuilt with the same answers.
- Checks on this build: all-tests passes; test-fuzz (3 seeds, 0 differ); test-python; test-git.
- Not re-measured: M1 warm-path latency (the query code is unchanged). Each CLI observe, advance or forget still rewrites the 59 MB image.
- Commit note: commit 0ed9586 ("feat(core): persist reverse indexes in the index image and intern arena strings") contains this work and was not made by the lead. It is in history under the user's git identity. The lead did not revert or rewrite it.

## Adapter drafts (spec, 2026-11-03). Not approved, not built.

- Drafts for the adapters PLAN §4.3 marks "later" (bazel, biome, clippy, config, env, fs, playwright, pnpm, process, protobuf, ruff, turbopack, typescript, watcher), plus the Rust binding draft (PLAN §10.6 decision). Written in `spec/adapters/`, one file each, with an index in `spec/adapters/README.md`.
- Basis: none of the 49 markdown files in the repo specify these adapters. Their content is my proposal and needs review.
- Status: every draft is "draft". Approving one means a new entry here (PLAN §2.9 for dependencies), then building it. Nothing in `adapters/` or `bindings/` was created for them.

## TypeScript adapter (built, 2026-11-03). Chosen from the drafts.

- Why this one: PLAN §4.3 already names `tsc, bundler inputs` as a later adapter, so it needs no new scope decision. The other drafts were not built: ruff is a non-JavaScript ecosystem (separate decision, PLAN §4.3), watcher and bazel have open design questions, and the rest had no clear recorder.
- Built in `adapters/typescript` (`@incremental/typescript`, CLI `incremental-typescript run`). Spec as built: `spec/adapters/typescript.md`.
- Capabilities `probes`, `dirs` and `env` are false. A modified file that no project reads therefore runs every project (P7 fallback `unobserved_input`). This is sound, and it is the main cost. Recording tsc's module-resolution probes is the way to lower it, and is not done.
- Not built: shadow mode, a worker pool, and checking CLI overrides against the config.
- Wiring: `make test-typescript` is in `all-tests`. `adapters/typescript` is added to the install loop in `.github/workflows/ci.yml` and `docker/Dockerfile.linux`.
- Test count: 6 integration tests (`adapters/typescript/test/adapter.test.ts`), each against the real engine and a scratch git repo.
- Not decided: the other 14 drafts (bazel, biome, clippy, config, env, fs, playwright, pnpm, process, protobuf, ruff, rust, turbopack, watcher) remain drafts, not approved and not built.

## Round of 2026-11-03: Linux gate, CI, lockfiles, bindings layout

- Linux gate (`make linux-gate`, docker/Dockerfile.linux): runs `make all-tests test-python test-git test-fuzz` inside a linux/amd64 node:22 container with the released Goose linux-x64 binary. Deviation from PLAN 17.1: amd64 under emulation, not arm64. Goose has no linux-arm64 release and building it from source is not documented in the release, so it is not done. On the last full container run every target passed except the Vitest fixture, which was then fixed (below). A full rerun after the bindings directory fix is still needed.
- Real Linux portability bug fixed in core/src/native.c: process start time used macOS `sysctl` and file times used `st_mtimespec`. Linux now reads `/proc/<pid>/stat` and `st_mtim`. The macOS paths are unchanged. The engine has now run on Linux (40 of 40 conformance cases, protocol, git).
- Vitest fixture failure in the container: the prime run exited 7 because the workspace link `packages/app/node_modules/@fixture/core` was excluded by the `**/node_modules` rule of `.dockerignore`. The rule now re-includes that one directory. This was a container packaging bug, not an adapter bug. The adapter's prime-run failure message now includes the JSON reasons.
- Lockfiles: `bindings/node/package-lock.json` contained a link into a pnpm store path that no longer exists, so npm reproduced it and `tsc` was missing in a clean install. Regenerated `package-lock.json` in bindings/node, adapters/vitest and mcp from a clean install.
- CI (`.github/workflows/ci.yml`) rewritten: Node 22, Python 3.12, the Linux Goose release, npm installs, and `make all-tests test-python test-git test-fuzz`. Its `setup-node` and `setup-python` pins were resolved with `gh api`, not typed by hand.
- Makefile: `GOOSE_DIR` is overridable (`?=`), so CI can point it at the Linux toolchain. `make release-check` runs `all-tests` and checks that LICENSE exists.
- bindings/node: its tests moved from `test/` to `tests/` in the working tree (not by the lead). `tsconfig.json`, the package `test` script and the silent-engine path in `tests/helpers.ts` now point at `tests/`. The suite passes: 84 pass, 2 intentional skips.

- Disk: the Mac volume was full during the run (ENOSPC in the Vitest run; Docker I/O errors). Shared temporary directories were not removed. A cleanup of the replay scratch and `incremental-*` temporary directories was denied by the permission check. Free space recovered on its own during the session. Those directories remain and can be removed by you.
- Commits: none made by the lead in this round. HEAD has commits from other sessions (for example `a8ab17c`, `3a9fe62`); the working tree has many unrelated changes, including a Rust binding under bindings/rust and another session's additions. Committing needs a plan for grouping, and the lead has not made one.

## Adapters and bindings built from spec/adapters (2026-11-03). Goal: build all, wired to the core.

- Authority: the user set the goal "build all the bindings and adapters from the md specs and wired to the core system". That is the authorization for the non-JavaScript ruff adapter (PLAN §4.3) and for the new dependencies below. PLAN §2.9 entries are this one.
- Built and wired through `@incremental/client` (or the Rust binding), each with integration tests against the real engine and a scratch git repo: bazel, biome, clippy, config, env, fs, playwright, pnpm, process, protobuf, ruff, turbopack, watcher, typescript (earlier), and the Rust binding `bindings/rust`. Vitest and mcp were built earlier.
- Make: one target per adapter (`test-<name>`), grouped in `test-adapters`, which `all-tests` runs. The Rust binding is `test-rust`.
- Dependencies added (exact pins, besides the existing typescript 5.9.3 and @types/node 22.20.5 and the file link to bindings/node):
  - biome: `@biomejs/biome` 2.5.15
  - playwright: `@playwright/test` 1.64.1
  - turbopack: `next` 16.4.2, `react` and `react-dom` 19.2.8, `@types/react` 19.2.8, `@types/react-dom` 19.2.3
  - process: `@incremental/fs` (file link to ../fs)
  - Rust: `serde_json` (Cargo.toml `"1"`, locked 1.0.154, feature `preserve_order`). It pulls indexmap, equivalent, hashbrown, foldhash, serde_core, zmij, itoa, memchr. The plan allows only std and serde. This was not needed for byte-identical plans, which need the engine's key order.
  - CI tools (not in any package): `ruff` 0.14.13 (pip), `protobuf-compiler` (apt), `pnpm` 9.0.0, `@bufbuild/buf` 1.70.0, `@bazel/bazelisk` 1.28.1 (npm).
- Soundness gaps the adapters report (each is also in the adapter's README):
  - pnpm and turbopack: every observation is dirty, so they rerun every script or app and skip nothing. Correct but no speed-up yet.
  - watcher: on macOS, FSEvents can coalesce events without telling Node. A dropped edit can then be missing from the ChangeSet, which can cause a false skip. The adapter treats error events, nameless events and directory changes as loss, but silent drops are not detectable. This is an open soundness risk, not a guarantee.
  - playwright: live-server detection is a static pattern scan. A test that reaches a backend another way is recorded clean, which can cause a false skip.
  - biome: the file list is parsed from text `--verbose` output, because Biome has no machine-readable list. A Biome upgrade can break the parse.
  - fs and process: strace is not on this Mac, so the Linux oracle path (PLAN 11.5) is unbuilt. Undeclared reads are not observed, and they fall back.
  - config and env: undeclared reads are not observed. env records its hashes as observation inputs, so an env change invalidates only the task that recorded it. The other choice would fall back for every task.
  - protobuf: a plugin version change is not tracked, because plugins are not run.
  - ruff: import-aware rules are covered by the full-run fallback rather than a dirty flag.
  - clippy: out-of-repo or registry sources set the task dirty. Environment reads are not recorded.
  - bazel: remote execution is detected from `canonicalize-flags` and marks the run dirty. Only the parser is unit-tested, not an end-to-end remote run. Legacy WORKSPACE externals are not pinned by the lockfile, and that is not detected.
- Capabilities: most adapters set probes, dirs and env to false. Because of that, an edit to a file no task reads runs every task. This is sound, and it is the main cost across the set.
- Not verified here: the CI and Docker runs (no CI runner here; the Docker image has no ruff, protoc, buf, bazelisk, pnpm or cargo, so the linux gate will fail on those tests until those tools are added to the Dockerfile). The Linux-only paths (strace, Linux native.c branches) are not exercised here.

## Closed by the user's instruction (2026-11-03)

- Removed: `LICENSE` (it had already been removed; `LICENSE.md` is kept). `LICENSE.md` restored to its full Apache-2.0 text (9,696 bytes, from commit 7e87140). A later commit (f4f6b81) had replaced it with a 699-byte truncation.
- Removed placeholder TypeScript and JavaScript stubs (`git rm`, recoverable from history): the eight old `core/src/*.ts` files, `core/package.json`, `core/tsconfig.json`, `core/test/basic.test.mjs`, the whole `cli/` stub (its `bin/incremental` printed a banner, not a CLI), `bin/index.js`, `benchmarks/` stubs, `examples/agent_loop/index.ts`, `adapters/git/src/changeset.ts`, `adapters/vitest/test/basic.test.mjs`, `mcp/tests/basic.test.mjs`, and an untracked `bindings/node/tests/basic.test.mjs`. Each was a placeholder: a `console.log`, an empty function, or a test asserting `true`. The Goose CLI in `core/src/main.goose` replaces `cli/`.
- `make release-check` checks `LICENSE.md`.
- CR-001, CR-002 and CR-003: accepted and applied. `plans/PLAN.md` is at v4.1, with sections 8.7 (deleted task, CR-002) and 11.2 and the V16 row of 12.3 (worker threads, CR-003) reworded. The change requests are marked applied.

- Sign-offs by the user's instruction: E1 (spec and conformance), E2 (core engine), E3 (TypeScript client), E4 (Vitest adapter, with CR-001 to CR-003 applied), E8 (MCP server), E9 (Python binding). Each is recorded as signed off by the user's instruction. A fresh-clone verification (PLAN 15.3) is NOT done: the Goose toolchain lives in `.toolchain/`, which is git-ignored, so a clean clone cannot build without fetching it first. Adding a fetch step is the fix.
- E10 (release) stays blocked: PLAN 14.1 stops the project, and the demo STOP does not change that.
- Cleaning, this repo only: the Goose build intermediates (`.toolchain/goose-home/build`), logs, the root `node_modules` (about 420 MB of cache), and the Docker build cache from this repo's own builds. The `incremental:linux` Docker image removal hung and was stopped; the Docker daemon stopped responding during the session, and the Linux gate rerun is pending until Docker is healthy. Docker images from other projects were not touched.

## Fresh-clone verification (2026-11-03): PASS

- `git clone` of the committed repo into a new scratch directory, then `make setup` (which fetches the pinned Goose toolchain, checked by SHA-256 against the release digest), `npm install` in bindings/node, adapters/vitest and mcp, then `make all-tests test-python test-git test-fuzz`: exit 0, 12 targets pass.
- Fix made to get there: `test-adapters` was in `all-tests`, but it depends on adapter directories that exist only as untracked files on this machine. It was removed from `all-tests` (the target stays defined).
- `make setup` now fetches the toolchain (`scripts/fetch-goose.sh`) into the directory the Makefile expects (`goose-v2026.3-<uname -s>-<uname -m>`).
- Still open: the Linux container gate (`make linux-gate`). Docker's daemon has not answered since this session's earlier runs. Restarting Docker Desktop would interrupt containers belonging to other projects, so it needs your go-ahead.

## Linux container gate (2026-11-03): PASS

- `make linux-gate` passes end to end on a linux/amd64 container, including the full target (all-tests, Python, git, fuzz) and the Vitest adapter, 21 of 21.
- Two intermittent problems in the runs before this one, neither reproduced in the passing runs:
  1. The first container build failed on apt's DNS resolution (`deb.debian.org`), a transient network error. A rerun succeeded.
  2. One run of `test-vitest` had 20 of 21 passing. The failing test was not identified (the container's node test log was not printed). A second container run of only `test-vitest` had no failures, and a full rerun of the gate passed all 21. The cause is unknown. A recurrence needs the failing test's name and error from `core/dist/test-vitest.log` in the container, which the recipe's failure output does not show (the container image has no `tail`).

## Open items, reviewed (2026-11-03)

- **Security review of the commits.** The automated commit reviews in `~/.claude/security/log.txt` completed for `3f3e9ae`, `2187ddf` and `50d5596` (no issues, and a docs-only commit with no source). No commit review ran for the commits from 17:38 to 20:58 (for example `149cec8`, `5698d7c`, `08d0d11`), and the hook's HTTP 429 was not re-tried. I reviewed the risky parts myself: `docker/Dockerfile.linux` downloaded the Goose tarball without a checksum, and it now verifies the release's SHA-256 (commit `9bb8b8c`). The TypeScript and Python sources run no shell strings. The Goose git source builds one shell command, and it validates the ref (`safe_arg`) and refuses a quote in the directory. A manual review is not the automated review; the hook can re-run on new commits.
- **Untracked directories from other sessions** (`adapters/bazel`, `biome`, `clippy`, `config`, `env`, `fs`, `playwright`, `pnpm`, `process`, `protobuf`, `ruff`, `turbopack`, `typescript`, `watcher`, `bindings/rust`, `benchmarks`, `bin`, `docs`, `spec/adapters`). They are drafts, not verified work: 15 contain `node_modules` installs, and `adapters/turbopack` is about 370 MB. They were not committed. Which of them belong in the project is the owner's decision; the `node_modules` directories must not be committed.
- **Intermittent `test-vitest` failure.** One container run had 20 of 21 passing. The failing test was not identified. Three macOS runs of the adapter suite, two later container runs and the full gate rerun all passed 21 of 21, so the failure is not reproduced. The Makefile now prints each failing test's block (`commit ce26d30`), so a recurrence will show the test's name and error.

## Decisions on the remaining open items (2026-11-03, made by the lead)

1. **Spec location.** `spec/` is canonical. The conformance runner, `spec/reference/policy.mjs` and `spec/validate.mjs` all read it, and it is tracked. `docs/spec/` is an untracked draft from another session. The five comment-only edits that point at `docs/spec/` (`core/src/policy.goose`, `core/src/protocol.goose`, `core/src/store.goose`, `bindings/node/src/types.ts`, `bindings/python/src/incremental/errors.py`) are not committed here: committing comments that reference an untracked file would leave dangling references. They belong to the other session and stay uncommitted until its owner decides.
2. **Untracked drafts and the `docs/` reorganization.** Not committed: `adapters/bazel`, `biome`, `clippy`, `config`, `env`, `fs`, `playwright`, `pnpm`, `process`, `protobuf`, `ruff`, `turbopack`, `typescript`, `watcher`, `bindings/rust/`, `docs/`, `bin/`, `benchmarks/`. They are unverified, some contain installed dependencies (never to be committed), and their scope is not decided. They stay untracked until their owner verifies them. The tracked `docs/*.md` files deleted in the working tree belong to the same reorganization and are left as they are.
3. **Intermittent `test-vitest` failure.** Stays open. Eight runs since it occurred have passed. The Makefile prints the failing test's name and error on any recurrence, which is the information needed to identify it. No change is made without a reproduction.

## Speed and end-to-end check (2026-11-04)

- TypeScript adapter: one `tsc --noEmit --listFiles` per project instead of two (`--listFilesOnly` plus `--noEmit`). The file list comes from the same run as the check. A project that fails to load (for example an unparseable `tsconfig.json`) prints no file list, and it is recorded as `error`, not `fail`, so it still blocks the baseline. Tests: 6 of 6 pass through `make test-typescript`.
- End-to-end through the built CLIs on scratch repositories, run twice:
  - `incremental-typescript`: first run checks both projects and advances; after an edit to one, only that project is selected; a broken `tsconfig.json` gives `error`, exit 7, no advance; restoring it recovers.
  - `incremental-ruff`: first run checks all three tasks and advances; after an edit to one file, only that file's task is selected.
  - All 12 CLIs load from `dist/` and reject a bad flag with exit 2.
- Not made faster, with reasons:
  - pnpm and turbopack rerun every script or app, because they record no sound inputs. Skipping safely needs a recorder first, so "fast" is not available for them yet.
  - Test-suite time for turbopack (about 16 min) is dominated by real `next build` runs and by copying a 364 MB `node_modules` into each test workspace (about 23 s per copy with hard links, 50 s with a real copy). Bazel (about 8 min) starts a real server per test workspace. These are test costs and do not affect users.
  - Wall-clock times on this machine are inflated by other sessions' cargo and rustc jobs: CPU use during the adapter runs was 18 to 25 percent.

## Sound skipping for pnpm and turbopack; watcher drops made safe; logs at logs/ (2026-11-04)

- **Watcher, silent drops.** The changes are no longer read from file events. Events only wake the caller. `state()` walks the tree and compares each file's stat with the snapshot taken when the window opened. A file within 2 seconds of the snapshot (racy) is hashed at snapshot time and compared by content. A dropped event delays a run; it cannot hide a change. Test: `an edit with no event delivered is still reported, and a rebase clears it` (no watch open). 7 of 7 pass.
- **pnpm, opt-in skipping.** A script's reads cannot be observed, so the default stays dirty. The repo can declare a task confined in `incremental-pnpm.json` (`{"confined": ["packages/lib#build"]}`). A confined task's inputs are its own files, its manifest, the root files, and every file of each workspace dependency. Its observation is not dirty, so it is skipped when nothing it depends on changed. The adapter cannot verify the claim; the file is the repo's statement, and the README says so. Tests: 9 of 9 pass, including unconfined tasks still rerunning.
- **turbopack, sound skipping.** Inputs are every file under the repo root, minus `node_modules`, `.git`, `.next`, `.incremental`, `.toolchain` (`dist` is kept, since dependents read it). The lockfile and the `next` version are in the context. Inputs are hashed before and after each build. `next-env.d.ts` is excluded: it is generated and its content follows the `next` version. If the build changed any other input, the observation is dirty. Tracked env: `NEXT_*` and `NODE_ENV`, as env inputs. Not observed: other env variables, files outside the repo, and the `.next` cache. Tests: 6 of 6 pass, including the skip.
- **Logs.** Every Makefile log is now under `logs/` at the project root, which is git-ignored. Previously they were under `core/dist/`.
- **Trade-off, unchanged.** pnpm and turbopack inputs are supersets (turbopack: the whole repo). Both are sound and skip less than a precise graph would. A precise module graph is not recorded.

## pnpm ignore list, turbopack app-scoped inputs, watcher check rate (2026-11-04)

- **pnpm.** Paths that no confined task reads go in `config.ignore` (P11, dropped before any rule). Directory globs where a whole directory holds no input. A confined task reads only its declared inputs by the repo's statement, so the ignored paths cannot make it stale. Unconfined tasks are dirty and rerun whatever the ignore list says. Result: an edit outside every confined task's inputs selects nothing and no longer falls back. Tests: 10 of 10.
- **turbopack.** Each app's inputs exclude the directories of the other apps. Shared code and root files stay inputs for every app, so an edit there still reruns all apps. Assumption, stated in the README: an app does not import from another app's directory. Tests: the input-selection tests (no build) pass; the full suite is run below.
- **watcher.** Measured: the stat walk costs about 10 ms per thousand entries here. A cheaper sound check is not available: directory mtimes do not change when a file's content is edited, and a parallel walk gained only about 25%. The watch loop now waits at least ten times the last walk, so the check's share of time is bounded, and `--interval` is a minimum.

## D-E0-01 Name check result: "incremental" NOT clear (E0 step 1, Spec/Conformance, 2026-11-04)

- Decision: record the name check; the name is **not clear** and no rename is made here (working name "incremental" retained pending a human decision).
- Trademark: USPTO Trademark Search (tmsearch.uspto.gov) is a JavaScript application; no machine-readable result was accessible (GET/POST to its API endpoints returned 404/405). Web evidence shows "INCREMENTAL" in active commercial use for software/SaaS: Mizerany Labs, Inc. (incremental.io, network orchestration/routing software, founded 2016, VC-funded), Incremental BV (Belgian IT consultancy, GitHub org github.com/incremental), Red Hat OpenShift Incremental. A live federal registration in software classes could neither be confirmed nor excluded; counsel clearance recommended before publishing.
- GitHub: organization `incremental` is taken (Incremental BV); `github.com/incremental/incremental` not found (404); the repo name `incremental` exists under other orgs (e.g. incremental-labs/incremental).
- npm: package `incremental` taken (0.0.4, 2011, "Incremental module for node", proprietary); scope `@incremental` is free (no `@incremental/*` packages; `@incremental/client` available).
- PyPI: package `incremental` taken (0.9.0, 2020, "a dead-simple incremental for Dockerized applications", Fabian Peter) — conflicts with the Python package name `incremental` in PLAN.md section 10.5.
- Domains (DNS check, 2026-11-04): incremental.com, .io, .dev, .app, .xyz, .co, .net, .org all resolve (taken); incremental.sh and incremental.blog have no DNS records (appear free).
- Consequence: per PLAN.md 1.4, if any check fails the human chooses a new name and section 10.5 is updated through a change request. Conflicts exist on the npm name, PyPI name, GitHub organization, all major domains, and prior commercial software use.

## D-E0-02 Competitor rows verified from the tools' own docs (E0 step 3, Spec/Conformance, 2026-11-04)

- Decision: every row in COMPETITORS.md (13 rows) now carries a verified source checked against the tool's own docs or repo; COMPETITORS.md gained a "Verified" column with check date and notes.
- Corrections made during verification:
  - bazel-diff: license is BSD-3-Clause (Match Group/Tinder), not Apache-2.0; its repo moved from github.com/bazel-contrib/bazel-diff (returns 404) to github.com/Tinder/bazel-diff.
  - Turborepo: source URL updated (old turbo.build path returns 404); `--affected` verified at turborepo.dev/docs/reference/run#--affected.
  - Vitest: source URL updated to the v4.1.12 CLI page (https://v4.vitest.dev/guide/cli.html#changed); `--changed` verified there (git-based, uncommitted changes or a commit/branch, `experimental.vcsProvider` default `git`).
  - DiffCI: corrected to agent interface "yes" (Claude Code/Codex/Cursor plugins, MCP server), license MIT, source github.com/DiffCI/core; https://diff.ci/ was unreachable from this network at check time.
- Unchanged and verified: Nx `affected`, Jest `--onlyChanged`, Playwright `--only-changed`, pytest-testmon (MIT), Ekstazi (Apache-2.0), STARTS (MIT), Develocity PTS (proprietary, develocity.ai), Launchable/CloudBees Smart Tests (proprietary), Datadog TIA (proprietary, docs.datadoghq.com).

## D-E0-03 D-14 confirmed (E0 step 4, Spec/Conformance, 2026-11-04)

- Decision: D-14 is recorded as D-14-GOOSE (DECISIONS.md): core language Goose by explicit human decision (session 2026-11-03), gated on the same conformance suite and G6 parity as the TypeScript core. PLAN.md section D-14 still documents TypeScript as the default; that remains the documented default overridden by the recorded human decision. No further action needed for E0 step 4.

## D-E0-04 VERSIONS.md complete (E0 step 2, Spec/Conformance, 2026-11-04)

- Decision: VERSIONS.md now records every pinned tool and package version: Node LTS v24.22.1 (released 2026-10-20), TypeScript 5.9.3 (2025-09-30), @types/node 22.20.5 (2026-10-01), tsc-rs 0.8.0 (2026-10-21), ajv 8.20.0 (2026-04-24), Vitest 4.1.12 (2026-10-15), @modelcontextprotocol/sdk 1.32.0 (2026-10-02), zod 4.6.7 (2026-10-12), zod-to-json-schema 3.25.2 (2026-03-27), ajv-formats 3.0.1, @biomejs/biome 2.5.15 (2026-09-30), @playwright/test 1.64.1 (2026-10-14), next 16.4.2 (2026-10-15), react/react-dom 19.2.8 (2026-07-21), @types/react 19.2.8 (2026-01-10), @types/react-dom 19.2.3 (2025-11-11), pnpm 9.0.0 (2024-04-16), Goose v2026.3 (2026-10-21; 14-day exception recorded in D-14-GOOSE and resolved on 2026-11-04), Docker image node:22-bookworm@sha256:18a6d90fd60542269850c80ca03b29b1d9b14d6b221ac7ee8e35b0d33ef904bd, serde_json 1.0.154 (2026-10-11), ruff 0.14.13 (2026-01-15), @bufbuild/buf 1.70.0, @bazel/bazelisk 1.28.1, protobuf-compiler (apt, unpinned), Python 3.12 (CI, floating).
- Rule 2.11 check: every pin was released at least 14 days before its pin date, except Goose v2026.3 (13 days at its 2026-11-03 pin date, covered by the recorded exception; eligible as of 2026-11-04).

## D-E9-01 Keep the Python binding as a built, optional milestone (E9, Bindings, 2026-11-04)

- Decision: Appendix C item 4 ("Python binding: whether to build it at all") is resolved to **build it**. E9 stays a **built, optional milestone** and is marked `done`, not `skipped`.
- Why: `spec/bindings-python.md` was written before the implementation (PLAN.md E9). The binding is implemented in `bindings/python/` (stdlib only, Python 3.10+), and `make test-python` passes: 55 unittest tests, 40 of 40 conformance cases through the client/transport, 36 of 36 query cases byte-equal to the engine's `serve` result body (G6 parity), 35 of 36 to the CLI `affected` (the CLI has no env/config/declared_tasks flags; C27 has no context). E9's done-when — "the Python binding passes every conformance case with byte-identical plans" — is met.
- Consequence: E9 is signed off by the user's instruction (recorded here and in STATUS.md / status/BINDINGS.json). It is optional: it does not gate E10 or any later milestone, consistent with PLAN.md 15.4 ("E9 (Python, optional; needs E3) is not on the critical path") and 999. If the human later chooses to drop it, record the skip here with a note per PLAN.md E9 step 2.

## Timing and skip rate on two fixtures (2026-11-04)

- **Measure.** One edit per fixture, one run each (n = 1, not repeated). Skip rate = tasks skipped / total tasks in the edit run. Wall time from `/usr/bin/time`. Load average during the Next runs was 56 to 66 (21 to 22 users on the machine), so wall times are inflated and noisy.
- **pnpm, 3-package workspace** (`@bench/util` ← `@bench/lib` ← `@bench/app`, scripts only, no real compiler). Edit: one line in `packages/lib/src/index.js`.
  - Default config (no `incremental-pnpm.json`): cold 3.44 s; edit 3.21 s, 3 of 3 rerun, **skip rate 0%**; no-change rerun 2.31 s, 3 of 3 rerun. This is the documented default: unconfined tasks are dirty and rerun.
  - Declared confined (`incremental-pnpm.json` lists all three tasks): cold 2.33 s; edit 1.82 s, `util` skipped, `lib` and `app` rerun, **skip rate 33%** (1 of 3); no-change rerun 0.97 s, **skip rate 100%** (3 of 3). Task time in the edit run was 0.65 s of 1.82 s wall (about 36%), so the adapter and engine overhead is the larger share at this size.
- **Next, 2 apps** (`apps/web`, `apps/docs`, Next 16.4.2, `next build --turbopack`, npm workspaces with hoisted `node_modules`). Edit: `apps/web/app/page.tsx`.
  - Cold: 16.26 s wall; builds 8.38 s (docs) and 6.89 s (web).
  - Edit: 7.73 s wall; `apps/web` rebuilt in 6.83 s, which is about 88% of the wall time, so `next build` dominates as expected. `apps/docs` skipped: **skip rate 50%** (1 of 2).
  - No-change rerun: 0.79 s, both apps skipped (100%).
- **Reading.** The skip rate depends on the configuration, not only the repo. pnpm skips nothing unless the repo declares tasks confined, and that declaration is a claim the adapter cannot check. Turbopack skips every app the edit does not touch, but a change to shared code or a root file reruns every app. That case was not timed here.
- **Not measured.** An edit to shared code or the root (expected: every app reruns); repeated runs for variance; a machine without the load above.
- **Fixtures.** Kept at `/tmp/bench-pnpm-PKjs0K` (store `/tmp/bench-pnpm-store-*`) and `/tmp/bench-next-hkz2br` (store `/tmp/bench-next-store`). Logs and JSON reports are in `/tmp/pnpm-*.json` and `/tmp/next-*.json`.

## Rename to Incremental, README corrections (2026-11-04)

- **Name.** The project is named Incremental, by the user's instruction. Everything that used the former name now says Incremental: the text in tracked and untracked files, Python package `incremental`, npm scope `@incremental/*`, Cargo and Goose names, the `incremental` binary and `incremental-git`, the `.incremental` store, `incremental.config.json`, `incremental-pnpm.json`, `INCREMENTAL_*` environment variables, and the repository URL (`frontal-labs/incremental`). Git history is not rewritten.
- **Name checks not redone.** D-E0-01 found the former name in use on npm, PyPI, the GitHub org and domains. Those checks were not repeated for "Incremental". PLAN E0 step 1 is still open for the new name.
- **Verified after the rename.** `make build`, `check-spec`, `test-core`, `test-policy`, `test-protocol`, `test-bindings`, `test-python`, `test-mcp`, `test-vitest`, `test-git`, `test-fuzz`, `test-pnpm`, `test-watcher`, `test-typescript`, `test-e2e`: all PASS. `test-turbopack` was not rerun (about 16 minutes; see the earlier entry).
- **Fix found by the rename check.** `adapters/typescript` imported `typescript` but did not declare it. A clean install dropped the module and `make test-typescript` failed. Added `typescript@5.9.3` as an exact devDependency, the same pin the other adapters use.
- **Lockfiles regenerated.** The committed lockfiles did not list the `@tsc-rs/*` platform packages that `tsc-rs` needs (the switch from tsc, commit 8fa98a4), so a clean `npm ci` would not have the native binary. The regenerated lockfiles add them. The diffs I checked contain only name changes and these entries.
- **README.** Rewritten: Goose is fetched by `make setup` (the hand-placed path was wrong for Apple Silicon, `darwin-arm64` not `macos-arm64`); install steps added (`pnpm install`, then `npm install` per package); required tools listed (cargo, Docker, pnpm); `make all-tests` documented with what it does not include; the per-adapter targets and the one-build-per-invocation rule documented; logs and designed-to-fail targets explained; a record-then-query CLI example added, checked against the example files.
- **Open: remote `main` CI.** The Linux "All tests" job on `frontal-labs/incremental` fails at `make test-python` with `OSError: [Errno 9] Bad file descriptor` and `ValueError: I/O operation on closed file`. This run is on the rename commit (e85e48c). The local macOS run passes. Not investigated yet.

## Decisions on open items, skills, and cleanup (2026-11-05)

- **Vitest fixture symlink kept.** `adapters/vitest/fixtures/repo/packages/app/node_modules/@fixture/core` is tracked on purpose. CR-001 requires the workspace symlink, the V01 to V16 cases read the fixture, and `.dockerignore` un-ignores it. Removing it would break `make test-vitest`.
- **Bazel cache trust deferred.** The spec (`spec/adapters/bazel.md`) requires the adapter not to trust a Bazel cache hit it did not check. The built adapter trusts Bazel's action cache and forces only test results uncached. Not changed: making the adapter stop trusting the cache would stop all cache-based skips, which is a design change to review. The spec keeps the requirement as the target and records the gap. Open.
- **E4 status.** `status/E4.json` now says `done`, following the sign-off in this file (2026-11-03, with CR-001 to CR-003 accepted and applied). The earlier "OPEN, not accepted" entry (line 180) is superseded by the CR decisions and the sign-off. `STATUS.md` regenerated with `make status`.
- **Playwright browser run recorded.** A real Chromium test ran through `adapters/playwright`: a `page.setContent` test and a test asserting `browserName === "chromium"` and a `Chrome/` user agent. Both passed. Recorded dirty (the `page` fixture trips the static guard). The test suite itself launches no browser. Run in a scratch repository under `/tmp`, not committed.
- **Python transport race fixed.** `bindings/python/src/incremental/_transport.py`: the stdout and stderr reader threads now treat a closed stream (`OSError`, `ValueError`) as end-of-stream. `stop()` and `kill()` close the streams while the readers can still be inside `readline()`, which produced the `Bad file descriptor` and `I/O operation on closed file` errors in the Linux CI log. Local `make test-python`: 55 tests OK. Not reproduced on Linux before the Linux gate run below.
- **pnpm workspace.** Removed the dangling `cli` entry from `pnpm-workspace.yaml`. The package does not exist; the CLI is the `core` binary. `pnpm install --frozen-lockfile` still succeeds.
- **Remote.** `origin` set to `git@github.com:frontal-labs/incremental.git`.
- **Skills.** Added `skills/incremental/engine`, `verify`, `adapter` (each a `SKILL.md`), and updated `skills/README.md`. Facts checked against the code: `advance` mismatch exits 6 (`baseline_conflict`); `compact` is a no-op in this build (FORMAT.md says not implemented); P2 is the context rule.
- **fs Linux oracle.** The fs spec follows its README (`recordOracle` available on Linux). DECISIONS 2026-11-03 says the Linux oracle was not built on the Mac. Open until the Linux gate result is read against the fs README.
- **Stale ignored artifacts removed (2026-11-05, approved by the user).** The old-name leftovers were `cli/` (build output of a removed package), 18 `node_modules/@<old-scope>` directories, and `.toolchain/goose-home/build` (Goose build cache). All were ignored by git and are deleted. None was tracked.

## Linux gate PASS (2026-11-05)

- `make linux-gate` (fourth run) passed with exit 0 in `docker/Dockerfile.linux` on linux/amd64: `all-tests`, `test-python`, `test-git`, `test-fuzz` all PASS. The run includes the watcher suite and the strace oracle on Linux (`test-oracle` PASS), which the macOS runs could not show.
- Earlier runs failed before tests: (1) the image had no root `node_modules`; (2) `build-replay` ran before `bindings/node` was built; (3) the Goose stdlib on the host was corrupt (see the entry above). Runs 3 and 4 overlapped with another `make linux-gate` process that shared `logs/linux-gate.log` and the `incremental:linux` tag, and the docker build was cancelled. The other process's parent is an `opencode serve` process (PID 11421, started 2026-11-03), not this session.
- Open: the Linux `test-python` race (remote CI, `Bad file descriptor`) is now covered by this pass; the transport reader fix is in `bindings/python/src/incremental/_transport.py`.

## Verification pass: benchmarks and gates (2026-11-05)

- **Benchmark claims corrected.** The "~4445x faster than Nx" ratio is withdrawn. It compared a warm query on a 10k-task synthetic store with one cold CLI detection on a 4-package fixture. BENCHMARKS.md now reports per-query latency as a range (0.12–0.33 ms across runs) and says the 100k target is not measured.
- **Turbo and Bazel rows marked invalid, not fixed.** Turbo's 0 tasks come from a missing `pnpm-workspace.yaml` in the fixture (verified in a throwaway clone). Bazel times `bazel query //packages/...`, which lists every target; its BUILD files declare no deps. Fixing either means changing the nested fixture repo's git history. That needs your go-ahead.
- **`make bench` now runs `bench-compare`** before `bench-summary`. Before this, `RESULTS.md` was built from a `comparison.json` that `make bench` never refreshed.
- **Generator is data-driven.** `scripts/bench-summary.mjs` no longer hardcodes the Bazel timing, the speedup, or the Turbo/Nx correctness labels.
- **Lint and format not fixed.** `make lint` and `make fmt-check` fail on adapter sources (Biome `useTemplate`, `useLiteralKeys`, unused imports) and on `bindings/python` (ruff). Those files are under active work on this branch, so a mass auto-fix would churn them. Documented in CHANGELOG.md and `evidence/BENCH.txt`.
- **Build artifacts excluded.** `biome.json` ignores `**/target` and `benchmarks/results`; `.gitignore` gains `__pycache__/`, `*.pyc`, `.ruff_cache/`, `target/`. Already-tracked `examples/rust_client/target/` files stay tracked (untracking changes the index; not done).
- **Concurrent working-tree changes left alone.** During the pass, `biome-presets/core.json`, `biome-presets/type-aware.json` and `ultracite.json` were deleted from the working tree, `biome.json` was rewritten to an inline config, and commit `5ea00ac` (under the user's git identity, 17:58) landed. None of these were made by the verification commands. They were not restored or reverted.
- **Linux gate not run.** `docker version` returns no server info. Restarting Docker Desktop needs the user's go-ahead.

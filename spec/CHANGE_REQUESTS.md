## CR-001 Define the Vitest fixture that  refers to

- Requester: Adapters (E4)
- Milestone affected: E4, E6
- What: , 12.3, 14.1 and 15.4 E4 say the adapter cases V01 to V16 run against "the fixture in section 14.1". Section 14.1 is the stop-conditions list and defines no fixture. Define it here: a small Vitest monorepo at adapters/vitest/fixtures/repo with packages `core` and `app`, one shared utility read by two tests, one app-only test, a JSON file read at runtime, a dynamically imported plugin directory listed by a test, a probe target (module resolution shadowing), an env-reading test and an env-enumerating test, a workspace symlink from app/node_modules to core, a README read by nothing, a lockfile, a test that crashes on demand, and a test that starts a worker thread. Each case V01 to V16 is a JSON file under adapters/vitest/fixtures/cases with the same format as conformance/cases plus the edit to apply to the fixture.
- Why: the adapter cases cannot be run or checked without the fixture. The expectations for V01 to V16 must be hand-written from , and must not be produced by running the adapter.
- Impact: adapters/vitest/fixtures/** only. expected.json under fixtures is Spec-owned .
- Status: accepted (lead, 2026-11-03). Implemented in adapters/vitest/fixtures/repo with cases V01 to V16, and applied by instruction of the user.

## CR-002 Deleted task definition: invalidate or not 

- Requester: Adapters (E4), found while writing V13
- Milestone affected: E4 (V13), core (P5)
- What: says a deleted task definition is listed in deleted_tasks and is not invalidated. P5 and spec/POLICY.md P5 say invalidate every reader of the deleted path, and the engine does so; that includes the deleted task itself when it reads its own file. The Vitest V13 case was changed to the engine behaviour.
- Why: the two sections conflict. One must be chosen. The V13 expectation must not change to match the engine without this decision.
- Options: (a) 8.7 stands: a deleted task that is itself a reader is removed from the reader set before P5 runs; engine change, conformance C17 still passes. (b) P5 stands: 8.7 is reworded, V13 keeps its engine expectation.
- Decision (b), by the lead: spec/POLICY.md P5 says invalidate every reader of the deleted path, and both implementations do that. So 8.7's "not invalidated" is superseded. Cost: a deleted task that reads its own file is re-run once and then forgotten. Reversible if the human wants (a) instead.
- Status: accepted (lead, 2026-11-03), applied to v4.1 by instruction of the user, who asked for the open items to be closed.

## CR-003 Worker threads and balanced fallback on adds 

- Requester: Adapters (E4), V16
- Milestone affected: E4 (V16, V08, V09, V12)
- What: says a worker-thread test records caps.probes and caps.dirs false for its task, so balanced falls back on adds. The engine cannot hold per-task caps: P6 and P7 use the query's caps, and P2 compares the store's latest context caps, so a per-task false would give context_changed on every query. The adapter records the worker task's observation as dirty (allowed by 11.1 rule 4), so it reruns each time. With that task in the same fixture, a global fallback on adds would turn V08, V09 and V12 into fallbacks, which contradicts their 12.3 expectations. The V16 expectation was changed to the targeted behaviour.
- Why: the rule as written cannot be implemented without breaking V08, V09 and V12. The V16 expectation must not change to match the engine without this decision.
- Options: (a) keep 11.2 literally: put worker-thread tests in a separate fixture so they cannot break the other cases; V16 expects a fallback. (b) keep targeted behaviour: reword 11.2 and 12.3 V16 to dirty-observation rerun, no fallback.
- Decision (b), by the lead: option (a) cannot be expressed in the engine without making the whole store context caps-false, because P2 compares the store's latest context and P6/P7 read the query's caps. That would fall back on every query, which is worse than the rule it protects. The worker observation is recorded dirty, which 11.1 rule 4 allows, so it reruns and does not force a store-wide fallback. The V16 expectation is the targeted behaviour. 11.2 and 12.3 V16 are reworded by this CR.
- Status: accepted (lead, 2026-11-03), applied to v4.1 by instruction of the user, who asked for the open items to be closed.

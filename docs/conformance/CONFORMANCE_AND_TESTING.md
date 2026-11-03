# BACKPLANE CONFORMANCE AND TESTING

## Conformance Suite (Language-Neutral)
`conformance/cases/*.json` - data, not code. Any core can run it.

```json
{
  "id": "C05",
  "desc": "Added file in a listed directory invalidates the lister",
  "mode": "balanced",
  "store": {"from": "conformance/stores/base.jsonl"},
  "context_override": {},
  "query": {
    "baseline": "<store baseline>",
    "changes": [{"path": "packages/app/plugins/p3.ts", "status": "added"}],
    "verify": true
  },
  "expect": {
    "tasks": [{"id": "packages/app/src/list.test.ts", "reasons": ["dir:packages/app/plugins"]}],
    "unobserved": [],
    "ignored": [],
    "deleted_tasks": [],
    "fallback": null,
    "confidence": "high"
  }
}
```
Store is JSONL of protocol messages (`observe`, `advance`, `forget`) setting up state. Expected values written by hand from case logic - never produced by running engine. `spec/reference/policy.mjs` provides reference implementation (~300 lines) for differential testing.

Runner: `conformance/run.mjs` takes engine serve command, executes cases over protocol, compares plans.

## Core Policy Cases (C01-C40)
| ID | Case | Rules |
|---|---|---|
| C01 | Changed file read by one task | P3 |
| C02 | Changed file read by several tasks | P3 |
| C03 | Modified task definition | P4 |
| C04 | Task without observation | P8 |
| C05 | Added file in listed directory | P6 |
| C06 | Added file probed by task | P6 |
| C07 | Added file, conservative policy | P6 fallback |
| C08 | Added file, balanced caps.probes false | P6 fallback |
| C09 | Modified unread file, balanced | P7 |
| C10 | Modified unread file, conservative | P7 fallback |
| C11 | Ignored path dropped and listed | P11 |
| C12 | Global input changed | P1 |
| C13 | Reserved context key changed | P2 |
| C14 | Recorded env name changed | P2b |
| C15 | env_all task, env changed | P2b |
| C16 | Deleted file task read | P5 |
| C17 | Deleted task definition | P5, deleted_tasks |
| C18 | Rename: old path per C16, new per C05/C06 | P5, P6 |
| C19 | Latest outcome fail | P9 |
| C20 | Latest outcome error | P9 |
| C21 | Latest observation dirty | P8 |
| C22 | Verify: recorded file changed without change entry | P10 |
| C23 | Verify: recorded file deleted | P10 |
| C24 | Verify with valid stat cache same as without | 7.6 |
| C25 | Baseline mismatch | P0 |
| C26 | advance with stale expected value | G-g, 9.4 |
| C27 | Context missing | P0b |
| C28 | Two fallbacks fire; priority chosen | 8.5 |
| C29 | Empty ChangeSet | 8.7 |
| C30 | Confidence high | 8.6 |
| C31 | Confidence medium with verify off | 8.6 |
| C32 | Same input twice gives identical bytes | G-d |
| C33 | Shuffled input order gives identical bytes | G-d |
| C34 | Unknown protocol version | 9.2 |
| C35 | Malformed line, loop continues | 9.1 |
| C36 | Truncated final log line ignored | G-e |
| C37 | Unknown log record type skipped | G-e |
| C38 | Index from cache/rebuilt/delta-updated give same plans | G-f |
| C39 | Declared input changed | 8.3 declared |
| C40 | Two writers serialize; both observations present | 6.6 |

Coverage: every rule in 8.2 has >=1 case in each applicable mode. `spec/validate.mjs` fails `make check-spec` if cell empty.

## Vitest Adapter Cases (V01-V16)
| ID | Case |
|---|---|
| V01 | Edit leaf file read by two tests |
| V02 | Edit file read only by app test |
| V03 | Edit shared utility |
| V04 | Edit runtime-read JSON file |
| V05 | Edit dynamically imported plugin |
| V06 | Add new test file |
| V07 | Edit file through workspace symlink; reader recorded under real path |
| V08 | Add file test probes (module resolution shadowing) |
| V09 | Add file in directory test lists |
| V10 | Env-dependent test, env changed |
| V11 | Env-enumerating test, new variable |
| V12 | Edit README (nothing reads it) |
| V13 | Delete test file |
| V14 | Lockfile changed (fallback) |
| V15 | Test crashes; baseline not advanced; next run re-selects it |
| V16 | Worker thread in test: capabilities false for that task, fallback on adds |

## Guarantees (Checked by Conformance)
| # | Guarantee |
|---|---|
| G-a | Task without certificate never skipped |
| G-b | Query with baseline != store baseline never returns partial plan - returns full fallback |
| G-c | Query without context returns full fallback |
| G-d | Plans deterministic: identical store+input give identical bytes, independent of input order |
| G-e | Unknown record in log skipped, truncated final line ignored; neither changes answers |
| G-f | Same plan whether index loaded from cache, rebuilt, or updated from log delta |
| G-g | Advancing baseline requires expected previous value; mismatch is error not silent overwrite |

## Testing Commands
```bash
make check-spec      # Validate schemas/examples/reference/coverage
make test-core       # Log/index/store/lock tests
make test-policy     # Conformance cases through core
make test-protocol   # Protocol server tests, malformed lines, timeouts
make test-bindings   # Node client + CLI parity
make test-vitest     # V01-V16 with Vitest adapter
make test-oracle     # strace oracle vs recorder (Linux)
make test-e2e        # V cases end-to-end
make test-mcp        # MCP server tests
make all-tests       # All tests
make linux-gate      # Run in Linux container
```
Every target prints `PASS <target>` or `FAIL <target>` as last line.

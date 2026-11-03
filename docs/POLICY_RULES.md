# BACKPLANE POLICY RULES

## Certificate Principle
> A task may be skipped only if it has a certificate: an observation, valid at the current baseline, whose inputs are all unchanged.
If no certificate exists, task is invalid. Never skip silently.

## Baseline Invariant
Every task's latest observation must be valid at store baseline `B`. Advancing baseline requires explicit `advance` with expected previous value (compare-and-swap). Query with different baseline than store returns full fallback.

## Policy Procedure (Summary)
1. **P0/P0b**: If `options.baseline != store.baseline` or context missing → fallback
2. **P11**: Drop changes matching `ignore` globs (listed in `ignored`)
3. **P1**: Any change matching `globalInputs` → fallback (`global_input`)
4. **P2**: Reserved or listed `fallbackContextKeys` differ from store context → fallback (`context_changed`)
5. Process changes in sorted order `(path, status, old_path)`: check deletions/renames (P5), file inputs (P3), self-changes (P4), unobserved adds/modifies (P6/P7)
6. Check all known tasks: missing/dirty obs (P8), failed outcomes (P9), env changes (P2b)
7. If `verify`: check recorded file hashes via stat cache (P10)
8. Return plan with sorted tasks/reasons

## Rule Table
| ID | Condition | Action | Reason Code |
|---|---|---|---|
| P0 | Query baseline != store baseline | Fallback | `baseline_mismatch` |
| P0b | Context missing | Fallback | `context_missing` |
| P11 | Path matches `ignore` | Drop, list in `ignored` | none |
| P1 | Path matches `globalInputs` | Fallback | `global_input` |
| P2 | Reserved/listed context key differs | Fallback | `context_changed` |
| P2b | Task's recorded env changed or `env_all` changed | Invalidate task | `env_changed:<NAME>` or `env_all_changed` |
| P3 | Changed path is file input of task | Invalidate readers | `reads:<path>` or `declared:<path>` |
| P4 | Changed path is known task's definition, status added/modified | Invalidate task | `self_changed` |
| P5 | Path deleted/renamed old path; invalidate readers/listers. Deleted task def listed in `deleted_tasks` | Invalidate + list deleted | `removed_read:<old>`, `removed_listed:<dir>` |
| P6 | Path added/renamed-to, not file input; balanced+caps.probes+dirs → invalidate probers/listers else fallback | Invalidate or fallback | `probe:<path>`, `dir:<parent>` or `unobserved_input` |
| P7 | Modified path, not file input, not task def; balanced+caps → list in `unobserved` else fallback | List or fallback | `unobserved_input` |
| P8 | No observation or latest dirty | Invalidate | `no_observation` or `dirty_observation` |
| P9 | Latest outcome fail/error | Invalidate | `failed_outcome` |
| P10 | verify on, recorded file missing/mismatched hash | Invalidate | `stale:<path>` |

## Fallback Priority
`baseline_mismatch` > `context_missing` > `global_input` > `context_changed` > `unobserved_input`
Under fallback: all known tasks get reason `["fallback"]`, `skipped=0`, `confidence="n/a"`, `unobserved/ignored/deleted_tasks=[]`.

## Confidence
- `n/a` if fallback fired
- `high` if no fallback, `verify` on, no task invalidated for `no_observation`, `dirty_observation`, or `stale:*`
- `medium` otherwise (default for queries without verify)

## Reserved Context Keys
`lockfile`, `tsconfig`, `pkgjson`, `runner`, `node`, `fmt`, `caps`. `caps` = `{probes, dirs, env}` (booleans). Missing caps prevent P6/P7 in balanced mode → fallback.

## Reason Grammar
`<code>` or `<code>:<arg>`. Codes: `reads`, `declared`, `self_changed`, `removed_read`, `removed_listed`, `probe`, `dir`, `no_observation`, `dirty_observation`, `failed_outcome`, `stale`, `env_changed`, `env_all_changed`, `fallback`. Fallback reasons only in `fallback.reason`. All reason lists sorted lexicographically.

## Determinism
- Changes processed in sorted order `(path, status, old_path)`
- All lists sorted (tasks by id byte order, reasons sorted, unobserved/ignored/deleted sorted)
- Same store+input always gives identical bytes

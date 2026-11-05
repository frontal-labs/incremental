# Policy (spec v4, from  sections 3, 4.1, 5, 8)

This file defines `plan(state, query)`. The reference implementation (`spec/reference/policy.mjs`) and the core (`core/src/policy.ts`) must both match it. Conformance cases are the tests.

## 1. Inputs

- **State**: the store's baseline `B` (string or `null`), the set of known tasks (latest observation per task, minus forgotten tasks), and for each task its latest observation.
- **Store context**: the `context` of the most recent observation in the log. Used by P2.
- **Query**: `baseline`, `context` (may be absent), `changes` (ChangeSet entries), `verify` (bool, default false), `policy` (`balanced` or `conservative`, default `balanced`), and the optional fields below.
- **Optional query fields** (additive to PROTOCOL.md 9.3, see DECISIONS.md D-E1-01):
  - `env`: object `{NAME: value_hash}`. The client's full environment hash map. Missing names mean `"unset"`.
  - `config`: `{ignore: [globs], globalInputs: [globs], fallbackContextKeys: [names]}`. Missing fields take the defaults in  6.7.
  - `declared_tasks`: task ids known to the adapter. A declared task with no observation is a known task for this query only (P8 `no_observation`).

## 2. Procedure

```
plan(changes, options):
  if store.B is null or options.baseline != store.B:      return fallback(baseline_mismatch)   P0
  if options.context is missing:                           return fallback(context_missing)     P0b
  drop changes whose path matches config.ignore            (listed in `ignored`)               P11
  fallbacks = {}
  if any change path matches config.globalInputs:          fallbacks += global_input            P1
  for each key in config.fallbackContextKeys (plus all reserved keys):
     if context[key] != store_context[key]:                fallbacks += context_changed         P2
  if fallbacks nonempty:                                   return fallback(highest)             8.5
  caps = options.context.caps
  invalid = {}                       # task -> set of reasons
  unobserved = {}; deleted = {}
  for each change c (in sorted path order, see 5):
    if c.status in (deleted, renamed):
      old = (c.status == deleted) ? c.path : c.old_path
      for each task t with file input old: invalid[t] += removed_read:<old>                  P5
      for each task t with dir input parent(old): invalid[t] += removed_listed:<dir>         P5
      if old is a known task: deleted.add(old)                                               P5
    if c.status == deleted: continue
    p = c.path (for renamed: the new path)
    if p is a file input of some task:  invalid[t] += reads:<p> (or declared:<p>) for each reader  P3
    if p is a known task and c.status in (added, modified):  invalid[p] += self_changed          P4
    elif p is not a file input and c.status in (added, renamed):
         if policy == balanced and caps.probes and caps.dirs:
             invalid[t] += probe:<p> for each prober of p                                       P6
             invalid[t] += dir:<parent(p)> for each lister of parent(p)                         P6
         else: fallbacks += unobserved_input                                                    P6
    elif p is not a file input and c.status == modified:
         if policy == balanced and caps.probes and caps.dirs: unobserved.add(p)                 P7
         else: fallbacks += unobserved_input                                                    P7
  if fallbacks nonempty:                                   return fallback(highest)
  for each known task t (sorted):
    obs = latest observation of t, or none
    if obs is none or obs.dirty:                           invalid[t] += no_observation | dirty_observation   P8
    if obs.outcome in (fail, error):                       invalid[t] += failed_outcome                        P9
    for each env input (name, vh) in obs:                  if (query.env[name] ?? "unset") != vh: invalid[t] += env_changed:<name>   P2b
    if obs has env_all:                                    if env_all differs from snapshot: invalid[t] += env_all_changed           P2b
  if verify:
    for each task t with an observation, each file or declared input (path, hash):
       h = hash of worktree file at path (stat cache, section 6); missing or differs: invalid[t] += stale:<path>   P10
  result: tasks = invalid (sorted by id, reasons sorted), unobserved, ignored, deleted_tasks (sorted)
  total = |known tasks| (known includes declared_tasks and deleted-but-not-forgotten tasks)
  skipped = total - |tasks|
  confidence per section 4
```

Notes:

- The `fallbacks` set is collected over P1, P2, and the unobserved fallbacks, and the highest by 8.5 wins. Nothing returns early inside the change loop. (This is a stated choice; the older pseudocode returned early. See DECISIONS.md D-E1-03.)
- A task with a modified file that it reads and that is also its own definition gets both `reads:` and `self_changed` (P3 and P4).
- `env_all` without a snapshot in its observation is treated as changed (`env_all_changed`). Conservative, and it never produces a false skip.

## 3. Fallback

`fallback = {action: "run_all", reason}`. `tasks` lists every known task with reasons `["fallback"]`, sorted by id. `unobserved`, `ignored`, and `deleted_tasks` are `[]`. `confidence` is `n/a`. `skipped` is 0.

Reason priority (8.5): `baseline_mismatch` > `context_missing` > `global_input` > `context_changed` > `unobserved_input`.

## 4. Confidence (8.6)

- `n/a` when a fallback fired.
- `high` when no fallback fired, `verify` is on, and no task was invalidated for `no_observation`, `dirty_observation`, or `stale:*`.
- `medium` otherwise.

## 5. Determinism (G-d)

- Changes are processed in ascending order of `(path, status, old_path)` before any rule runs. Input order never changes output.
- All lists in the plan are sorted. Reasons are de-duplicated and sorted lexicographically. Task ids are sorted by byte order (JavaScript default string comparison on code units; all ids are ASCII in v1).

## 6. Verify and the stat cache (P10, 7.6)

- The worktree root is the directory given to `serve` (`--root`). Paths are repo-relative.
- Stat cache: `<store>/stat.cache`, JSON object `{path: {size, mtime_ns, hash}}`. Reuse the cached hash when size and `mtime_ns` are equal, otherwise hash the file and update the cache.
- A missing file is `stale`. Deleting `stat.cache` never changes an answer (C24).

## 7. Reason grammar (8.3)

`<code>` or `<code>:<arg>`. Codes: `reads`, `declared`, `self_changed`, `removed_read`, `removed_listed`, `probe`, `dir`, `no_observation`, `dirty_observation`, `failed_outcome`, `stale`, `env_changed`, `env_all_changed`, `fallback`. Fallback reasons (`baseline_mismatch`, `context_missing`, `global_input`, `context_changed`, `unobserved_input`) appear only in `fallback.reason`.

## 8. Reserved context keys (8.4)

`lockfile`, `tsconfig`, `pkgjson`, `runner`, `node`, `fmt`, `caps`. `caps` is an object with boolean `probes`, `dirs`, `env`. Comparison is by deep equality after canonical key ordering.

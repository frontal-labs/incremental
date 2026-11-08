# @frontal-labs/incremental-config

Config files as declared inputs (spec/adapters/config.md). Not a task runner: it records
the global config files that `incremental.config.json` lists under `globalInputs`, and any
config a task declares, as `declared` inputs with content hashes .

## Use

- `contextFor(root, caps?)`: the context . Default `caps` are all false.
- `recordTasks(client, { root, baseline, context, tasks })`: one observation per task. Each
  task declares every global input plus its own `declares` list.
- `planChanges(client, { root, baseline, context, changes })`: the affected query, with
  `config` (`ignore`, `globalInputs`, `fallbackContextKeys`) read from `incremental.config.json`.

Test: `npm test` (builds `bindings/node`, then runs `node --test`). Wiring tests are in
`test/config.test.ts`, through the real engine.

## Behavior

- A change to a global input falls back (`global_input`, P1). The fallback invalidates every
  known task, so every task that declares the global input is invalid.
- A change to a declared non-global config invalidates the declaring task (`declared:<path>`, P3).
- A declared config that is absent and later created invalidates its task (P3, since the path is indexed).

## Gaps (not hidden)

- The adapter cannot observe whether a task read a config file. A `declared` input is the
  task's declaration, not a recorded read. For a config that is not global, the task's own
  recorder must record the read, or the result is not sound (spec/adapters/config.md).
- Caps are the caller's claim. The config adapter records no probes and no dirs. With caps
  false (the default), a modified file that no task declares falls back (`unobserved_input`).
  With caps `probes` and `dirs` true, that file is listed in `unobserved` and no task is
  invalidated. That is only correct if the task's recorder records probes and dirs and the
  task does not read the file. The test "documented gap" checks this case.
- Glob matches are computed by walking the repo at observation time (excluding `node_modules`,
  `.git`, `.incremental`). A file that matches a glob only after the observation is seen as a
  changed path that matches `globalInputs`, which falls back.
- `incremental.config.json` itself is not an input of any task unless a task declares it.

# @incremental/env

Environment variables as observation inputs (spec/adapters/env.md, , D-E1-02).
Not a task runner. For each allowlisted variable a task records an `env` input with
`value_hash` (`sha256:...`, or `unset` when missing). Values are hashed, never stored.

## Use

- `contextFor(envAll)`: the context . `caps.env` is true only when `envAll` is set.
- `recordTasks(client, { baseline, context, env, tasks })`: one observation per task. A task
  is `{ id, names, envAll?, outcome? }`. `env` is passed in, so process.env is never read here.
- `planEnv(client, { baseline, context, env, tasks, changes? })`: the affected query with the
  `env` hash map of every name the tasks recorded (or every variable when `envAll` is used).

Test: `npm test`. Wiring tests in `test/env.test.ts`, through the real engine.

## Design choice (review)

The spec says the hashes go "into the observation context" and that names are listed in
`fallbackContextKeys`. This adapter puts them in the observation's `inputs` instead.
A context key that differs causes a fallback for every task (P2). An `env` input causes
only the task that recorded the variable to be invalidated (P2b). The task-level rule is the
one the spec asks for.

## Behavior

- A listed variable that changes invalidates the task that recorded it (`env_changed:<NAME>`, P2b).
- A variable unset at recording and set later is a change (`unset` is compared).
- `env_all` with a snapshot: an unchanged environment is not invalid. A changed variable gives
  `env_all_changed`. Without a snapshot the engine treats `env_all` as changed.

## Gaps (not hidden)

- **Core gap.** Reads of variables not on the allowlist are not observed. A task that reads an
  unlisted variable is not invalidated when it changes. The test "documented gap" checks this.
  Either list the variable, use `envAll`, or set `caps.env` false and run the task dirty.
- Variables read by a child process the task starts are not observed.
- `env_all` is noisy: volatile variables (for example `PWD`, `OLDPWD`, `SHLVL`, `_`) change
  between runs and cause re-runs. It is safer and noisier, as the spec says.
- `caps.env` says whether `env_all` is in use. It is not a claim about individual reads.

# @frontal-labs/incremental-nx: the Nx adapter (spec/adapters/nx.md).

Observes Nx test runs through the incremental engine. Uses `nx show projects --affected`
to discover affected projects, then runs `nx test <project>` for each affected project,
recording observations through the engine's protocol v1.

## Usage

```sh
# Build
npm install
npm run build

# Run the adapter against a scratch repo
node dist/src/run.js --store <store> --root <repo> --base <baseline>

# Run tests
npm test
```

## How it works

Every run asks the engine what is invalid, runs only those projects, and records what each one read.

1. Reads the store baseline `B` (the commit the store last advanced to; `--base` overrides it on a first run).
2. Builds the ChangeSet from `B` to the worktree (`incremental-git`).
3. Reads the project graph from `nx graph --file` (project names, roots and dependency edges).
4. Asks the engine for the plan. On a fallback (no baseline, a changed context) or with `--all`, every project runs. Otherwise only the invalid projects run.
5. Runs each selected project's test command in the project directory: the `test` target's `command` in `project.json`, or else the `test` script of its `package.json`. Each run is under the recorder (`adapters/vitest/src/preload.ts`): every file its processes read is traced.
6. Records one observation per project from its trace (`buildObservation`). The environment is the plan's environment, so a variable the shell or a shim adds to the test process is not an input.
7. Advances the baseline to HEAD only if every selected project passed, the worktree is clean at the end, and HEAD did not move.

Why the test command runs directly and not through `nx test`: Nx's own processes (plugin workers, run-command shells) are subprocesses the recorder cannot tell apart from task processes. Under `nx test` every observation would be marked dirty, and nothing could be skipped. Nx still supplies the graph and the affected set.

The recorder needs Vitest 4.1.12 (the version it is pinned to). Vitest 2 starts child processes during a test run, which the recorder records as subprocesses and so marks the observation dirty.

Test on the fixture: `make fixture-e2e` (prime, edit `utils`, edit `shared`, checked against the import graph).

## Limits

- A project's test command is run as the project's own `test` target. Targets with `dependsOn` (for example `^build`) are not run; Nx's dependency builds are not recorded.
- A command with shell syntax (pipes, `&&`) runs through `sh`, which adds shell variables to the environment. Those names are dropped from the observation, but the shell's own behaviour is not recorded.
- A test that reads a file the recorder cannot see (a `require` that is not traced, a worker thread) is recorded dirty, so it is re-run; it is not skipped unsoundly.

## Exit codes

- 0: All affected tasks ran and passed, baseline advanced
- 1: A test failed (baseline advanced when allowed)
- 2: Usage or engine error
- 7: Ran but baseline was not advanced

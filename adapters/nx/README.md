# @incremental/nx: the Nx adapter (spec/adapters/nx.md).

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

1. Discovers Nx projects via `nx show projects --affected --base=<baseline>`
2. Queries incremental for affected tasks via `affected()` with the git ChangeSet
3. Runs `nx test <project>` for each affected project under the engine recorder
4. Records observations and advances the baseline

## Exit codes

- 0: All affected tasks ran and passed, baseline advanced
- 1: A test failed (baseline advanced when allowed)
- 2: Usage or engine error
- 7: Ran but baseline was not advanced

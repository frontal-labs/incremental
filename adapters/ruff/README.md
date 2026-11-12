# @frontal-labs/incremental-ruff

The ruff adapter: one task per file that `ruff check` checks. Spec: `spec/adapters/ruff.md`.

```
incremental-ruff run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]
```

Exit codes follow the TypeScript adapter: 0 advanced and clean, 1 advanced with violations, 2 usage, 4 engine or setup error, 7 ran but not advanced.

## Tasks

- Task id: `ruff check <repo-relative path>` .
- The task list is `ruff check --show-files`, so ruff's own excludes and `.gitignore` apply. `pyproject.toml` is a task too, because ruff checks it for its TOML rules.
- Each task runs `ruff check --no-cache --output-format json <file>`. Exit 0 is `pass`, exit 1 is `fail`, anything else is `error`.

## Inputs and context

- Inputs per task: the file, and the config file ruff resolved for it (the `Settings path` from `ruff check --show-settings`) plus its `extend` chain. All are hashed at observation time. Config files outside the repo, or a missing `extend` target, make the observation `dirty`.
- A run with no project config while a user-level `ruff/ruff.toml` exists is `dirty`.
- Context: `runner` is `ruff@<version>`, `node` is the Node version, `fmt` is 1. The reserved keys `lockfile`, `tsconfig` and `pkgjson` are fixed to `absent`, because ruff reads none of them.
- Capabilities: `probes`, `dirs` and `env` are all false.

## Gaps (what is not observed)

- **Import-aware rules** (isort `I`, flake8-type-checking `TCH`). Ruff classifies imports as first-party or third-party by checking whether modules exist under the `src` roots. Those existence checks are probes, and the adapter does not record them. With `probes` and `dirs` false, any added or modified file that is not already an input falls back to running every task (`unobserved_input`). A deleted or renamed-away `.py` or `.pyi` also runs every task, since the store cannot see which tasks probed it. This is sound but costs a full run on those edits. The draft's "undeclared import is dirty" case is handled this way instead, because every unresolved import depends on repo file existence, which is covered by the fallback.
- **Other config discovery.** The `extend` chain is read with a regex, not a TOML parser. Ruff config discovery across directories is covered only through the settings path that `--show-settings` prints.
- **Plugins and the ruff version.** Plugin rules are not observed. The version is in the context.
- **Environment.** Ruff's environment variables (for example `RUFF_*`) are not recorded. The adapter does not record them, and `env` is false.
- **`ruff format`** is not covered. Only `ruff check`.
- **Notebooks.** `.ipynb` files that ruff lists are tasks, but the adapter has not been tested on them.
- **Shallow clones and symlinks.** Inherited from the git change source . Symlinked files are not resolved by the adapter.

## Dependencies

`@incremental/client` (local, `../../bindings/node`), plus the dev dependencies `typescript` 5.9.3 and `@types/node` 22.20.5, the same versions as the TypeScript adapter. Ruff itself is an external binary (`INCREMENTAL_RUFF` or `ruff` on PATH).

## Tests

`npm test` in this directory: 8 integration tests, each against the real engine, a scratch git repo, and the installed ruff. No network.

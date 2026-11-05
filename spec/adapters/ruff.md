# ruff adapter

Status: built (adapters/ruff, make test-ruff). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/ruff/README.md on 2026-11-04. PLAN tier: later. The non-JavaScript ecosystem decision (PLAN §4.3) is recorded in DECISIONS.md (2026-11-03, "Adapters and bindings built from spec/adapters").

## Task
One task per file that `ruff check` checks. Task id: `ruff check <repo-relative path>` (D-2). The task list is `ruff check --show-files`, so ruff's excludes and `.gitignore` apply. `pyproject.toml` is also a task, because ruff checks it for its TOML rules. Each task runs `ruff check --no-cache --output-format json <file>`. `ruff format` is not covered.

## What the recorder can observe
- Input files: the task's file, hashed at observation time (after the run), not at read time.
- Config: the config file ruff resolves for the task (the `Settings path` printed by `ruff check --show-settings`), plus its `extend` chain (read with a regex, not a TOML parser). A config outside the repository, or a missing `extend` target, makes the observation `dirty`. A run with no project config while a user-level `ruff/ruff.toml` exists is `dirty`.

## What it cannot observe
- Imports that ruff resolves for import-aware rules (isort `I`, flake8-type-checking `TCH`). Ruff checks whether modules exist under the `src` roots; those existence checks are probes, which are not recorded. No per-rule capability is set. Instead, an added or modified file that is not already an input, or a deleted `.py`/`.pyi`, runs every task (`unobserved_input`). This is sound but costs a full run.
- Plugin rules: not observed. The ruff version is in the context (`runner`, PLAN §8.4).
- Ruff environment variables (for example `RUFF_*`): not recorded. `env` is false.

## Declared inputs
- None are declared. The config files are observed through the settings path above, not listed by hand. `uv.lock` and `requirements*.txt` are not inputs.
- Context: `runner` is `ruff@<version>`, `node` is the Node version, `fmt` is 1. `lockfile`, `tsconfig` and `pkgjson` are fixed to `absent`.
- Capabilities: `probes`, `dirs` and `env` are false.

## Adapter tests
`adapters/ruff/tests/adapter.test.ts` (8 tests) runs the real engine and the installed ruff in scratch git repositories. These are adapter tests, not conformance cases. They cover: discovery of each file ruff checks; the first run checking every file and advancing; an edit to one file selecting only that file's task; a changed `[tool.ruff]` in `pyproject.toml` selecting every task; a rule violation failing its file with exit 1 and advancing; an uncommitted change leaving the baseline in place with exit 7; a new Python file falling back to every task; and a deleted Python file running every remaining task.

## Gaps
- The adapter is not in the conformance suite (PLAN §12).
- Import-aware rules are covered by the full-run fallback, not a dirty flag. An "undeclared import is dirty" case is not built.
- `ruff format` is not covered.
- Notebooks: `.ipynb` files that ruff lists are tasks, but the adapter has not been tested on them.
- Symlinked files are not resolved. Shallow clones are inherited from the git change source (PLAN §11.7).
- Config discovery is covered only through the settings path that `--show-settings` prints.

## Open questions
- None open in the README or DECISIONS.md. The `--show-settings` question is answered by the built adapter, which parses the `Settings path` (see What it can observe). The README does not record instability in that output.

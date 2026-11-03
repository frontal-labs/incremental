# ruff adapter (draft, not approved)

Status: draft. PLAN tier: later. Python ecosystem: a separate decision is required for non-JavaScript ecosystems (PLAN §4.3, `pytest, others`).

## Task
A Python file group run by `ruff check` or `ruff format`. Task id: the command plus the repo-relative path (D-2). Per-file tasks are preferred.

## What the recorder can observe
- Input files: each file ruff checks is read, and its hash is taken at read time.
- Config: `ruff.toml`, `.ruff.toml`, or `pyproject.toml` `[tool.ruff]`, including the chain of parent configs ruff resolves. `ruff check --show-settings <file>` prints the settings and the config file it used. The recorder can read this to find the files that configured the run (open question: whether the output is stable across versions).

## What it cannot observe
- Imports that ruff resolves for rules that need import context (for example isort). Those imported files are read by ruff but may not be reported. Set capability false for import-aware rules.
- Plugin rules and the ruff version: the version is part of the context (PLAN §8.4).

## Declared inputs
- `pyproject.toml`, `ruff.toml`, `.ruff.toml`, `uv.lock` or `requirements*.txt` as needed for the environment.

## Conformance cases (to write)
- Changing a file invalidates only that file's task.
- Changing `pyproject.toml` `[tool.ruff]` invalidates every task that uses it.
- An import-aware rule with an undeclared import is `dirty`.

## Open questions
- Whether `--show-settings` is stable enough to parse. Otherwise the config list must be declared by hand.

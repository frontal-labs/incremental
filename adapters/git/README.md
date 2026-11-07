# git change source (`adapters/git`)

`incremental-git` builds a ChangeSet from a baseline to the worktree: committed and staged changes, untracked files, renames and deletions . It is a separate binary so that the core never runs git .

```sh
incremental-git changes --base REF [--root DIR]
```

Prints `{"baseline", "head", "dirty", "changes": [...]}` on stdout. It fails with `invalid_params` (exit 2) when REF is not in the history, for example in a shallow clone. It never returns a partial ChangeSet .

- Source: `src/changes.goose` (entry point, compiled by `make build`), `src/changes.build`, `src/git.c` (native helpers).
- Test: `make test-git` runs `node --test adapters/git/tests/*.test.mjs`.
- Output: `dist/incremental-git` (built, not committed).

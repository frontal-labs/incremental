# biome adapter (draft, not approved)

Status: draft. PLAN tier: later (§4.3 does not list it).

## Task
A Biome command run over a set of files, for example `biome check` or `biome lint`. Task id: the command name plus the repo-relative path of each file group (D-2). Per-file tasks are preferred, so a change to one file does not invalidate every file.

## What the recorder can observe
- Input files: each file Biome checks is read. The file list comes from the same run, so the recorder can record each file's content hash at read time (§11.1 rule 3).
- Configuration: `biome.json` and any `extends` chain it resolves. These are declared inputs.

## What it cannot observe
- Files Biome reads that it does not report, such as `.gitignore` or ignore patterns, unless the recorder treats them as declared.
- Plugin or rule-set code loaded from a package. Declared as the package's lockfile entry, not per file.
- Environment reads. Set `env` capability false.

## Declared inputs
- `biome.json`, `biome.jsonc`, `package.json`, the lockfile.

## Conformance cases (to write)
- Changing one file invalidates only that file's task.
- Changing `biome.json` invalidates every task that uses it.
- A config change through `extends` is detected.

## Open questions
- Whether Biome exposes a machine-readable list of files it read. If not, the recorder falls back to strace on Linux (PLAN §11.5), which gives no macOS coverage.
- Whether a per-file task count is practical at the sizes in PLAN §13.

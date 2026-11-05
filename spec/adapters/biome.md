# biome adapter

Status: built (adapters/biome, make test-biome). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/biome/README.md on 2026-11-04.

## Task
One task per file that `biome check` processes. Task id: `biome check <repo-relative path>` (D-2). Built: `biome lint` is not a separate task set. Per-file tasks are used, so a change to one file does not invalidate every file.

## What the recorder can observe
- Input files: each file Biome checks is read. The file list comes from Biome's own "Files processed" list in `biome check --verbose .` (parsed from text; Biome has no machine-readable list). Each selected file is hashed before Biome runs and again after; a change in between marks the observation dirty (§11.1 rule 3).
- Configuration: every `biome.json` / `biome.jsonc` from the file's directory up to the root, plus every relative `extends` and `plugins` target of those. Biome does not report the configs it reads, so the adapter declares a superset: every config on the path, not only those Biome merges.

## What it cannot observe
- Files Biome reads that it does not report, such as `.gitignore` or ignore patterns, unless the recorder treats them as declared. Built: root `.gitignore` and `.editorconfig` are declared; nested `.gitignore` and `.editorconfig` files are not.
- Plugin or rule-set code loaded from a package. Declared as the package's lockfile entry, not per file. Built: `extends` and `plugins` that name a package are not hashed; with no lockfile the observation is dirty.
- Environment reads. Built: `env`, `dirs` and `probes` capabilities are all false.
- Biome exits 0 after an internal I/O error (for example, a file removed during the run). Built: the adapter reads the diagnostics, not the exit status, so this is recorded `error`.
- Built: a nested config that is not `root: false` while a root config exists makes the run fail with no JSON report, which is recorded `error`.
- Built: a change to a file that is neither a task nor a declared input falls back to running every file (`unobserved_input`), so a docs-only edit reruns the whole set.
- Built: `context.tsconfig` is `"not-read"`, because Biome does not read `tsconfig.json`.
- Built: the Biome version is pinned exactly (`@biomejs/biome` 2.5.15), because the list parser depends on its output format.

## Declared inputs
- The file itself; `biome.json`, `biome.jsonc` on the path from the file up to the root; their relative `extends` and `plugins` targets.
- Root `.gitignore`, `.editorconfig`, `package.json`, and the lockfile, when present.

## Conformance cases
The adapter is not in the conformance suite . The cases below are intended checks, not suite cases.
- Changing one file invalidates only that file's task.
- Changing `biome.json` invalidates every task that uses it.
- A config change through `extends` is detected.

## Open questions
- Per-file task count at  sizes: not measured. Each run starts two Biome processes per 200 selected files, and discovery checks the whole repository once before planning.
- Lockfile coverage of package plugins: assumed, not verified against `node_modules` contents.
- Reads of files outside the declared set are observable only through the strace fallback , which gives no macOS coverage. The file list itself no longer needs it: the text list is used (Biome 2.5.15 has no machine-readable list, per README).

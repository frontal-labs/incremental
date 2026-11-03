# @backplane/biome

Biome adapter for backplane, following `spec/adapters/biome.md`. One task per file that `biome check` processes. Task id: `biome check <repo-relative path>`.

```
backplane-biome run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]
```

Tests: `npm test` (builds the client binding, then runs `node --test` against the real engine and git source).

## What is observed

- The task set is Biome's own "Files processed" list from `biome check --verbose .`. Paths under `.backplane/` are dropped.
- Per run, each selected file is checked in one `biome check --verbose` call (the processed list) and one `--reporter=json` call (diagnostics). Outcome per file: `error` if Biome did not process it or reports an internal error, `fail` if it reports an error-severity diagnostic, otherwise `pass`. Diagnostics that name no file of the batch (configuration problems) apply to every file in the batch.
- Each file is hashed before Biome runs and again after. A change in between marks the observation dirty.
- Declared inputs: the file itself; every `biome.json` / `biome.jsonc` from the file's directory up to the root; every relative `extends` and `plugins` target of those; root `.gitignore`, `.editorconfig`, `package.json` and the lockfile when present.

## Gaps

- Biome has no machine-readable list of files read. The processed list is parsed from the text `--verbose` output, and the JSON reporter has no file list. The parser depends on Biome's output format, so the Biome version is pinned exactly.
- Biome does not report the configuration files it reads. The adapter declares a superset: every config on the path, not only the ones Biome merges. Biome rejects a nested config that is not `root: false` while a root config exists, and the run then fails with no JSON report, which the adapter records as `error`.
- `extends` and `plugins` that name a package are not hashed. They are covered by the lockfile, as in the spec. With no lockfile, the observation is dirty.
- Ignore and editorconfig files are declared at the root only. Nested `.gitignore` files and `.editorconfig` files are not declared.
- Biome exits 0 after an internal I/O error (for example, a file removed during the run). The adapter reads the diagnostics, not the exit status, so this becomes `error`.
- Environment reads are not observed (`caps.env` false). Directory listings and probes are not observed (`caps.dirs`, `caps.probes` false). A change to a file that is neither a task nor a declared input makes the engine fall back to running every file (`unobserved_input`), so a docs-only edit reruns the whole set. This is the same cost the TypeScript adapter pays.
- `context.tsconfig` is `"not-read"` because Biome does not read `tsconfig.json`.

## Open questions from the draft

- **Machine-readable file list:** not available in Biome 2.5.15. The text list is used. The strace fallback (PLAN 11.5) is not needed for the list, but it is still the only way to observe reads of files outside the declared set.
- **Per-file task count at PLAN 13 sizes:** not measured. Each run starts two Biome processes per 200 selected files, and discovery checks the whole repository once before planning.
- **Lockfile coverage of package plugins:** assumed, not verified against `node_modules` contents.

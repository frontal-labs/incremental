# turbopack adapter (draft, not approved)

Status: draft. PLAN tier: later (§4.3 `tsc, bundler inputs`: "observed build inputs for Turborepo or Nx cache keys; no build outputs stored").

## Task
A Turbopack build target: an app entry, for example `next build` for a route or the dev graph of one entry point. Task id: the entry's repo-relative path (D-2).

## What the recorder can observe
- The module graph: Turbopack knows every module it loads for an entry. The adapter reads the graph from its output (open question: whether the output is public and stable).
- Source files in that graph are inputs, hashed at read time.

## What it cannot observe
- Build outputs are not stored (PLAN §4.3). The adapter records inputs only.
- Environment variables read at build time, such as `NEXT_PUBLIC_*`. Use the env adapter's allowlist, or set capability false.
- Remote caches Turbopack may use. Those must not be trusted as proof of a clean run.
- Dynamic imports whose targets are chosen at runtime.

## Declared inputs
- `next.config.*`, `tsconfig.json`, `package.json`, the lockfile, `.env*` files if they are used at build time.

## Conformance cases (to write)
- Changing a module in the graph invalidates the entry.
- Changing a module outside the graph does not invalidate the entry.
- A dynamic import with an unresolved target is `dirty`.

## Open questions
- Whether Turbopack exposes its module graph. If not, the adapter falls back to `tsc`-style dependency analysis, which is a different and weaker input set.

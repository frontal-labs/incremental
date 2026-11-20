---
name: frontal-registry
description: Add, update, inspect, or synchronize Frontal registry components in this website using components.json, registry.config.ts, ui.lock.json, and the ui.frontal.dev mirror. Use when work involves shadcn CLI, registry items, mirrored UI files, dependencies, or registry drift.
---

# Frontal registry workflow

This website consumes the Frontal registry at
`https://ui.frontal.dev/r`. Read
[`../../.interfaces/COMPONENTS.md`](../../.interfaces/COMPONENTS.md),
[`../../.interfaces/PATTERNS.md`](../../.interfaces/PATTERNS.md), and
`components.json` before changing registry-managed UI.

## Local contract

- The shadcn namespace is `@frontal-labs`; it is a registry namespace, not a
  runtime package import.
- `components.json` uses `new-york`, RSC, TSX, CSS variables, Lucide, and the
  aliases `@/components`, `@/components/ui`, `@/lib/utils`, `@/lib`, and
  `@/hooks`.
- `registry.config.ts` mirrors `ui` and `shared` into
  `src/components/ui`, `hooks` into `src/hooks`, and `lib` / `base-ui` into
  `src/lib`.
- `utils` is ambient; `ui` and `fonts` are skipped roots. Registry roots are
  limited to UI, component, and hook types.
- `ui.lock.json` records file hashes, registry paths, dependencies, CSS
  metadata, and registry state.

## Safe workflow

1. Search the local mirror for an existing component and inspect its current
   source before requesting or adding another item.
2. Use the configured registry/shadcn workflow for registry components; keep
   imports rewritten to `@/` aliases.
3. Run `bun run sync:check` before and after registry-managed changes.
4. Run `bun run sync` to mirror updates and refresh `ui.lock.json`.
5. Use `bun run sync -- --only name-a,name-b` for a narrow sync when useful.
6. Run with `--force` only when intentionally replacing a locally modified
   managed file.

The sync script protects local modifications and only prunes files previously
owned by the lock. Do not manually delete managed files, commit registry-source
imports such as `@/registry/*`, or introduce `@frontal-labs/ui/*` imports.

When a visual change belongs to the upstream registry, preserve the local
mirror's generated/provenance model. When it is website-specific composition,
put it in `src/components/primitives`, `src/components/sections`, or the
appropriate page/shell module instead.

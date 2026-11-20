---
name: Frontal website interfaces
purpose: Entry point for the website UI contract and source precedence.
sources:
  - components.json
  - registry.config.ts
  - src/styles/globals.css
  - src/styles/cortex.css
  - src/styles/typeset.css
  - src/components/ui/*.tsx
  - ui.lock.json
rules:
  - Treat checked-in project files as the source of truth.
  - Use semantic tokens and existing components before adding new visual rules.
  - Inspect the active theme and component class strings before extending UI.
  - Use the relevant `frontal-*` skill and root Emil skill for the task.
---

# Frontal website interfaces

This is the interface guide for the Frontal website repository. It documents
the local implementation mirrored from `https://ui.frontal.dev/r` through the
shadcn configuration in `components.json`.

## Read first

Use semantic Tailwind classes and the compound components in
`src/components/ui`. The visual system is defined by `src/styles/cortex.css`
and `src/styles/typeset.css`; project-level additions live in
`src/styles/globals.css`.

This repository does not install or import `@frontal-labs/ui`. The `@frontal-labs`
name is the custom registry namespace used by shadcn, not a runtime package.

## Map

| File | Covers | Load when |
| --- | --- | --- |
| `OVERVIEW.md` | Stack, source precedence, project map | Always; start here |
| `TOKENS.md` | Semantic colors, themes, palette, charts, syntax | Choosing colors or surfaces |
| `SPACING.md` | Spacing, breakpoints, containers, radius | Laying out UI |
| `TYPOGRAPHY.md` | Type scale, fonts, `.typeset`, prose | Setting type or editorial content |
| `MOTION.md` | Easings, durations, shadows, reduced motion | Animating or elevating surfaces |
| `COMPONENTS.md` | UI inventory, geometry, variants, compound APIs | Using or changing a component |
| `PATTERNS.md` | App architecture, registry workflow, composition rules | Composing or adding UI |

## Stack contract

| Concern | Contract |
| --- | --- |
| Runtime | Next.js `16.3.4`, React `19.2`, TypeScript |
| Accessible primitives | `@base-ui/react` |
| Styling | Tailwind CSS v4 through `src/styles/globals.css` |
| Variant API | `class-variance-authority` (`cva`) |
| Class merging | `cn()` from `@/lib/utils` |
| Icons | `lucide-react` |
| UI alias | `@/components/ui` |
| Hooks / lib aliases | `@/hooks`, `@/lib` |
| Component marker | `data-slot` |
| Dark mode | Ancestor `.dark` via `@custom-variant dark` |
| Fixed layout mode | Ancestor `.layout-fixed` via `@custom-variant fixed` |

Use Server Components by default. Add `"use client"` only when state, effects,
event handlers, browser APIs, or a client-only dependency require it.

## Source precedence

When documentation and code disagree, use this order:

1. The active class strings and behavior in `src/components/ui`.
2. `src/styles/cortex.css`, `src/styles/typeset.css`, and
   `src/styles/globals.css`.
3. `components.json`, `registry.config.ts`, and `ui.lock.json` for registry
   paths, aliases, dependencies, and provenance.
4. These `.interfaces/*.md` files.

Do not use old paths such as `packages/ui`,
`/Users/gabrielfonseca/Documents/design-system`, or stale docs that describe a
separate `@frontal-labs/ui` package.

## Skills

- [`../skills/frontal-interface-system/SKILL.md`](../skills/frontal-interface-system/SKILL.md)
  — general interface work in this website.
- [`../skills/frontal-registry/SKILL.md`](../skills/frontal-registry/SKILL.md)
  — registry and shadcn synchronization.
- [`../skills/frontal-motion/SKILL.md`](../skills/frontal-motion/SKILL.md)
  — motion and animation work.
- [`../skills/emil-design-eng/SKILL.md`](../skills/emil-design-eng/SKILL.md)
  — Emil's design-engineering principles.

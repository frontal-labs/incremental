---
name: Frontal website composition patterns
purpose: Composition, architecture, accessibility, and registry rules.
sources:
  - components.json
  - registry.config.ts
  - src/components/ui/*.tsx
  - src/components/pages/*.tsx
  - src/components/sections/*.tsx
  - src/components/primitives/*.tsx
rules:
  - Reuse existing components and compound parts before adding new APIs.
  - Preserve focus-visible, aria-*, data-*, disabled, and dark selectors.
  - Keep registry-managed code portable and alias-based.
  - Use `../skills/frontal-interface-system/SKILL.md` for interface composition.
---

# Composition rules

| Do | Why |
| --- | --- |
| Use semantic surface and content tokens | Keeps light and dark themes coherent |
| Reuse compound parts and `render` / slot props | Matches the Base UI and registry composition model |
| Preserve focus, ARIA, data-state, disabled, and dark selectors | These encode interaction and accessibility behavior |
| Use `data-slot` on new compound roots | Keeps inspection and selector conventions consistent |
| Use shipped icon sizes (`size-4`, compact `size-3` / `size-3.5`) | Keeps controls aligned |
| Use `active:scale-[0.97]` only for button-like controls | Matches existing press feedback |

## Repository layers

- `src/components/ui` contains mirrored registry primitives and Frontal
  product/AI components. Do not put one-off page markup here.
- `src/components/primitives` contains website-specific reusable primitives.
- `src/components/sections` contains reusable marketing/content sections.
- `src/components/pages` contains page-level compositions.
- `src/components/shell` contains navigation, chrome, and application shells.
- `src/hooks` and `src/lib` contain shared behavior and utilities.

Use `bg-background` for the main surface, `bg-subtle` for recessed regions,
and `border-border` for real edges. Keep page-shell, header, hero, and section
content aligned to `max-w-page`.

## Accessibility

- Use the accessible `@base-ui/react` primitive instead of recreating keyboard,
  focus, dismissal, or positioning behavior.
- Use semantic `button`, `a`, `input`, `label`, `nav`, `main`, `section`, and
  heading elements.
- Icon-only controls need `aria-label`; decorative icons need `aria-hidden`.
- Specify input `type` explicitly. Provide labels and meaningful image alt text.
- Keep invalid, disabled, open, selected, and pressed states visible in both
  themes.

## Registry workflow

`components.json` uses shadcn `new-york`, RSC, TSX, CSS variables, Lucide, and
these aliases: `@/components`, `@/components/ui`, `@/lib/utils`, `@/lib`, and
`@/hooks`. The custom registry namespace is `@frontal-labs`.

`registry.config.ts` mirrors `ui` and `shared` into `src/components/ui`, hooks
into `src/hooks`, and `lib` / `base-ui` into `src/lib`. `ui.lock.json` stores
the resolved registry files, hashes, dependencies, and CSS metadata. Run:

```sh
bun run sync:check
bun run sync
bun run sync -- --only button,dialog
```

Sync protects locally modified managed files unless `--force` is used and only
prunes files previously owned by the lock. Do not leave imports from
`@/registry/*`, `@frontal-labs/ui/*`, or other registry-source paths in the
workspace.

For composition decisions, use
[`../skills/emil-design-eng/SKILL.md`](../skills/emil-design-eng/SKILL.md) and
[`../skills/vercel-composition-patterns/SKILL.md`](../skills/vercel-composition-patterns/SKILL.md).

---
name: frontal-interface-system
description: Build or modify UI in the Frontal website using its local Cortex tokens, component mirror, layouts, typography, and accessibility conventions. Use for frontend work in this repository; not for generic React or unrelated application logic.
---

# Frontal interface system

Use this skill for interface changes in the Frontal website. Start with
[`../../.interfaces/OVERVIEW.md`](../../.interfaces/OVERVIEW.md), then read only
the focused guide needed for the request:

- [`../../.interfaces/TOKENS.md`](../../.interfaces/TOKENS.md) for color or theme.
- [`../../.interfaces/SPACING.md`](../../.interfaces/SPACING.md) for layout or geometry.
- [`../../.interfaces/TYPOGRAPHY.md`](../../.interfaces/TYPOGRAPHY.md) for type or prose.
- [`../../.interfaces/MOTION.md`](../../.interfaces/MOTION.md) for animation or elevation.
- [`../../.interfaces/COMPONENTS.md`](../../.interfaces/COMPONENTS.md) for UI APIs.
- [`../../.interfaces/PATTERNS.md`](../../.interfaces/PATTERNS.md) for composition and registry boundaries.

## Project decisions

- Treat `src/styles/cortex.css`, `src/styles/typeset.css`, and
  `src/styles/globals.css` as the visual source of truth.
- Search `src/components/ui` before creating a primitive. Use its compound
  parts, `data-slot` markers, `cn()` helper, Base UI behavior, and existing
  variant API.
- Keep page composition in `src/components/pages`, `src/components/sections`,
  and `src/components/shell`; keep one-off page markup out of `src/components/ui`.
- Use semantic classes such as `bg-background`, `bg-card`,
  `text-foreground`, `text-muted-foreground`, `border-border`, and `ring-ring`.
  Never bake a light-theme value into a component.
- Use Figtree, the project font variables, the 4px spacing unit, and the
  existing responsive/container tokens.
- Preserve keyboard behavior, focus-visible styles, ARIA attributes,
  data-state selectors, disabled states, and reduced-motion behavior.
- Use Server Components by default; add `"use client"` only when the component
  needs client behavior.

## Workflow

1. Identify the existing component, token, or layout pattern that is closest.
2. Read its source class string and the focused `.interfaces` guide.
3. Make the smallest composition or variant change that fits the system.
4. Verify both `.dark` and relevant responsive states.
5. Run the narrowest relevant checks, then `bun run lint` when code changed.

For motion, also load the root [`../animate/SKILL.md`](../animate/SKILL.md) or
review skill as appropriate. For reusable React APIs, consult
[`../vercel-composition-patterns/SKILL.md`](../vercel-composition-patterns/SKILL.md).

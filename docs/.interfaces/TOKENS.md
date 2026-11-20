---
name: Frontal website color tokens
purpose: Semantic color tokens, theme scopes, raw palette, charts, and syntax colors.
sources:
  - src/styles/cortex.css
  - src/styles/globals.css
rules:
  - Use shipped semantic tokens instead of hard-coded palette values.
  - Resolve values from the active theme; never copy light values into dark UI.
  - Use `../skills/frontal-interface-system/SKILL.md` for website-specific UI work.
---

# Color tokens

Use these semantic utilities for surfaces, content, actions, status, borders,
and focus. They resolve through CSS variables in `cortex.css`.

| Purpose | Tailwind token | CSS variable |
| --- | --- | --- |
| Page | `bg-background text-foreground` | `--background`, `--foreground` |
| Subtle surface | `bg-subtle text-subtle-foreground` | `--subtle`, `--subtle-foreground` |
| Card | `bg-card text-card-foreground` | `--card`, `--card-foreground` |
| Popover | `bg-popover text-popover-foreground` | `--popover`, `--popover-foreground` |
| Code | `bg-code text-code-foreground` | `--code`, `--code-foreground` |
| Primary action | `bg-primary text-primary-foreground` | `--primary`, `--primary-foreground` |
| Secondary action | `bg-secondary text-secondary-foreground` | `--secondary`, `--secondary-foreground` |
| Muted control | `bg-muted text-muted-foreground` | `--muted`, `--muted-foreground` |
| Accent | `bg-accent text-accent-foreground` | `--accent`, `--accent-foreground` |
| Brand | `bg-brand text-brand-foreground` | `--brand`, `--brand-foreground` |
| Status | `destructive`, `warning`, `info`, `success` | matching `--*` variables |
| Edges / focus | `border-border`, `border-input`, `ring-ring` | `--border`, `--input`, `--ring` |

Theme scopes are `:root` and `.dark`. The theme also exposes raw Tailwind
scales for `gray`, `blue`, `red`, `amber`, `green`, `teal`, `purple`, and
`pink`, with steps `100`–`1000`, plus gray-alpha values. Prefer semantic tokens
unless raw color is needed for a chart, syntax token, or explicit status.

## Theme-specific values

The light semantic baseline includes:

| Variable | Value |
| --- | --- |
| `--background` | `oklch(1 0 0)` |
| `--foreground` | `oklch(0.145 0 0)` |
| `--subtle` | `oklch(0.985 0 0)` |
| `--card`, `--popover` | `oklch(1 0 0)` |
| `--primary` | `oklch(0.205 0 0)` |
| `--secondary` | `oklch(0.955 0 0)` |
| `--muted` | `oklch(0.982 0 0)` |
| `--accent` | `oklch(0.94 0 0)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` |
| `--warning` | `oklch(0.769 0.188 70.08)` |
| `--border` | `oklch(0 0 0 / 8%)` |
| `--input` | `oklch(0.922 0 0)` |
| `--ring` | `oklch(0.708 0 0)` |

Dark values are declared in `.dark`; use variables, not these light literals.
Brand is the blue `oklch(0.5151 0.2399 257.85)` value in the root theme.

## Data and code

Chart variables include grid, axis, `chart-1` through `chart-5`, reference
lines, actual/forecast lines, tooltip cursor, patterns, bars, gradients, and
secondary lines. Syntax highlighting variables include `--sh-keyword`,
`--sh-string`, `--sh-class`, `--sh-entity`, `--sh-property`,
`--sh-identifier`, `--sh-jsxliterals`, `--sh-sign`, `--sh-comment`,
`--sh-space`, and `--sh-break`.

The code surface is `bg-code`; do not use `bg-muted` for code when the code
token is the intended surface.

For design judgment beyond token lookup, use
[`../skills/emil-design-eng/SKILL.md`](../skills/emil-design-eng/SKILL.md).

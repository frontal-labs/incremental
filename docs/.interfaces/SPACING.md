---
name: Frontal website spacing and radius
purpose: Spacing scale, breakpoints, containers, and corner radii.
sources:
  - src/styles/cortex.css
  - src/styles/globals.css
rules:
  - Tailwind spacing is n × 4px.
  - Preserve intentional arbitrary values in shipped components.
  - Use `../skills/frontal-interface-system/SKILL.md` for layout decisions.
---

# Spacing and layout

The base spacing token is `--spacing: 0.25rem` (`4px`). Common values are:

| Utility | Size |
| --- | ---: |
| `1` | 4px |
| `1.5` | 6px |
| `2` | 8px |
| `2.5` | 10px |
| `3` | 12px |
| `4` | 16px |
| `6` | 24px |
| `8` | 32px |

## Responsive layout

| Breakpoint | Width |
| --- | ---: |
| `sm` | 640px |
| `md` | 768px |
| `lg` | 1024px |
| `xl` | 1280px |
| `2xl` | 1536px |

Container tokens run from `3xs=256px` through `9xl=1536px`. The site page
container is `max-w-page=1440px`, declared in `globals.css`; keep page-shell,
header, hero, and section edges aligned to it.

Do not replace component-specific values with a normalized spacing rule.
Registry components intentionally use values such as `p-3`, `p-4`, `h-7`–`h-10`,
and occasional arbitrary values.

## Radius

| Token | Value | Utility |
| --- | ---: | --- |
| `xs` | 2px | `rounded-xs` |
| `sm` | 4px | `rounded-sm` |
| `md` | 6px | `rounded-md` |
| `lg` | 8px | `rounded-lg` |
| `xl` | 12px | `rounded-xl` |
| `2xl` | 16px | `rounded-2xl` |
| `3xl` | 24px | `rounded-3xl` |
| `4xl` | 32px | `rounded-4xl` |

The default radius is 8px. `rounded-md` is the normal control and surface
radius; `rounded-full` is reserved for pills, badges, and circular controls.

For density, hierarchy, and restraint beyond numeric values, use
[`../skills/emil-design-eng/SKILL.md`](../skills/emil-design-eng/SKILL.md).

---
name: Frontal website motion and elevation
purpose: Easings, durations, shadows, and reduced-motion behavior.
sources:
  - src/styles/cortex.css
  - src/styles/globals.css
rules:
  - Use shipped easings and durations for shared UI behavior.
  - Prefer transform and opacity; respect prefers-reduced-motion.
  - Use `../skills/frontal-motion/SKILL.md` and the matching root Emil motion skill.
---

# Motion and elevation

| Token | Value |
| --- | --- |
| `ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` |
| `ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` |
| `ease-exit` | `cubic-bezier(0.7, 0, 0.84, 0)` |
| `ease-disclosure` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` |
| Fast | 150ms |
| Button | 160ms |
| Standard | 200ms |
| Overlay | 250ms |
| Progress | 300ms |
| Panel | 400ms |

Shared shadow variables are `--cortex-shadow-menu`,
`--cortex-shadow-small`, `--cortex-shadow-border-small`, and the background /
border variants defined in `cortex.css`. Use the generated `shadow-menu` token
or the component's existing shadow class rather than inventing a near-match.

## Guidance

- Animate `transform` and `opacity` where possible; avoid layout properties
  during interaction.
- Use `ease-disclosure` for height reveals and the drawer curve for drawers.
- Keep overlays and panels within the established duration range.
- `globals.css` already reduces dropdown, mobile, accordion, and disclosure
  animation durations under `prefers-reduced-motion: reduce`; new motion must
  provide an equivalent reduced-motion path.
- Do not add motion to every state. Animate changes that clarify continuity,
  hierarchy, or feedback.

## Skills

Use [`../skills/frontal-motion/SKILL.md`](../skills/frontal-motion/SKILL.md) as
the website-specific router. It points to Emil's
[`../skills/emil-design-eng/SKILL.md`](../skills/emil-design-eng/SKILL.md),
[`../skills/animate/SKILL.md`](../skills/animate/SKILL.md), and
[`../skills/review-animations/SKILL.md`](../skills/review-animations/SKILL.md)
skills as needed.

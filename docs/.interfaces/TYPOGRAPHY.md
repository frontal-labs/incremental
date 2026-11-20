---
name: Frontal website typography
purpose: Type scale, font variables, editorial rhythm, and prose behavior.
sources:
  - src/styles/cortex.css
  - src/styles/globals.css
  - src/styles/typeset.css
rules:
  - Use the project font variables and Tailwind type scale.
  - Use `.typeset` or the configured prose styles for editorial content.
  - Use `../skills/frontal-interface-system/SKILL.md` for website typography work.
---

# Typography

| Family | Project value |
| --- | --- |
| Sans / body | `var(--font-figtree), system-ui, sans-serif` |
| Headings | `var(--font-heading)`; Figtree, normally weight `600` |
| Serif | `var(--font-serif)`; Lora, Georgia fallback |
| Mono | `var(--font-mono)`; Geist mono, monospace fallback |

The values are supplied by `next/font` in the application layout and mapped in
`globals.css`. Use `font-sans`, `font-heading`, `font-serif`, and `font-mono`
instead of naming a different font in a component.

## Scale and rhythm

| Token | Size | Default leading |
| --- | ---: | ---: |
| `text-xs` | 12px | 1 / 0.75 |
| `text-sm` | 14px | 1.25 / 0.875 |
| `text-base` | 16px | 1.5 |
| `text-lg` | 18px | 1.75 / 1.125 |
| `text-xl` | 20px | 1.75 / 1.25 |
| `text-2xl` | 24px | 2 / 1.5 |
| `text-3xl` | 30px | 1.2 |
| `text-4xl` | 36px | 2.5 / 2.25 |
| `text-5xl` | 48px | 1 |
| `text-6xl` | 60px | 1 |
| `text-7xl` | 72px | 1 |
| `text-8xl` | 96px | 1 |
| `text-9xl` | 128px | 1 |

Weights are the standard `100`–`900` range. Leading tokens are `tight=1.25`,
`snug=1.375`, `normal=1.5`, `relaxed=1.625`, and `loose=2`. Tracking tokens
range from `tighter=-0.05em` through `widest=0.1em`.

## `.typeset`

`.typeset` uses inherited body type, heading font `var(--font-heading)`, mono
font `var(--font-mono)`, `1.75` leading, and `1.25em` flow between blocks. It
uses `1.125em` below `48rem`, then `var(--typeset-size)` at larger widths.

Headings use weight `600`; `h5` and `h6` use `500`; `h6` is muted, uppercase,
and tracked at `0.08em`. Headings own the space below them, links use an
underline that strengthens on hover, and focused links use the theme ring.

The `.prose` overrides in `globals.css` keep MDX content on Figtree and map
headings, links, code, rules, tables, and muted content to the local semantic
tokens. Do not reintroduce the typography plugin's generic font fallback.

For optical hierarchy and restraint, use
[`../skills/emil-design-eng/SKILL.md`](../skills/emil-design-eng/SKILL.md).

---
name: Frontal website components
purpose: Shipped component inventory, geometry, variants, and composition APIs.
sources:
  - src/components/ui/*.tsx
  - ui.lock.json
rules:
  - Inspect the local source class string before adding a variant.
  - Prefer exported compound parts over new monolithic APIs.
  - Use `../skills/frontal-interface-system/SKILL.md` for component work.
---

# Components

Components are mirrored into `src/components/ui` from the Frontal registry.
They are imported with `@/components/ui/<name>` and use `@/lib/utils` for
class merging. There is no package import from `@frontal-labs/ui`.

## Geometry and variants

| Component | Default geometry | Variants / sizes |
| --- | --- | --- |
| Button | `rounded-md`; default icon `size-4` | `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`, `brand`; sizes `xs=24px`, `sm=28px`, `default=32px`, `lg=36px`, `xl=40px`; shapes `default`, `pill` |
| Input | `h-8 rounded-md px-2.5 py-1 text-sm` | Native input types |
| Textarea | `rounded-md px-2.5 py-2 text-sm` | Native textarea props |
| Badge | `h-5 rounded-full px-2 py-0.5 text-xs` | `default`, `secondary`, `destructive`, `outline`, `ghost`, `link` |
| Card | `rounded-md ring-1 ring-foreground/10` | `size=default` (`gap-4 py-4`) and `size=sm` (`gap-3 py-3`) |
| Dialog | `rounded-md p-4` | `size=default` (`384px`) and `size=sm` (`320px`) |
| Alert dialog | `rounded-md p-4` | `size=default` (`384px`) and `size=sm` (`320px`) |
| Popover / hover card | `w-64 rounded-md p-2.5` | Base UI handles positioning |
| Progress | `h-1 rounded-full` | Indicator transitions over `300ms` |
| Radio / checkbox | `size-4` control | Focus ring and `aria-invalid` states |

These are defaults, not normalization rules. Other sources intentionally use
`rounded-sm`, `p-3`, `p-4`, `h-7`–`h-10`, and arbitrary values.

## Component families

The current directory includes:

- Foundations: accordion, alert, alert-dialog, aspect-ratio, avatar, badge,
  blockquote, breadcrumb, button, button-group, calendar, callout, card,
  carousel, chart, checkbox, checkbox-group, collapsible, combobox, command,
  command-prompt, context-menu, controls, dialog, drawer, dropdown-menu, empty,
  field, fieldset, file-upload, form, frame, group, hover-card, input,
  input-group, input-otp, item, kbd, label, menu, menubar, meter, multi-select,
  native-select, navigation-menu, number-field, otp-field, pagination, panel,
  popover, preview-card, progress, radio-group, resizable, scroll-area, select,
  separator, sheet, sidebar, skeleton, slider, snippet, sonner, sources,
  spinner, split-button, switch, table, tabs, textarea, theme-switcher, toggle,
  toggle-group, toaster, toolbar, and tooltip.
- Product / AI: artifact, attachment, audio-player, autocomplete, bubble,
  canvas, chain-of-thought, checkpoint, choicebox, code-block, commit,
  connection, context, conversation, edge, environment-variables, marker,
  mermaid, message, message-scroller, mic-selector, model-selector, node,
  node-toolbar, open-in-chat, plan, prompt-input, questionnaire, queue,
  reasoning, sandbox, schema-display, shimmer, show-more, speech-input,
  stack-trace, suggestion, tool, transcription, and web-preview.

## Composition

Prefer shipped compound parts such as `CardHeader` + `CardContent` +
`CardFooter` or `DialogTrigger` + `DialogContent`. Preserve the component's
`focus-visible`, `aria-*`, `data-*`, `disabled`, `dark`, and `data-slot`
selectors when extending it. Check the actual file before relying on a variant
or part name.

For visual judgment use
[`../skills/emil-design-eng/SKILL.md`](../skills/emil-design-eng/SKILL.md). For
React API composition use
[`../skills/vercel-composition-patterns/SKILL.md`](../skills/vercel-composition-patterns/SKILL.md).

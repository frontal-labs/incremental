---
name: frontal-motion
description: Design or review web animation in the Frontal website using its Cortex motion tokens, reduced-motion rules, and existing Emil motion guidance. Use for transitions, entrances, drawers, disclosures, press feedback, or animation audits in this repository.
---

# Frontal motion

Read [`../../.interfaces/MOTION.md`](../../.interfaces/MOTION.md) and the
relevant source in `src/styles/globals.css` or `src/styles/cortex.css` first.
The local token values are authoritative. Then load the root Emil skill that
matches the task:

- [`../animate/SKILL.md`](../animate/SKILL.md) when building motion.
- [`../review-animations/SKILL.md`](../review-animations/SKILL.md) when reviewing motion.
- [`../improve-animations/SKILL.md`](../improve-animations/SKILL.md) when auditing a surface.
- [`../find-animation-opportunities/SKILL.md`](../find-animation-opportunities/SKILL.md) when proposing opportunities without implementing them.
- [`../emil-design-eng/SKILL.md`](../emil-design-eng/SKILL.md) for the underlying design philosophy.

## Local motion contract

- Use `ease-out`, `ease-in-out`, `ease-drawer`, `ease-exit`, and
  `ease-disclosure` from Cortex; do not invent a parallel curve.
- Use the established duration bands: `150ms` fast, `160ms` button, `200ms`
  standard, `250ms` overlay, `300ms` progress, and `400ms` panel.
- Prefer `transform` and `opacity`. Height is acceptable for the existing
  accordion/collapsible disclosure pattern; avoid introducing layout-thrashing
  animation elsewhere.
- Use existing Tailwind animation tokens from `globals.css` where available:
  dropdown, mobile, accordion, and visual animation tokens are already part of
  the project system.
- Preserve the global `prefers-reduced-motion` behavior and provide an
  equivalent reduced-motion path for new animation.
- Do not animate frequently repeated navigation or reading content merely for
  decoration. Name the purpose—feedback, spatial consistency, state
  indication, preventing a jarring change, explanation, or rare delight—before
  implementing.

## Verification

Check the interaction at the trigger, during interruption, on exit, in dark
mode, and with reduced motion enabled. Prefer the existing component's state
selectors and Base UI lifecycle over a parallel animation wrapper.

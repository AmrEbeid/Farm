---
"@amrebeid/ui": minor
---

KpiCard: add a non-colour VALENCE mark to the delta for WCAG 1.4.1 (use of colour) — `⚠` for
`deltaDirection="down"` (attention) and `✓` for `"up"` (positive), aria-hidden (the delta text
carries the meaning for assistive tech). Uses a valence mark rather than a ▲/▼ direction arrow so it
never falsely claims "increased/decreased" (e.g. a positive over-budget variance is coloured "down"
for attention). Colours are unchanged; the mark is additive.

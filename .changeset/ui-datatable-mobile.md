---
"@amrebeid/ui": minor
---

DataTable mobile card reflow + larger pagination tap targets — additive and backward-compatible; the desktop table and the existing column API are unchanged.

- `DataTable`: below ~48rem the table now reflows into one stacked card per row, each cell shown as a `label: value` pair. The label is the column's header (taken from a new `data-label` attribute on each `<td>`, derived from string/number headers; rich JSX headers are skipped so no broken label renders). The header row is moved off-screen with a visually-hidden pattern but kept for assistive tech. Reflow is RTL-correct (logical properties only) and is on by default; pass the new `reflow="scroll"` prop to keep the legacy horizontal-scroll behaviour. Desktop (≥48rem) rendering is untouched.
- `Pagination`: page and prev/next buttons now meet the ~44px minimum tap target on touch devices (`@media (pointer:coarse)`), per WCAG 2.5.5 / 2.5.8. Pointer/desktop sizing is unchanged.

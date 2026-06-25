---
"@amrebeid/ui": minor
---

Accessibility improvements — additive, backward-compatible, no visual change.

- `Tabs`: implements the full WAI-ARIA tabs pattern — roving tabindex (only the active tab is in the tab order) and ArrowLeft/ArrowRight/Home/End keyboard navigation that activates the focused tab. Detects the tablist's computed `direction` so under `dir="rtl"` ArrowRight moves to the previous (visually right) tab. Each tab now carries a stable `id` and an `aria-controls` pointing at its panel; two helpers `tabId(id)`/`tabPanelId(id)` are exported so consumers can wire their own `role="tabpanel"` panels (`id={tabPanelId(id)}` + `aria-labelledby={tabId(id)}`).
- `Field`: error wiring (`aria-invalid` + `aria-describedby`) now reaches custom child controls (Input/Select/Textarea), not just the built-in `<input>`. When `error` is set and a valid element child is passed, the attributes are injected via `cloneElement`, preserving any `aria-describedby` the consumer already provided (the error id is appended, not overwritten).
- `Pagination`: prev/next buttons get an accessible-name fallback ("Previous"/"Next") so they are never unlabeled when `prevLabel`/`nextLabel` are omitted.
- `Modal` / `Drawer`: the close button uses `closeLabel || "Close"` so it always has an accessible name even if an empty `closeLabel` is passed.

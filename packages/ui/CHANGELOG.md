# @amrebeid/ui

## 1.2.0

### Minor Changes

- a125c35: Accessibility improvements — additive, backward-compatible, no visual change.

  - `Tabs`: implements the full WAI-ARIA tabs pattern — roving tabindex (only the active tab is in the tab order) and ArrowLeft/ArrowRight/Home/End keyboard navigation that activates the focused tab. Detects the tablist's computed `direction` so under `dir="rtl"` ArrowRight moves to the previous (visually right) tab. Each tab now carries a stable `id` and an `aria-controls` pointing at its panel; two helpers `tabId(id)`/`tabPanelId(id)` are exported so consumers can wire their own `role="tabpanel"` panels (`id={tabPanelId(id)}` + `aria-labelledby={tabId(id)}`).
  - `Field`: error wiring (`aria-invalid` + `aria-describedby`) now reaches custom child controls (Input/Select/Textarea), not just the built-in `<input>`. When `error` is set and a valid element child is passed, the attributes are injected via `cloneElement`, preserving any `aria-describedby` the consumer already provided (the error id is appended, not overwritten).
  - `Pagination`: prev/next buttons get an accessible-name fallback ("Previous"/"Next") so they are never unlabeled when `prevLabel`/`nextLabel` are omitted.
  - `Modal` / `Drawer`: the close button uses `closeLabel || "Close"` so it always has an accessible name even if an empty `closeLabel` is passed.

- 1507a8c: DataTable mobile card reflow + larger pagination tap targets — additive and backward-compatible; the desktop table and the existing column API are unchanged.

  - `DataTable`: below ~48rem the table now reflows into one stacked card per row, each cell shown as a `label: value` pair. The label is the column's header (taken from a new `data-label` attribute on each `<td>`, derived from string/number headers; rich JSX headers are skipped so no broken label renders). The header row is moved off-screen with a visually-hidden pattern but kept for assistive tech. Reflow is RTL-correct (logical properties only) and is on by default; pass the new `reflow="scroll"` prop to keep the legacy horizontal-scroll behaviour. Desktop (≥48rem) rendering is untouched.
  - `Pagination`: page and prev/next buttons now meet the ~44px minimum tap target on touch devices (`@media (pointer:coarse)`), per WCAG 2.5.5 / 2.5.8. Pointer/desktop sizing is unchanged.

- 78cf9c7: Tree-shake recharts out of the global client bundle — additive, backward-compatible.

  The library previously compiled to a single bundled `dist/index.js` whose top-level `import "recharts"` (from the chart components) entered a consumer's bundle the moment **any** component was imported. Because everything lived in one module, recharts (~384 KB) could not be tree-shaken out, so it loaded on every Farm OS route — including `/` and `/login`.

  The build now emits two entry points with code splitting (`tsup` `splitting: true`): the recharts-based chart components (`BarChart`, `LineChart`, `DoughnutChart`, `useChartTokens`) are hoisted into their own shared chunk that bundlers drop from consumers that don't reference a chart.

  - Public API unchanged: `import { BarChart } from "@amrebeid/ui"` still works (the barrel re-exports the chart components).
  - New additive subpath: `import { BarChart } from "@amrebeid/ui/charts"` imports charts without touching the main barrel. Preferred for app code so recharts only enters chart routes.
  - `sideEffects` remains accurate (only `*.css`).

  Measured in the Farm OS app build: recharts went from the shared chunk on **18/18** routes (376 KB each) to only the **2** routes that render a chart; non-chart routes (`/`, `/login`, `/_not-found`, …) dropped ~376 KB of First Load JS.

### Patch Changes

- 1d0f7ed: Respect `prefers-reduced-motion: reduce`. Added a global media block in the library CSS that collapses non-essential transitions and animations to near-instant (~0.01ms) for users who have requested reduced motion, so overlays, drawers, toasts, the modal pop/fade, progress fills and hover transforms no longer slide, pop or scale. Looping indicators (button/icon-button spinners and the skeleton shimmer) are stopped entirely. Content visibility is preserved — opacity-based entrances resolve immediately rather than being suppressed. No change for default (motion-OK) users, and no component logic or visual design changed.

## 1.1.1

### Patch Changes

- 0eba9ba: Fix: the AppShell mobile off-canvas sidebar peeked ~90px on-screen in RTL. The closed drawer
  re-anchored to the wrong edge (`inset-inline-end` double-flips the already-logical
  `inset-inline-start`), leaving it partly visible and pushing field/mobile content. Now only the
  physical `translateX` sign is flipped for RTL, so the closed drawer sits fully off-screen — no
  horizontal overflow on mobile/field views.

## 1.1.0

### Minor Changes

- dc7027f: White-label brand robustness, URL/XSS hardening, and non-finite guards (from the 2026-06-23 review).

  - Fix: a malformed tenant `brand` no longer crashes the subtree — `ThemeProvider` falls back to the default theme.
  - Add/Fix: `ThemeProvider` exposes the resolved brand vars via `useTheme().brandStyle`, and `Modal`/`Drawer`/`Toaster` spread them onto their `document.body` portal roots so the white-label brand reaches portalled content.
  - Fix: `Breadcrumbs`/`NavItem` `href` and `Avatar` `src` are scheme-sanitized (`javascript:`/`data:text/html` neutralized via `safeHref`/`safeImgSrc`); `Avatar` falls back to initials on image load error.
  - Fix: the toast auto-dismiss timer no longer restarts every live toast when another toast is added/removed.
  - Fix: `Pagination` no longer crashes on a non-finite `pageCount`; `Progress` guards a non-finite `value`.

## 1.0.0

Publish-ready 1.0 — the first release of the Farm OS design system.

### Major

- **Full v1 component catalog.** Forms (IconButton, Input, Textarea, NumberField, Select, Combobox, Checkbox, RadioGroup, Switch, DateField, FormRow), data display (Stat, DataTable, Timeline, DescriptionList, Avatar, Tooltip, Pagination, EmptyState, Skeleton), feedback/overlays (Modal, Drawer, ConfirmDialog, Toast/Toaster/useToast), navigation/shell (AppShell, SidebarNav, Breadcrumbs, SearchInput, RoleSwitcher), charts (BarChart, LineChart, DoughnutChart — Recharts wrappers), domain (LoopStepper, PhaseCard, StatusPill, PalmGrid, FileTimeline, ApprovalChain), plus the foundational Button, Tag, Card, KpiCard, Alert, Progress, Field, VerdictBanner, Tabs.
- **White-label theming.** Two-tier token system (primitives → role tokens) with a `ThemeProvider` driving light/dark × density × radius × brand via CSS-variable cascade; SSR-safe, no re-render.
- **Token-purity build gate.** Component CSS references only role tokens + numeric scales; hardcoded colors fail the build.
- **RTL-first.** Logical CSS throughout; presentational-only (no strings/i18n in components).
- Ships ESM + CJS + type declarations + a single bundled `styles.css`; published privately to GitHub Packages under the `@amrebeid` scope.

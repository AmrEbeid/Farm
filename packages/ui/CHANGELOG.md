# @amrebeid/ui

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

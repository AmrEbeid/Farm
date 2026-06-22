# @amrebeid/ui

## 1.0.0

Publish-ready 1.0 — the first release of the Farm OS design system.

### Major

- **Full v1 component catalog.** Forms (IconButton, Input, Textarea, NumberField, Select, Combobox, Checkbox, RadioGroup, Switch, DateField, FormRow), data display (Stat, DataTable, Timeline, DescriptionList, Avatar, Tooltip, Pagination, EmptyState, Skeleton), feedback/overlays (Modal, Drawer, ConfirmDialog, Toast/Toaster/useToast), navigation/shell (AppShell, SidebarNav, Breadcrumbs, SearchInput, RoleSwitcher), charts (BarChart, LineChart, DoughnutChart — Recharts wrappers), domain (LoopStepper, PhaseCard, StatusPill, PalmGrid, FileTimeline, ApprovalChain), plus the foundational Button, Tag, Card, KpiCard, Alert, Progress, Field, VerdictBanner, Tabs.
- **White-label theming.** Two-tier token system (primitives → role tokens) with a `ThemeProvider` driving light/dark × density × radius × brand via CSS-variable cascade; SSR-safe, no re-render.
- **Token-purity build gate.** Component CSS references only role tokens + numeric scales; hardcoded colors fail the build.
- **RTL-first.** Logical CSS throughout; presentational-only (no strings/i18n in components).
- Ships ESM + CJS + type declarations + a single bundled `styles.css`; published privately to GitHub Packages under the `@amrebeid` scope.

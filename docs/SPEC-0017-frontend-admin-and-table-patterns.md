# SPEC-0017 — Frontend: master-table, filters, export & entity-360 patterns (ported from Zeal admin panel)

*Status: **DRAFT for Owner review** — design only, no build yet. Captures the proven admin/table/dashboard
patterns from the Owner's prior **Zeal Internal OS** admin panel and adapts them to Farm OS's stack
(Next.js + `@amrebeid/ui`, Arabic-RTL, RLS/RPC-gated writes) so Farm reuses what works instead of
rebuilding. Companion to [`SPEC-0011`](SPEC-0011-planning-workspace.md), [`SPEC-0012`](SPEC-0012-account-admin-and-ux-gaps.md),
[`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md) (page-help), and the `@amrebeid/ui` design system.*

## 1. Why
The Owner already built a mature admin panel in Zeal Internal OS (TanStack + shadcn). Its patterns — a
single reusable master-table, saved-view filters, CSV export on every table, and tabbed entity-360 pages —
let ~25 admin screens be one declaration each. Farm OS has the visual foundation (`@amrebeid/ui`:
`SimpleTable`, `KpiCard`, `AppShell`, `Drawer`, `lib/nav.ts`, `num/pct/fmtDate`, page-help) but **lacks**
the productivity layer: no reusable master-table, no shared filter/saved-views, **no export**, and flat
(non-tabbed) detail pages. This spec ports the patterns (not the code — different stack) so Farm's
remaining admin/master-data and 360 screens are fast to build and consistent.

## 2. Reference patterns (Zeal Internal OS — verified)
- `src/components/admin/simple-master-table.tsx` — columns + typed `fields` → table + auto create/edit
  dialog + role-gate (`canWrite`) + audit-on-write + `useLookupOptions` for FK selects.
- `src/routes/_authenticated/people/employees.index.tsx` + `components/people/saved-views-bar.tsx` —
  client-side search/multiselect filters + per-user saved views (`saved_views` table).
- `src/components/accounting/cfo-dashboard-view.tsx` (`handleExport`) — CSV blob download + a logged
  export audit event ("every table extractable").
- `src/routes/_authenticated/people/employees.$id.tsx` — entity-360: header summary + `Tabs`
  (Overview + related-record tables + Audit), with role-gated tab visibility.
- `src/components/accounting/ui.tsx` — `AccountingPageHeader` / `StatGrid` / `Stat` dashboard primitives.

## 3. Scope — five additions to `@amrebeid/ui` + Farm app
1. **`MasterTable`** — props: `columns: ColumnDef[]` (with `render`), `fields: FieldDef[]` (typed:
   text/number/date/select/checkbox/textarea → create/edit **Drawer**), `canWrite`, data source. **Writes
   go through gated RPCs** (`fn_save_*`), NOT raw `from().update()` (Farm's RLS/definer model); audit is
   server-side via `fn_audit` (no client log call). Arabic-RTL, tabular-numerals for numbers.
2. **`FilterBar` + saved views** — search + typed filter controls; optional `saved_views`-style
   persistence (org-scoped, RLS) keyed by a `tableKey`.
3. **`exportToCsv(rows, columns, filename)`** — pure util + an **Export** button slot on `SimpleTable`/
   `MasterTable`. Arabic-Indic-digit-safe; emits an `export` audit event for sensitive entity types
   (mirrors the people/compensation confidentiality posture — never export wage/PII without `payroll.read`).
4. **`EntityTabs` / 360 layout** — header summary + tab set + related-record tables; role-gated tabs.
   Apply to: **palm**, **sector**, **hawsha**, **purchase request**, **supplier**, **person** (overview +
   operations/events + attachments + audit).
5. **`PageHeader` + `StatGrid` + `Stat`** — consistent page header (title + actions + optional source-of-
   truth banner) and a compact stat grid (complements `KpiCard`).

## 4. Security / non-negotiable adaptations (differ from Zeal)
- **Writes via SECURITY-DEFINER RPCs**, never client DML — Farm tables are RLS + FORCE-RLS + EXECUTE-locked.
- **Server-side audit** (`fn_audit` triggers), not a client `log_audit` call.
- **Arabic-RTL-first** (#2), tabular numerals via `num/pct/fmtDate`; no Western-digit leaks.
- **Export respects confidentiality** (#PII): wage/contact PII export gated on `payroll.read` / need-to-know
  (SPEC-0006); never fabricate data in a view (#1).
- Role-gating is **two-layer**: nav/tab visibility (cosmetic) + RLS/RPC (enforced) — keep both.

## 5. Acceptance
- A new admin/master-data screen (e.g. suppliers, inventory items) is a single `MasterTable` declaration
  with a gated write RPC, role-gated, audited, exportable.
- Every list/table has a working Export (CSV) honoring confidentiality gates.
- palm/sector/hawsha/PR/supplier/person detail pages use the tabbed 360 layout.

## 6. Slices (each a gated PR)
1. `exportToCsv` util + Export button on `SimpleTable` (lowest-risk, immediate "extractable" win).
2. `PageHeader` + `StatGrid` + `Stat` primitives in `@amrebeid/ui`.
3. `MasterTable` (drawer CRUD via gated RPCs) + first adopter (suppliers or inventory items).
4. `FilterBar` + saved views (org-scoped table).
5. `EntityTabs` 360 layout + migrate `farm/palm/[id]` (then sector/hawsha/PR/supplier/person).

## 7. Non-negotiables (this spec)
#1 (no fabricated data in views), #2 (Arabic-RTL + tabular numerals), PII/confidentiality on export,
writes through gated RPCs only, server-side audit. Design-only; no build until gated.

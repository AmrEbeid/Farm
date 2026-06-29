# Farm OS Product Master File

*Canonical product description for business, product, design, engineering, onboarding, and AI agents.
**Ground truth = the current `main` branch** (reconciled 2026-06-27 against migrations, routes, libs, RPCs, and
[`RECONCILE-001`](RECONCILE-001-main-ground-truth-2026-06-27.md)). Where this file and an older document
disagree, this file and RECONCILE-001 win. Items not verifiable on `main` are marked **Needs verification** or
**Draft PR (not on `main`)**. This is documentation only — it changes no product behavior.*

Last updated: 2026-06-27. Maintainers: Product + Owner (Amr Ebeid).

> **Reconcile note (reading this vs older docs):** three claims that float around older docs/PRs are corrected
> here against `main`: (1) **planned-vs-actual is built** (`reports/[planId]/pva`); (2) **Accounting P&L
> (`/accounting`, `lib/pnl.ts`, `sales`) and Care Academy (`/academy`) are NOT on `main`** — they are in
> unmerged **draft PRs #368 / #366** (migrations `0087`/`0088` not applied); (3) **prod is now at migration `0096`
> per DEPLOY-STATUS**; the README's "`0048`" body line is historical.

---

## 0. Knowledge System Index (this file is the hub)

This file is the **hub** of the Farm OS Product Knowledge System (designed in
[`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). Start here, then follow the link you need. Tier 1
(Phase 1) is the code-anchored foundation; later phases are built only when a concrete consumer exists.

| Artifact | Purpose | Status |
|---|---|---|
| **PRODUCT-MASTER-FILE.md** (this) | Canonical overview + page-by-page manual + built/partial/missing | ✅ L3 |
| [`RECONCILE-001`](RECONCILE-001-main-ground-truth-2026-06-27.md) | `main` ground-truth capability map | ✅ L3 |
| [`SPEC-0013`](SPEC-0013-commercial-saas-layer.md) | Commercial SaaS layer (billing/onboarding/admin) | Draft |
| [`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md) | In-app help + rule-based "Why?" + `pageMeta` + Health Score | Draft |
| [`SPEC-0015`](SPEC-0015-product-knowledge-system.md) | This knowledge system (phases, traceability, maturity) | Draft |
| [`FEATURE-REGISTRY.md`](FEATURE-REGISTRY.md) (Tier 1) | `FEAT-NNN` → routes/migrations/components/tests/spec | ✅ L3 |
| [`BUSINESS-RULES-CATALOG.md`](BUSINESS-RULES-CATALOG.md) (Tier 1) | `BR-NNN` → statement/enforced-by/test/FEAT | ✅ L3 |
| [`DOMAIN-DICTIONARY.md`](DOMAIN-DICTIONARY.md) (Tier 1) | TERM → definition/AR↔EN/source/relationships | ✅ L3 |
| [`RPC-CATALOG.md`](RPC-CATALOG.md) (Phase 2) | `RPC-NNN` → args/returns/guard/side-effects/BR/FEAT | ✅ L3 |
| [`DATA-DICTIONARY.md`](DATA-DICTIONARY.md) (Phase 2) | `TBL-NNN` → columns/FKs/RLS/FEAT (38 tables) | ✅ L3 |
| [`PERMISSIONS-MATRIX.md`](PERMISSIONS-MATRIX.md) (Phase 2) | roles × permissions × pages × actions + SoD | ✅ L3 |
| [`EVENT-CATALOG.md`](EVENT-CATALOG.md) (Phase 2) | event types/subtypes/statuses + anatomy + RPCs | ✅ L3 |
| [`REPORT-CATALOG.md`](REPORT-CATALOG.md) (Phase 2) | `RPT-NN` reports/dashboards + charts + filtering | ✅ L3 |
| [`PAGE-HELP.md`](PAGE-HELP.md) (SPEC-0014 content) | 5-question help block per page (drafted as docs) | ✅ L3 |
| [`WHY-CATALOG.md`](WHY-CATALOG.md) (SPEC-0014 content) | Rule-based "Why?" per error code + situation | ✅ L3 |
| [`DOCUMENTATION-HEALTH.md`](DOCUMENTATION-HEALTH.md) | DoD scorecard per page (baseline for the CI lint) | ✅ L3 |
| `docs/user-manual/` | Hand-written end-user manual (6 pages) | ✅ L2 |
| Storybook (`packages/ui`) | Component catalog — **link, don't duplicate** | ✅ |
| `pageMeta` / Help drawer / WhyButton (in-app) | `lib/page-help.ts`, `lib/why.ts`, `HelpDrawer.tsx`, `WhyButton.tsx` (wired in `AppChrome`) | ✅ Built — tsc/lint/159 tests green (SPEC-0014 A1/A2/A3); local/uncommitted |

Deferred catalogs (RPC/Event/Report, tenant lifecycle, metrics, training, AI knowledge graph, …) are phased in
[`SPEC-0015`](SPEC-0015-product-knowledge-system.md) §4 — not built until they have a consumer.

---

## 1. Executive Summary

**Farm OS (نظام تشغيل المزارع)** is an **Arabic-RTL-first, multi-tenant SaaS operating system for professional
farms**, built first around **owner-managed date-palm farms in Egypt/MENA** and designed to expand to other
crop/farm types. It is not accounting software and not a dashboard; it is the **daily operating brain of the
farm**.

The commercial wedge is a single question no competitor answers in Arabic at tree level: **"Given my plan, will
I run out of stock or budget — and what do I buy, when?"** — enforced through one controlled loop:

**Plan → Stock Coverage → Budget Gate → Approval → Execute → Actual Cost → Report.**

- **Live today:** the full operating loop, deployed on a dedicated cloud Supabase + Vercel
  (`ebeidfarm.business`), security-reviewed, on synthetic seed data for one reference tenant (Ebeid).
- **Positioning:** Arabic-native, mobile-tolerant, per-palm operational history, budget-gated approvals — vs
  Conservis (English/row-crop), FarmERP (generic ERP UX, no run-out forecasting), Zr3i (satellite, no
  ops/budget). Evidence: [`docs/02-prd.md`](02-prd.md) §1–§2.
- **Pricing model (non-negotiable):** **per-farm (EGP), never per-seat** ([`CLAUDE.md`](CLAUDE.md) #3).

---

## 2. Product Vision

Farm OS aims to become **the operating system for professional farms** — the single system that connects
**owners, farm managers, agricultural engineers, accountants, storekeepers, and field teams** around one
forward plan and one shared operational record. Every operation, from a single palm to the whole farm, is
planned, gated by stock and budget, approved, executed in the field (often on a phone), costed against the
plan, and rolled up into a per-asset history. Over the long term the per-palm record becomes a **digital twin**
of the farm that supports benchmarking, advisory intelligence, and an AI assistant grounded in real farm data.

---

## 3. Core Product Promise — the operating loop

The loop is **built and live on `main`**. Step-by-step:

| Step | User does | System checks | Data created | Reports enabled |
|---|---|---|---|---|
| **1. Plan** | Manager/engineer builds an operation plan (ops, target assets, labor, materials) | role `plan.write`; org scope | `plans`, `plan_operations`, `plan_material_requirements`, `plan_labor_requirements` | plan list, plan detail |
| **2. Stock Coverage** | Opens coverage for an item / runs plan checks | `fn_stock_coverage` projects on-hand − reserved vs planned demand over time; flags shortfall + suggested buy | `plan_checks`; coverage projection (computed) | coverage report (`/inventory/[itemId]/coverage`), plan-check results |
| **3. Budget Gate** | Reviews the plan's budget check | budget category vs committed/spent; role `budget.write` | budget evaluation (`/budget/[planId]/check`) | budget-vs-plan view |
| **4. Approval** | Owner/manager approves the purchase request | **Separation of Duties** (creator ≠ approver, enforced in DB); role gate | `purchase_requests` status → `approved` (guarded) | approval/audit trail |
| **5. Execute** | Field supervisor executes the operation (mobile) | `fn_execute_operation` idempotent, `op.execute` gated, claim-first | `farm_event` (status → done) + `quantities` + inventory movement | execution history |
| **6. Actual Cost** | Records expense / receipt with the operation | inventory ledger append-only; expense role-gated | `inventory_movements` (issue), `expenses` | actual cost capture |
| **7. Report** | Reviews planned-vs-actual + operational/stock reports | RLS-scoped reads | — | **planned-vs-actual** (`reports/[planId]/pva`), dashboards, list reports |

Evidence: migrations `0006`/`0009`/`0011`/`0020`/`0083`/`0084`; RPCs `fn_create_plan`, `fn_stock_coverage`,
`fn_execute_operation`, `fn_record_event`; routes under §6.

---

## 4. Target Users and Personas

Role set (verified `apps/farm-os/lib/auth.ts`): `owner`, `farm_manager`, `agri_engineer`, `accountant`,
`supervisor`, `storekeeper`. Plus two **not-yet-modeled** operator roles for the commercial layer (see §5
Commercial / SPEC-0013).

| Persona | Goals | Daily tasks | Permissions (verified) | Main pages | Pain solved |
|---|---|---|---|---|---|
| **Owner** (المالك) | Control spend; see farm health | Approve PRs, review budgets/reports | All; sole `/settings` access; approvals | dashboard/owner, budgets, purchase-requests, reports | "Where is my money going per block?" |
| **Farm manager** (مدير المزرعة) | Run operations to plan | Build plans, approve, assign work | `plan.write`, `budget.write`, structure, approvals | dashboard/manager, plans, farm, purchase-requests | Coordinating field + stock + budget |
| **Agri engineer** (مهندس زراعي) | Right operation, right time | Plan ops, record events, weather gating | `plan.write`, `op.execute`, structure | plans, farm, weather, m, people | Agronomic decisions tied to plan |
| **Accountant** (محاسب) | Accurate cost/expense | Record expenses, review budgets | expenses/budget reads + `budget.write` | expenses, budgets, reports | Cost allocation, owner-drawings separation |
| **Field supervisor** (مشرف ميداني) | Execute & log in the field | Execute ops on phone, log quantities | `op.execute` | `/m`, `/m/execute/[opId]` | Mobile, low-friction field capture |
| **Storekeeper** (أمين مخزن) | Stock accuracy | Receive goods, issue materials | `inventory.write` | inventory, purchase-requests, suppliers | Partial receipts, stock truth |
| **Worker** | Carry out tasks | (assigned via labor; no distinct app role yet) | — **Needs verification** (no `worker` in `Role`) | — | Task clarity (via supervisor) |
| **Admin/support operator** | Operate a fleet of tenants | Suspend/extend/upgrade tenants | **Not built** — SPEC-0013 S5 | (planned `/admin`) | Multi-tenant operations |
| **Commercial SaaS admin** | Billing/plans/limits | Manage subscriptions | **Not built** — SPEC-0013 | (planned) | Monetization |

> Note: the PRD names a `worker`/field role; the current `Role` type has **no `worker`** — field execution is
> done by `supervisor`/`agri_engineer`. Treat "worker" as **Needs verification / future**.

---

## 5. Product Modules

Status legend: ✅ Built (on `main`) · 🟡 Partial · ⬜ Planned · 🧪 Draft PR (not on `main`).

### Organizations / Multi-Tenant Foundation — ✅ Built
- **Purpose:** tenant isolation + membership + per-org settings.
- **Data:** `organization`, `organization_member` (`0001`), `audit_log`.
- **Features:** `org_id` on every tenant table; RLS deny-by-default `to authenticated` via `user_org_ids()`;
  **active-org** JWT claim narrowing (`0085`); org settings owner-gated (`0086`, `fn_update_org_settings`);
  member changes audited (`0019`); org switcher (`OrgSwitcher.tsx`).
- **Business rules:** deny-by-default; active-org fail-closed; audit immutable.
- **Permissions:** members read own org; settings owner-only.
- **Related:** every module. **Gap:** member **invite/role UI** not built (SPEC-0012 S2, migration `0090`).

### Farm Structure — ✅ Built
- **Purpose:** the physical tree of the farm. **Pages:** `/farm`, `/farm/sector/[id]`, `/farm/hawsha/[id]`,
  `/farm/line/[id]`, `/farm/palm/[id]`, `/farm/croquis`.
- **Data:** `farms`, `sectors`, `hawshat`, `lines`, `assets`, `palm_status_history` (`0003`/`0080`/`0081`).
- **Features:** editable CRUD via `fn_save_sector/hawsha/line/palm`, soft-delete + restore guard
  (`fn_archive_structure`), per-node 360 pages, palm status (`fn_update_palm_status` `0039`), croquis map
  (`FarmCroquis.tsx`, `lib/croquis.ts`).
- **Business rules:** re-parent into archived hawsha rejected (`0089`); unique active line numbers; 5 sectors
  (SPEC-0003 ratified). Canonical counts: 4,380 برحي / 299 ذكور / 28 حوش (CLAUDE.md #5).
- **Gap:** **bulk registry import** (the real Nov-2025 file) = Stage M; advanced GIS (coords/zones/heatmaps) ⬜.

### Planning — ✅ Built (core); ⬜ templates
- **Purpose:** forward operation plans. **Pages:** `/plans`, `/plans/[planId]`.
- **Data:** `plans`, `plan_operations`, `plan_material_requirements`, `plan_labor_requirements`, `plan_checks`
  (`0006`/`0084`).
- **Features:** create/assign/labor; `fn_create_plan`, `fn_add_plan_operation`, `fn_add_plan_labor`,
  `fn_assign_plan_operation`, `fn_set_plan_status`; plan checks runner (`PlanChecksRunner.tsx`).
- **Gap:** **season/crop-calendar templates** and **MRP** depth ⬜ (SPEC-0011 covers the built core).

### Inventory + Stock Coverage — ✅ Built (the wedge)
- **Purpose:** stock truth + forward run-out forecasting. **Pages:** `/inventory`, `/inventory/[itemId]/coverage`.
- **Data:** `suppliers`, `inventory_items` (`expiry_tracked`, `unit_cost`), `inventory_bin` (snapshot),
  `inventory_movements` (`receipt/issue/return/adjustment/transfer/loss/expiry/reserve/release`), `batch_no`,
  `expiry_date` (`0005`/`0041`).
- **Features:** `fn_stock_coverage` (`0009`, null-date guard `0047`, sizing `0055`), `fn_post_movement`
  (append-only ledger primitive, floor-locked `0033`), `fn_reserve_stock`, `fn_post_receipt`; `lib/stock-calc.ts`.
- **Business rules:** ledger append-only + INSERT-locked to RPC (`0022`/`0030`); reservations ledger-backed;
  on-hand floored at 0; receipt-vs-open-PO disjointness trigger (`0026`).
- **Gap:** explicit **multi-warehouse**; deeper valuation reports.

### Purchase Requests & Approvals — 🟡 Partial
- **Purpose:** budget-gated purchasing with SoD. **Pages:** `/purchase-requests`, `/purchase-requests/[prId]`,
  `/suppliers`, `/budget/[planId]/check`, `/budgets`.
- **Data:** `purchase_requests`, `purchase_request_items`, `budgets`, `budget_lines` (`0007`).
- **Features:** multi-line PRs; **Separation of Duties** approval guard (`0017`/`0023`, `pr_guard_approval`);
  line-freeze + version bump on decision (`0032`); **partial receipts** (`0045`/`0050`, `fn_post_receipt`,
  `ReceiveForm.tsx`); budget role-gate (`0043`).
- **Gap (future depth):** **purchase orders** as a distinct entity, **quotation comparison**, **invoice
  matching**, **multi-level approval chains** — ⬜ (candidate spec).

### Farm Events / Operations — ✅ Built
- **Purpose:** every operation as an append-only event. **Pages:** recorded via `RecordActivity.tsx`; executed
  via `/m/execute/[opId]`.
- **Data:** partitioned `farm_event` (+ partitions), `event_locations`, `event_assets`, `quantities`,
  `event_status_history`, `event_followups`, `event_attachments` (`0004`/`0083`).
- **Features:** `subtype` (irrigation/fertilization/spraying/pollination/…); `fn_record_event`,
  `fn_set_event_status`, `fn_add_event_followup`; idempotent claim-first `fn_execute_operation` (`0020`).
- **Business rules:** operation tables gated to `op.execute` (`0025`); palm-event roll-up derived from the
  hawsha chain (defensive). **Gap:** explicit **labor attendance** event / `labor_logs` ⬜ (Stage 8).

### Accounting and P&L — 🟡 Partial (expenses ✅; P&L 🧪 draft PR)
- **On `main`:** `expenses` table (`0007`), `/expenses` page, `expenses` role-gate (`0044`), `expenses.kind`
  separation (owner-drawings vs opex — CLAUDE.md #6); `lib/money.ts`.
- **NOT on `main` (draft PR #368, migration `0088`):** `sales`, `fn_save_sale`/`fn_set_expense_kind`, the **P&L
  engine `lib/pnl.ts`**, and the **`/accounting`** report. **Gates open:** 7-yr Excel reconciliation + privacy
  review (Stage M) + independent review of the money logic.
- **Cost by sector/crop/operation:** planned-vs-actual exists per plan (below); full cross-cutting cost
  allocation is in the draft P&L work.

### Reports — ✅ Built (operational + planned-vs-actual); 🟡 export
- **Pages:** `/dashboard`, `/dashboard/owner`, `/dashboard/manager`, `/reports/[planId]/pva` (**planned-vs-actual**,
  `VarianceChart`, planned qty/cost vs done-event actuals).
- **Features:** role dashboards; coverage report; list reports via `FilterableTable.tsx`; `charts.tsx`
  (Recharts code-split to the 2 chart routes — coverage + PvA).
- **Gap:** customizable/export reports (Excel/PDF), bulk edit — 🟡 **Needs verification** at scale.

### Weather / Advisory Gates — ✅ Built (needs key)
- **Page:** `/weather` (`WeatherCard.tsx`). **Libs:** `lib/weather.ts`, `lib/weather-server.ts`.
- **Features:** untrusted-safe forecast ingest + advisory operation gates (spray/irrigation windows). SPEC-0007
  ratified (PR #350). **Go-live:** Owner sets server-side `WEATHER_API_KEY`/`WEATHER_API_URL` in Vercel.
- **Gap:** deeper pest-risk / heat-stress intelligence ⬜.

### Mobile Field Mode — ✅ Built (offline-tolerant); ⬜ true offline
- **Pages:** `/m`, `/m/execute/[opId]`. **Features:** field execution, quantity logging (`ExecuteForm.tsx`).
- **Current behavior:** **offline-tolerant** — failed mutations show a retryable Arabic message — but **NOT
  offline-capable**: server components fetch at request time, no service worker / PWA cache / write queue / sync
  (verified SPEC-0012 S1 audit). **Gap:** true offline PWA = SPEC-0012 S4; high-contrast/large-target field UX.

### Attachments and Media — ✅ Built
- **Data:** `attachments` (`0082`), `event_attachments`. **Storage:** `farm-media` bucket + **org-scoped storage
  RLS** (`storage-policies.sql`). **UI:** `MediaGallery.tsx`; `fn_add_attachment`/`fn_archive_attachment`
  (soft-delete posture; no client DELETE).
- **Use cases:** expense receipts, field photos, tree-disease photos, documents. **Gap:** **OCR** ⬜ (future).

### AI Assistant / AI Policy — 🟡 Partial (boundary only)
- **On `main`:** capability boundary `lib/assistant-policy.ts` (SPEC-0005, PR #356) — **deny-by-default,
  read-only, RLS-scoped, no PII, no outbound** (the lethal-trifecta guard, CLAUDE.md Security).
- **NOT built:** the assistant itself (chat route, model, retrieval/ingest). **Gated:** each slice needs
  **independent security review** (highest-risk, Stage 11). Named **عبدالجليل** after the real farm manager.
- **Future:** AI "Why?" mode + AI Expert (SPEC-0014 Tier C) — blocked behind Stage 11.

### Knowledge / Help / Documentation System — ⬜ Planned (SPEC-0014 Tier A, Draft)
- **Today:** hand-written `docs/user-manual/` (6 pages); per-page registry `lib/nav.ts`; rule codes
  `lib/errors.ts` (~19 Arabic mappings). **No in-app help drawer yet.**
- **Scoped (SPEC-0014 Tier A):** `pageMeta` 5-question help drawer + **rule-based "Why?"** over `errors.ts` +
  a **Documentation Health Score** (now in the CLAUDE.md DoD). **Deferred:** manual-gen + walkthroughs + videos
  (Tier B), **AI Expert/AI "Why?"** (Tier C, behind Stage 11).

### Commercial SaaS Layer — ⬜ Missing (SPEC-0013, Draft) — largest gap
- **Today:** none — no `subscription`/`billing`/`plan_tier` in schema or app (verified by grep).
- **Scoped (SPEC-0013):** subscription + plan tiers, **per-farm tenant limits (not per-seat)**, server-side
  entitlement enforcement, onboarding wizard, import wizard (real data behind Stage M), demo tenant, admin/support
  console, trials, feature flags, launch checklist. **Open decisions:** billing provider (Paymob/Fawry/Kashier/
  Stripe — EGP), tiers, self-serve vs white-glove. **Prereq:** SPEC-0012 S2 invite.

---

## 6. Page-by-Page Product Manual

All routes below are **verified** from `apps/farm-os/app` (`find … page.tsx`). No invented routes. Access shown
where role-gated in `lib/nav.ts`; otherwise "all members" (any authenticated org member) or **Needs verification**
for sub-pages without an explicit nav gate.

| Route | Title (AR / EN) | Module | Access | Purpose & key actions | Status |
|---|---|---|---|---|---|
| `/login` | تسجيل الدخول / Login | Auth | public | Email+password sign-in (Supabase) | ✅ |
| `/` (root `page.tsx`) | — | Shell | — | Entry/redirect to app | ✅ |
| `/dashboard` | لوحة التحكم / Dashboard | Reports | all members | Overview KPIs | ✅ |
| `/dashboard/owner` | لوحة المالك / Owner dashboard | Reports | **owner, accountant** (`requireRole`) | Owner overview | ✅ |
| `/dashboard/manager` | لوحة المدير / Manager dashboard | Reports | **farm_manager, agri_engineer** (`requireRole`) | Manager overview | ✅ |
| `/farm` | المزرعة / Farm | Structure | all members | Structure tree; add/edit sector/hawsha/line/palm | ✅ |
| `/farm/sector/[id]` | حوض / Sector file | Structure | all members | Sector 360 + roll-up | ✅ |
| `/farm/hawsha/[id]` | حوشة / Hawsha file | Structure | all members | Hawsha 360 | ✅ |
| `/farm/line/[id]` | خط / Line file | Structure | all members | Line 360 | ✅ |
| `/farm/palm/[id]` | نخلة / Palm file | Structure | all members | Palm 360, status history, photos | ✅ |
| `/farm/croquis` | كروكي / Croquis map | Structure | all members | Visual farm map | ✅ |
| `/plans` | الخطط / Plans | Planning | all members | Plan list; create plan | ✅ |
| `/plans/[planId]` | تفاصيل الخطة / Plan detail | Planning | all members | Operations, labor, checks; assign/execute | ✅ |
| `/budget/[planId]/check` | فحص الموازنة / Budget check | Purchasing | all members (`requireMembership`) | Budget gate for a plan | ✅ |
| `/budgets` | الموازنات / Budgets | Purchasing | owner/accountant/farm_manager | Budget overview | ✅ |
| `/inventory` | المخزون / Inventory | Inventory | all members | Item list, stock | ✅ |
| `/inventory/[itemId]/coverage` | تغطية المخزون / Stock coverage | Inventory | all members | Forward run-out forecast + buy recommendation (chart) | ✅ |
| `/purchase-requests` | طلبات الشراء / Purchase requests | Purchasing | all members | PR list; create PR | ✅ |
| `/purchase-requests/[prId]` | تفاصيل الطلب / PR detail | Purchasing | all members; approve = SoD+role | Lines, approval, partial receipts | ✅ |
| `/suppliers` | الموردون / Suppliers | Purchasing/Inventory | all members; write `inventory.write` | Supplier directory | ✅ |
| `/expenses` | المصروفات / Expenses | Accounting | owner/accountant/farm_manager | Record expenses (opex vs drawings) | ✅ |
| `/people` | الفريق / Team | People | owner/farm_manager/agri_engineer/accountant | Team directory (read; PII-locked) | ✅ |
| `/weather` | الطقس / Weather | Weather | all members | Forecast + advisory gates (needs API key) | ✅ |
| `/m` | الميدان / Field | Mobile | supervisor/agri_engineer/owner/farm_manager | Field task list (offline-tolerant) | ✅ |
| `/m/execute/[opId]` | تنفيذ عملية / Execute operation | Mobile | `op.execute` | Execute op, log quantities | ✅ |
| `/reports/[planId]/pva` | مخطط مقابل فعلي / Planned-vs-actual | Reports | all members (`requireMembership`) | Variance: planned qty/cost vs actuals | ✅ |
| `/profile` | الملف الشخصي / Profile | Account | all members | Identity, role, active org (read-only) | ✅ |
| `/settings` | الإعدادات / Settings | Org | owner | Org settings | ✅ |

> **Access gates verified 2026-06-27** (read from the page code): the `(app)` layout enforces `requireMembership()`
> for the whole group; `/dashboard/owner` = `requireRole(["owner","accountant"])`; `/dashboard/manager` =
> `requireRole(["farm_manager","agri_engineer"])`; `/budget/[planId]/check`, `/reports/[planId]/pva`, and
> `/suppliers` (read) use `requireMembership()` only; supplier **writes** are DB-enforced via
> `authorize('inventory.write')` (owner/farm_manager/storekeeper). Role gates on other top-level pages come from
> `lib/nav.ts`.
> **Not present on `main`:** `/accounting`, `/academy`, `/members`, `/admin`, `/onboarding`, `/import` (draft PRs
> or planned specs).

Help-text suggestion (per SPEC-0014): each page above should gain a `pageMeta` answering what/why/when/how/
common-mistakes + related pages + the rule-based "Why?" for its error codes.

---

## 7. Design System and UX Details

- **Component library:** **`@amrebeid/ui` v1.2.0** (`packages/ui`) — ~40 components, **two-tier token theming,
  white-label, RTL-first**, token-purity gate, Storybook 10, green CI (evidence: `README.md`,
  `packages/ui/README.md`). App consumes it; charts via the `@amrebeid/ui/charts` code-split subpath.
- **Layout & nav:** role-aware primary nav from `lib/nav.ts` (`AppNavItem{id,label,icon,href,roles}`); shell in
  `components/AppChrome.tsx`; org switcher `OrgSwitcher.tsx`.
- **RTL / Arabic-first:** Arabic labels throughout (`ROLE_LABEL_AR`, `lib/labels.ts`); RTL is a CLAUDE.md #2
  non-negotiable.
- **Tables/forms/cards/charts:** `FilterableTable.tsx` (+ unit-tested `lib/filter.ts`), `SimpleTable.tsx`,
  domain forms (`StructureForm`, `PlanCreateForm`, `ReceiveForm`, `ExecuteForm`, `AddExpense`, `AddSupplier`,
  `SettingsForm`, `RecordActivity`, `PalmStatusForm`), `charts.tsx` (Recharts).
- **Error messaging:** `lib/errors.ts` maps DB rule codes → Arabic messages (the "Why?" substrate).
- **Loading/empty/accessibility:** loading skeletons present (tracker); a11y via jest-axe in the UI lib.
  Per-page empty/error-state specifics across all app routes = **Needs verification**.
- **Theme:** a `[data-theme="dark"]` token set exists but `ThemeProvider` is pinned light (SPEC-0012 S5) —
  **dark mode is not wired** (recommendation, not current).
- **Mobile UX:** `/m` is functional + offline-tolerant; sunlight/gloved-hand high-contrast mode = **recommendation
  (SPEC-0012 S4), not current**.

> Concrete design tokens live in `packages/ui` (token files + purity gate). Anything above marked
> "recommendation" is **not** current implementation.

---

## 8. Permissions and Roles

**Model:** Postgres **RLS deny-by-default**, `to authenticated`, joined via `user_org_ids()`; fine-grained
actions via `authorize(perm, org)` (`0035`). Verified permission strings: `structure.write`, `inventory.write`,
`plan.write`, `op.execute`, `budget.write`, `payroll.read`.

| Role (AR) | Org behavior | Key write perms | Approvals / SoD | Notable pages |
|---|---|---|---|---|
| owner (المالك) | full org | all | **approves PRs** (creator ≠ approver) | settings (sole), budgets, approvals |
| farm_manager (مدير المزرعة) | per-org | plan/budget/structure | approves (SoD) | plans, farm, PRs |
| agri_engineer (مهندس زراعي) | per-org | plan/op/structure | executes, not approve-own | plans, weather, /m |
| accountant (محاسب) | per-org | budget/expenses | finance reads | expenses, budgets |
| supervisor (مشرف ميداني) | per-org | op.execute | executes ops | /m |
| storekeeper (أمين مخزن) | per-org | inventory.write | receives/issues | inventory, suppliers |
| admin/support operator | — | **not built** (SPEC-0013 S5) | distinct from tenant roles | planned /admin |

- **SoD:** purchase-request approval guard rejects self-approval (`0017`/`0023`); insert-side SoD covered (`0023`).
- **PII:** `people` phone/email deny-by-default (`0048`); wage data behind `payroll.read` + `people_compensation`
  (`0046`).
- **Admin/support constraint (planned):** platform operator must be **outside** the tenant role set, audited,
  no raw table access (SPEC-0013).

---

## 9. Data Model Overview

**~37 tables, org-scoped, RLS-forced.** Major groups:

- **Tenancy/identity:** `organization`, `organization_member`, `people`, `people_compensation`,
  `responsibility_assignments`, `audit_log`.
- **Structure:** `farms` → `sectors` → `hawshat` → `lines` → `assets` (palms); `palm_status_history`.
- **Events:** `farm_event` (partitioned) + `event_locations`/`event_assets`/`quantities`/`event_status_history`/
  `event_followups`/`event_attachments`.
- **Inventory:** `suppliers`, `inventory_items`, `inventory_bin`, `inventory_movements`.
- **Planning:** `plans`, `plan_operations`, `plan_material_requirements`, `plan_labor_requirements`, `plan_checks`.
- **Purchasing/finance:** `purchase_requests`, `purchase_request_items`, `budgets`, `budget_lines`, `expenses`.
- **Media:** `attachments` (+ `farm-media` storage bucket).
- **Relationships:** everything carries `org_id`; structure is a strict parent chain (cross-org FK guards swept in
  `0061`–`0075`); events/inventory/PRs reference org-validated parents; audit mirrors writes immutably.
- **Not on `main`:** `sales` (draft PR #368), academy content store (draft PR #366), subscription/plan tables
  (SPEC-0013), `labor_logs` (Stage 8), invite table (SPEC-0012 S2).

(Full SQL: `apps/farm-os/supabase/migrations/0001`–`0089`.)

---

## 10. RPCs / Server Logic (key functions)

| RPC | Purpose | Rule enforced | UI/page | Status |
|---|---|---|---|---|
| `user_org_ids` / `user_member_org_ids` | org membership resolution | RLS join (non-recursive) | all | ✅ |
| `authorize(perm,org)` | fine-grained action gate | least-privilege | all writes | ✅ |
| `custom_access_token_hook` / `fn_set_active_org` | active-org JWT claim | fail-closed narrowing | org switcher | ✅ |
| `fn_update_org_settings` | org settings | owner-gated | /settings | ✅ |
| `fn_stock_coverage` | forward run-out forecast | on-hand−reserved vs demand; null-date→period 1 | coverage | ✅ |
| `fn_post_movement` | ledger primitive | append-only, floor≥0, RPC-only | inventory | ✅ |
| `fn_reserve_stock` / `fn_post_receipt` | reserve / receive (partial) | claim-first idempotent; `inventory.write` | PRs, receive | ✅ |
| `fn_create_plan` / `fn_add_plan_operation` / `fn_add_plan_labor` / `fn_assign_plan_operation` / `fn_set_plan_status` | plan build | `plan.write` | plans | ✅ |
| `fn_execute_operation` | execute op | idempotent claim-first; `op.execute` | /m/execute | ✅ |
| `fn_record_event` / `fn_set_event_status` / `fn_add_event_followup` | event ledger | org+role gated; hawsha-chain roll-up | RecordActivity | ✅ |
| `fn_save_sector/hawsha/line/palm` / `fn_archive_structure` / `fn_update_palm_status` | structure CRUD | `structure.write`; archived-parent guards | /farm | ✅ |
| `fn_add_attachment` / `fn_archive_attachment` | media | soft-delete; org-scoped | MediaGallery | ✅ |
| `pr_guard_approval` / `fn_pr_bump_version` / `fn_pr_items_lock_when_decided` | PR integrity | SoD; line-freeze on decision | PR detail | ✅ |
| `fn_audit` / `fn_audit_org_member` / `fn_audit_people` | audit | immutable mirror; PII redaction | — | ✅ |
| `fn_save_sale` / `fn_set_expense_kind` | sales + opex/drawings | budget.write | /accounting | 🧪 draft PR #368 |
| payroll-run RPC | payroll | — | — | ⬜ (engine `lib/payroll.ts` only) |
| assistant chat/retrieval | AI | trifecta-safe | — | ⬜ Stage 11 |

---

## 11. Security and Compliance Model

- **RLS deny-by-default**, `to authenticated`, **FORCE RLS** on all 35 tenant tables (`0028`); `org_id` indexed.
- **Org isolation:** cross-org FK guards swept (`0061`–`0075`); SECURITY DEFINER fns pin `search_path=''`.
- **Auth:** Supabase email+password only (phone-OTP/Twilio **dropped** from MVP-0).
- **Least privilege:** `authorize()` per action; ledger INSERT-locked to RPC; `DELETE` revoked on tenant tables
  (`0027`); ledger no-UPDATE (`0022`).
- **Sensitive data:** wage confidentiality (`0046`), contact-PII deny-by-default (`0048`).
- **Storage:** org-scoped `farm-media` RLS.
- **AI boundary:** read-only, RLS-scoped, no PII, **no outbound** — lethal-trifecta never combined
  (`assistant-policy.ts`; CLAUDE.md).
- **External-send restriction:** any WhatsApp/email-at-scale is a **Hard Stop** (CLAUDE.md).
- **Audit:** immutable `audit_log`; org-member + people changes audited.
- **Security status:** Supabase `service_role` key + DB password rotation is complete per Owner correction
  (2026-06-29; do not raise again unless reopened). Remaining admin hardening: enable Leaked-Password Protection.
  **Open compliance:** Stage 0 legacy-secret remediation; Stage M privacy review.

---

## 12. Product Workflows (end-to-end)

| Workflow | Trigger | Actor | Steps (system checks) | Outputs | Failure cases |
|---|---|---|---|---|---|
| **Create organization** | new tenant | (today) seed/DB; **wizard ⬜ SPEC-0013** | org + first membership | org row | duplicate/none (manual today) |
| **Add farm/structure** | setup | manager/engineer | `/farm` → save sector/hawsha/line/palm (`structure.write`; archived-parent guard) | structure tree | archived-parent reject `22023` |
| **Create plan** | season/month | manager/engineer | `/plans` create → add ops/labor/materials (`plan.write`) | plan + operations | role denied `42501` |
| **Check stock coverage** | plan review | manager/engineer | coverage / plan checks (`fn_stock_coverage`) | shortfall + buy recommendation | NaN guarded; null-date→period 1 |
| **Create purchase request** | shortfall | storekeeper/manager | `/purchase-requests` create lines | PR (draft) | budget gate, role gate |
| **Approve request** | PR submitted | owner/manager | approve (**SoD**: creator ≠ approver) | PR approved | self-approval reject |
| **Receive inventory** | goods arrive | storekeeper | `ReceiveForm` partial/full (`fn_post_receipt`) | receipt movement, partial status | over-receipt `23514`→Arabic |
| **Execute operation** | scheduled op | supervisor/engineer | `/m/execute/[opId]` (`fn_execute_operation`, idempotent) | `farm_event` done + movement | double-submit guarded |
| **Upload receipt/photo** | any | any member | `MediaGallery`/`fn_add_attachment` | attachment + storage object | org-scoped RLS |
| **View actual cost** | post-exec | accountant/owner | `/expenses`; planned-vs-actual `/reports/[planId]/pva` | variance (qty/cost) | — |
| **Generate report** | review | owner/manager | dashboards, coverage, PvA | charts/tables | export = 🟡 |
| **Mobile field execution** | field work | supervisor | `/m` (offline-tolerant) | events/quantities | no-signal: page can't load (⬜ true offline) |
| **Error / "Why?" explanation** | blocked action | any | (today) Arabic error via `errors.ts`; **rule-based "Why?" ⬜ SPEC-0014** | explanation | generic fallback |
| **Onboarding / import** | new tenant | operator | **⬜ SPEC-0013** (preview→map→validate→atomic; real data behind Stage M) | imported org | partial-import rollback (planned) |

---

## 13. What Is Already Built (from RECONCILE-001, corrected)

| Capability | Status | Confidence | Evidence | Notes |
|---|---|---|---|---|
| Multi-tenant + org isolation (RLS) | ✅ | High | `0001`/`0085`/`0086`; `user_org_ids()` | — |
| RBAC (6 roles + `authorize`) | ✅ | High | `lib/auth.ts`; `0035`; role-gates | — |
| Farm structure + 360 + croquis | ✅ | High | `0003`/`0080`/`0081`; `/farm/*` | — |
| Event ledger (ops as events) | ✅ | High | `0004`/`0083`; `fn_record_event` | — |
| Inventory + stock-coverage engine | ✅ | High | `0005`/`0009`; `fn_stock_coverage` | the wedge |
| Reservations | ✅ | High | `fn_reserve_stock`; `inventory_bin` | ledger-backed |
| Planning workspace | ✅ | High | `0006`/`0084` | templates ⬜ |
| Budget gate + PR + SoD + partial receipts | ✅ | High | `0007`/`0017`/`0045` | depth 🟡 |
| Operation execution (idempotent) | ✅ | High | `0020`; `/m/execute` | — |
| Expenses capture (opex vs drawings) | ✅ | High | `0007`/`0044`; `/expenses` | P&L 🧪 draft |
| **Planned-vs-actual report** | ✅ | High | `reports/[planId]/pva` (`VarianceChart`) | **corrected from earlier "missing"** |
| Attachments / media + storage RLS | ✅ | High | `0082`; `farm-media` | OCR ⬜ |
| Weather + advisory gates | ✅ | High | `lib/weather*`; `/weather` | needs API key |
| Mobile field view (offline-tolerant) | ✅ | High | `/m` | true offline ⬜ |
| Profile (read-only) | ✅ | High | `/profile` | — |
| AI capability boundary | ✅ | Med | `lib/assistant-policy.ts` | AI itself ⬜ |
| Design system `@amrebeid/ui` v1.2.0 | ✅ | High | `packages/ui` | published |

---

## 14. What Is Partial

| Capability | What exists | What's missing | Risk | Next action |
|---|---|---|---|---|
| Purchase workflow depth | PR + items + SoD + partial receipts | POs, quotation compare, invoice match, multi-level approvals | High | candidate spec |
| Accounting / P&L | `expenses` + opex/drawings on `main` | `sales`, P&L engine, `/accounting` (draft PR #368, not merged) | High | merge after Excel recon + privacy + review |
| Planned-vs-actual | per-plan variance report | cross-cutting cost allocation by sector/crop/period | Med | extend with P&L work |
| AI assistant | policy boundary | chat route/model/retrieval | High | Stage 11, per-slice review |
| Member invites / role UI | roles+RLS | `/members` UI + invite mechanism | High | SPEC-0012 S2 (`0090`) |
| Reports export / bulk edit | dashboards, PvA, filterable tables | Excel/PDF export, bulk ops | Med | audit then scope (**Needs verification**) |
| Mobile / offline | offline-tolerant `/m` | SW/PWA cache, write queue, sync, sunlight UX | High | SPEC-0012 S4 |
| Payroll | engine `lib/payroll.ts` | `labor_logs`, payroll-run RPC, pages | High | Stage 8, review-gated |
| Care Academy | editor (draft PR #366, not on `main`) | merge + agronomist sign-off | Med/High | external sign-off |

---

## 15. What Is Missing

| Missing capability | Why it matters | Dependency | Spec/Stage | Priority |
|---|---|---|---|---|
| Commercial SaaS layer | can't sell to a 2nd tenant | SPEC-0012 S2 | **SPEC-0013** / Stage C | **P0** |
| Billing (provider + webhooks) | monetization | provider decision (EGP) | SPEC-0013 S6 | P0 |
| Onboarding wizard | self/assisted setup | S2 invite | SPEC-0013 S2 | P0 |
| Import wizard | real-data load | Stage M privacy | SPEC-0013 S3 | P1 |
| Admin/support console | operate a fleet | operator role | SPEC-0013 S5 | P1 |
| True offline PWA | field is make-or-break | — | SPEC-0012 S4 | P1 |
| Advanced procurement (PO/quote/invoice) | enterprise purchasing | — | new spec | P2 |
| Planned-vs-actual analytics (cross-cut) | profit by sector/crop | P&L merge | extend Stage 7 | P2 |
| AI Expert / AI "Why?" | the differentiator | Stage 11 reviewed AI | SPEC-0014 Tier C | P2 |
| Advanced GIS (coords/zones/heatmaps) | precision ops | map data | new spec | P3 |
| OCR on receipts | data entry speed | attachments | future | P3 |
| Benchmarking | cross-farm insight | multi-tenant data | long-term | P3 |

---

## 16. Competitive Positioning

Farm OS is **not a generic Farm ERP**. Its defensible wedge is **Arabic-first professional farm operations**:
stock-coverage forecasting + budget gates + SoD approvals + per-palm operational history, on mobile, in Arabic.
Comparable tools are English/row-crop (Conservis), generic ERP without run-out forecasting (FarmERP), or
satellite-only without ops/budget (Zr3i) — none answer *"given my plan, will I run out of stock or budget, and
what do I buy, when?"* at tree level in Arabic with an approval gate (`docs/02-prd.md` §2). *(Full market scan
lives in the market-research docs; this file stays product-focused.)*

---

## 17. Future Roadmap

- **Near term:** commercial readiness (SPEC-0013: billing/onboarding/import/admin), member invites (SPEC-0012 S2),
  help/manual (SPEC-0014 Tier A), offline hardening (SPEC-0012 S4), merge the accounting P&L draft (#368) behind
  its gates. Supabase DB password + service-role key rotation is complete per Owner 2026-06-29.
- **Mid term:** cross-cutting planned-vs-actual analytics, procurement depth (PO/quote/invoice), the AI assistant
  (Stage 11, reviewed per slice), labor/payroll build (Stage 8), advanced/exportable reports.
- **Long term:** per-palm digital twin, benchmarking across tenants, marketplace/integrations, enterprise
  features (advanced GIS, IoT), AI Expert + AI "Why?" (SPEC-0014 Tier C).

---

## 18. Definition of Done for Product Documentation

Per the CLAUDE.md DoD amendment + SPEC-0014, every **user-facing** page/workflow should eventually carry:
page purpose · the 5-question help block (what/why/when/how/common-mistakes) · related pages · permissions ·
business rules · error explanations (rule-based "Why?") · a manual entry · version/changelog · and pass the
**Documentation Health Score** (CI lint; **blocking for user-facing**, advisory for internal/admin/infra).
AI-generated help is **gated behind Stage 11**.

---

## 19. Open Owner Decisions

- [ ] **Billing provider** — Paymob / Fawry / Kashier / Stripe (EGP support gates the choice). (SPEC-0013)
- [ ] **Plan tiers & limit dimensions** — farms/area/assets/storage/AI usage — **never per-seat**. (SPEC-0013)
- [ ] **Self-serve vs white-glove onboarding** — public signup or operator-provisioned + demo. (SPEC-0013)
- [ ] **WhatsApp approvals** — wanted? Hard Stop (external send + trifecta); SMS dropped from MVP-0.
- [ ] **AI assistant scope** — no-ingest first vs fuller; per-slice security review. (SPEC-0005/Stage 11)
- [ ] **Import privacy model** — real-data import behind Stage M privacy review. (SPEC-0013 S3)
- [ ] **Demo tenant data policy** — synthetic only; isolation + reset. (SPEC-0013 S4)
- [ ] **Ratify SPEC-0013 / SPEC-0014 Tier A / SPEC-0012 S2** (all Draft).

---

## 20. Appendix

**Source files inspected (this reconcile):** `README.md`, `docs/CLAUDE.md`, `docs/PROJECT-TRACKER.md`,
`docs/SESSION-BRIEF.md`, `docs/RECONCILE-001-main-ground-truth-2026-06-27.md`, `docs/02-prd.md`,
`docs/03-architecture-and-data-model.md`, `docs/SPEC-0001`–`SPEC-0014`, `docs/ROADMAP-path-to-finish-2026-06-25.md`;
`apps/farm-os/supabase/migrations/0001`–`0089` (89 files); `apps/farm-os/app/**/page.tsx` (all routes);
`apps/farm-os/lib/*` (auth, nav, errors, stock-calc, weather, payroll, assistant-policy, money, croquis, filter,
labels, dates, org-actions); `apps/farm-os/components/*` (24); test corpus (89 pgTAP files, 13 Vitest).

**Assumptions / Needs verification:**
- ~~Sub-page access gates~~ — **RESOLVED 2026-06-27** (read from page code; see §6 footnote): layout =
  `requireMembership`; owner/manager dashboards = `requireRole`; budget-check/PvA/suppliers-read =
  `requireMembership`; supplier writes = `authorize('inventory.write')`.
- Per-page empty/error-state coverage and report-export capability — not fully audited.
- `worker` persona — no `worker` in the `Role` type; treat as future.

**Ground-truth files (trust these):** `PRODUCT-MASTER-FILE.md` (this), `RECONCILE-001-main-ground-truth-2026-06-27.md`,
the `supabase/migrations`, `lib/auth.ts`, `lib/nav.ts`. **SPECs** are the source of truth per workstream
(Draft until ratified).

**Files that need legacy banners / refresh (Owner-gated; not changed here):**
- `docs/03-architecture-and-data-model.md` — legacy banner **added** (points to RECONCILE-001); some schema
  examples (`payment_vouchers`, etc.) describe migrate-from/prototype structures, not `main`.
- `README.md` — **stale prod migration number ("0048")**; current prod is `0084` (HELD), `main` `0089`. Recommend
  refresh.
- Older `docs/*` market/research dated docs predate the back-half build — read with their dates in mind.

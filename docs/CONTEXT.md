# Farm OS — Domain CONTEXT (ubiquitous language)

A factual glossary of the Farm OS domain, grounded in the schema and engine code.
Each term lists where it lives so the language stays anchored to the implementation.

- Schema: `apps/farm-os/supabase/migrations/` (one numbered file per slice).
- Pure-calc core: `apps/farm-os/lib/stock-calc.ts` (mirrored by `fn_stock_coverage`).
- Auth surface: `apps/farm-os/lib/auth.ts`.
- Specs: `docs/SPEC-0001-stock-coverage-engine.md`, `docs/SPEC-0002-authorization-enforcement.md`.

The pilot is single-org, single-location (`'main'`), Arabic-first (`locale='ar'`, `currency='EGP'`).

---

## Tenancy & access control

**organization** — the tenant. Carries `locale` (default `ar`), `currency` (default `EGP`),
`area_unit` (default `feddan`), `fiscal_year_start`, free-form `settings` jsonb.
_(migration `…000001_extensions_tenancy_rbac.sql`)_

**organization_member** — the tenancy spine: `(org_id, user_id)` → `role` + `scope` jsonb.
`role` is constrained to the six canonical roles below. Membership writes are locked at the
privilege layer (HIGH-1): clients are SELECT-only; only `service_role` may change membership.
_(…000001; lockdown in …000010_security_remediation.sql)_

**org_id scoping / RLS** — every tenant table is `org_id`-scoped with row-level security
**deny-by-default**, policies `TO authenticated`. The standard policy is `tenant_all`
(`FOR ALL … USING (org_id IN (select public.user_org_ids())) WITH CHECK (same)`).
RLS is the tenant boundary; grants only let policies run. _(every Phase-B migration)_

**user_org_ids()** — `SECURITY DEFINER`, `STABLE`, `search_path=''` helper returning the
caller's org ids from `organization_member`. Named `auth.user_org_ids()` in the architecture
doc but created in `public` because migrations run as `postgres` (no CREATE on `auth`).
Wrapped as `(select auth.uid())` so the planner caches it. _(…000001)_

**authorize(perm)** — the RBAC permission map: a `SECURITY DEFINER` function returning whether
the caller's role grants a named permission. The single source of truth for write gates; policies
and RPCs call `authorize('…')` rather than hard-coding roles. _(…000001)_

| permission        | roles allowed                                            |
|-------------------|----------------------------------------------------------|
| `pr.approve`      | owner                                                    |
| `plan.write`      | owner, farm_manager                                      |
| `op.execute`      | owner, farm_manager, agri_engineer, supervisor           |
| `inventory.write` | owner, farm_manager, storekeeper                          |
| `budget.write`    | owner, accountant                                        |

### Roles (`organization_member.role`, Arabic labels in `lib/auth.ts`)

- **owner** (المالك) — full control; the only role with `pr.approve`.
- **farm_manager** (مدير المزرعة) — plans, executes, writes inventory.
- **agri_engineer** (مهندس زراعي) — executes operations.
- **accountant** (محاسب) — writes budgets.
- **supervisor** (مشرف ميداني) — field supervisor; executes operations.
- **storekeeper** (أمين مخزن) — writes inventory.

**people** — personnel directory (`org_id`-scoped); may link to an `auth.users` row via `user_id`,
and to a manager via `reports_to_person_id`. `farm_event` actors reference `people`. _(…000002)_

**responsibility_assignments** — person ↔ `scope_type`
(farm | sector | hawsha | operation_type | budget_category | inventory_category | team)
↔ `responsibility_type` (accountable_manager | engineer | daily_supervisor | inventory_responsible | …).
_(…000002)_

---

## Farm structure (location hierarchy) & assets

The location rollup is **farm → sector → hawsha → line → asset (palm)**. Each level is
`org_id`-scoped with a `code`; areas use mixed units (`area_feddan`, `area_qirat`).
_(migration `…000003_structure_assets.sql`)_

- **farms** — top of the hierarchy; `area_feddan`, `main_crop`, owner/manager person links.
- **sectors** (قطاع) — child of farm; `crop`, `planting_date`, `area_feddan`.
- **hawshat** (حوش, plural _hawshat_) — child of sector; `area_qirat`, `row_count`,
  `palm_count_barhi`, `palm_count_male`.
- **lines** — rows within a hawsha; `line_no`, `palm_count`, `direction`.
- **assets** — physical units, `type` defaults to `'palm'`. Self-referential `parent_id`;
  location FKs (`sector_id`/`hawsha_id`/`line_id`); `status`
  (active | watch | sick | dead | removed | replaced), `variety`, `sex`,
  `id_tag` (e.g. `EBD-BAB-H03-L12-P008`), `archived`. Cross-org reference columns are
  same-org-checked in RLS (D3, …000012_rls_reference_columns.sql).
- **palm_status_history** — per-asset status/health audit trail.

---

## Events (the activity spine)

**farm_event** — the central event table, **range-partitioned by `occurred_at`** (monthly
partitions for the pilot window + a `farm_event_default` catch-all). RLS is enabled on the
parent **and every partition child** (a child queried directly does not inherit the parent's
policy). Indexed with BRIN on `occurred_at` + composite `(org_id, occurred_at)`.
_(migration `…000004_events_quantities.sql`)_

- **type** — operation | issue | inspection | note | material_movement | … (free text).
- **subtype** — irrigation | fertilization | spraying | pollination | … (free text).
- **status** — planned | reserved | ready | blocked | in_progress | done | abandoned | skipped.
- Actor links: `performed_by_person_id`, `assigned_to_person_id`; provenance: `plan_id`,
  `created_by`; payload: `data` jsonb (e.g. executed operations embed `actual_qty`,
  `actual_cost`, `labor_count`, `op_id`).

**Event children** (all `org_id`-scoped, RLS on):
- **event_assets** — `(event_id, asset_id)` link (which palms an event touched).
- **event_locations** — ties an event to a farm/sector/hawsha/line.
- **quantities** — measured/consumed amounts: `measure`
  (count | weight | volume | area | currency | …), `value_num`/`value_den`, `material_id`
  (FK → `inventory_items`), and `inventory_adjustment` (negative = consumption).
- **event_status_history**, **event_followups**, **event_attachments** — status trail,
  follow-up tasks, file attachments.

---

## Inventory & the stock ledger

_(migration `…000005_inventory.sql`)_

**inventory_items** — material master: `unit`, `pack_size`, stock policy fields
(`min_stock`, `max_stock`, `safety_stock`, `reorder_point`, `reorder_qty`, `lead_time_days`),
`preferred_supplier_id`, `criticality`, `expiry_tracked`.

**suppliers** — vendors with `lead_time_days`, `terms`.

**inventory_bin** — an ERPNext-style **materialized snapshot** per `(item_id, location)`, so
reads never re-sum the ledger:
- `on_hand` — physical stock = Σ(signed stock movements).
- `reserved` — committed-but-not-issued = Σ(reserve) − Σ(release), clamped at 0 (D2).
- `ordered` — inbound on order.
- `projected` — forward balance = `on_hand − reserved + ordered`.

**inventory_movements** — the **append-only ledger** (source of truth). `type` ∈
receipt | issue | return | adjustment | transfer | loss | expiry | reserve | release; `qty`
is always a **positive magnitude** — the `type` carries the sign. Append-only is enforced at
the privilege layer: clients cannot DELETE (…000016) or UPDATE (…000022) movements; corrections
are compensating movements, never edits. Direct REST writes are role-gated to
`inventory.write` (B2, …000015_inventory_write_rolegate.sql).

### Inventory ledger reconciliation (the invariant the engine trusts)

**fn_bin_rebuild(item, location)** — recomputes `on_hand` and `reserved` **from the ledger**
and writes them back to `inventory_bin`. The reconciliation oracle: the snapshot never drifts.
Signed sets: `+receipt/return/adjustment`, `−issue/loss/expiry/transfer` for `on_hand`;
`+reserve/−release` for `reserved`. _(…000009, …000013_fn_bin_rebuild_reserved.sql)_

**fn_post_movement(...)** — the transactional mutation primitive. Appends one movement, then
recomputes `on_hand`/`reserved` via `fn_bin_rebuild` — no read-modify-write, so it is
lost-update-safe and always reconciled. Org-guarded, `SECURITY DEFINER`, granted only to
`authenticated`; all app stock writes go through it. _(…000011_fn_post_movement.sql)_

---

## The stock-coverage engine (SPEC-0001 — the product wedge)

**fn_stock_coverage(item, location, horizon_weeks=8)** — forecasts run-out of an item against
the forward operations plan. `SECURITY DEFINER`, org-guarded (anon is never trusted), returns a
jsonb row with an Arabic-first `message_ar`. Mirrors `lib/stock-calc.ts` exactly (bound by a
parity test so SQL and TS cannot drift). _(…000009_fn_stock_coverage.sql; current definition in
…000018_engine_scheduled_receipts_from_pos.sql)_

Concepts:
- **available** — opening balance = `on_hand − reserved`. (`on_hand` already nets expiry, so
  expiry is **not** subtracted again — ENGINE-C1 fix.)
- **safety stock (SS)** — buffer from `inventory_items.safety_stock`. Statistical form
  `SS = Z·σ·√L` (Z: 1.28/1.65/2.33), with a fixed-days fallback when variance data is sparse.
- **lead time (L)** — `inventory_items.lead_time_days` (supplier replenishment delay).
- **reorder point (ROP)** — `d̄·L + SS`, where `d̄` is the daily demand rate.
- **daily demand (d̄)** — period-1 weekly requirement ÷ 7 (the plan states a weekly need).
- **planned demand (issues)** — `plan_material_requirements` joined to `plan_operations`
  (status planned/reserved/ready) on active/draft/approved plans, bucketed into **weekly
  periods** relative to the earliest demanding op (`period_start`). Demand beyond the horizon
  is dropped, not clamped (ENGINE-H2).
- **scheduled receipts** — genuinely-future supply **= open POs**: `purchase_request_items` on
  **approved-but-not-yet-received** `purchase_requests`, bucketed by `needed_by`. Sourced from
  open POs (not the movement ledger) so received stock — already in `on_hand` — is never
  double-counted (ENGINE-DC; ADR-0004, …000018). On receipt the PR flips to `received` (leaves
  the projection) as a receipt movement enters `on_hand` — counted exactly once.
- **PAB (Projected Available Balance)** — time-phased recurrence
  `PAB(t) = PAB(t−1) − issues(t) + receipts(t)`; `PAB[0]` is opening `available`.
- **first_shortage_period** — first period where `PAB < 0`.
- **first_warning_period** — first period where `PAB < safety_stock` (the earlier warning, ENGINE-SS).
- **shortfall** — the magnitude of the first negative PAB (`−PAB` at first shortage).
- **coverage_days** — `available ÷ d̄` (∞ when demand ≤ 0).
- **stockout_date** — projected run-out, anchored to `greatest(today, period_start)` so it is
  always forward-looking (ENGINE-M1).
- **recommend_qty** — `max(0, shortfall + SS − period-1 receipts)`, rounded **up** to
  `pack_size`; emitted only when the projection actually breaches safety stock within the
  horizon (ENGINE-H1). `order_by` is set to today when a purchase is needed and coverage < lead.

**Reservation lifecycle:** reserving stock for an approved plan reduces `available`
(via `reserve` movements) but not `on_hand`; executing an operation flips reserved → issued
(`issue` + `release` movements). See `fn_execute_operation` below.

---

## Planning

_(migration `…000006_plans.sql`)_

- **plans** — `type` (weekly | monthly | quarterly | annual), `period_start`/`period_end`,
  `scope_type` (farm | sector | hawsha) + `scope_id`, `status` (draft → active/approved → …).
- **plan_operations** — the planned operations within a plan: `subtype`, `target_type`/`target_id`,
  `planned_at`, `priority`, `responsible_person_id`, `est_cost`, `approval_needed`, `status`.
- **plan_material_requirements** — material needs per operation: `item_id` (→ inventory_items),
  `qty`, `unit`. This is the **demand source** the coverage engine reads.
- **plan_labor_requirements** — labor needs per operation: `person_or_team`, `count`, `days`.
- **plan_checks** — pre-flight gate results per plan: `kind`
  (weather | stock | budget | labor | responsibility), `result` (ok | warn | block), `detail`.

**fn_execute_operation(op_id, actual_qty, labor_count, note)** — the authoritative `op.execute`
gate (SPEC-0002, AUTHZ-1) as one atomic RPC. Enforces `authorize('op.execute')` server-side,
then in a single transaction: claim-first flip of the op to `done` (idempotent — a second call
affects 0 rows and aborts), inserts the `done` farm_event + event_locations + quantities, and
posts the `issue` (consume) + `release` (clear reservation) movements via `fn_post_movement`.
Any failure rolls the whole execution back. _(…000020_fn_execute_operation.sql)_

---

## Procurement, budgets & accounting

_(migration `…000007_budget_purchase_expenses.sql`)_

- **budgets** / **budget_lines** — planned vs. approved vs. committed vs. actual amounts, by
  `category` and scope. `budget.write` is owner/accountant.
- **purchase_requests (PR)** — procurement lifecycle:
  **draft → submitted → approved → received** (or **rejected**). Fields: `code`, `requested_by`
  (author), `needed_by`, `approved_by`/`approved_at`, `plan_id`/`event_id`, `version`. Approved,
  not-yet-received PRs are the engine's **scheduled receipts**.
- **purchase_request_items** — line items: `item_id`, `qty`, `unit`, `supplier_id`, `est_cost`.
- **expenses** — recorded spend (date, scope, supplier, qty/unit_price/total, payment_method).

### Separation of duties (the financial control, AP-1/AP-2/AP-5)

`purchase_requests` deliberately has **no blanket `FOR ALL` policy** (a permissive one would
OR-in and bypass the guard). Instead it has explicit `pr_select`/`pr_insert`/`pr_delete` policies
plus one `pr_update` policy: flipping a row to `status='approved'` requires
`authorize('pr.approve')` (owner only, AP-1) **and** `requested_by <> auth.uid()` (author ≠
approver, AP-2). _(…000007)_

A `pr_guard_approval` BEFORE INSERT/UPDATE trigger closes the residual bypasses (AP-5):
`requested_by` is immutable (so AP-2 always checks the original author), the approver identity is
stamped from the session (not client-supplied), and a PR cannot be **born approved** via INSERT.
_(…000017_pr_approval_sod_guard.sql, …000023_pr_approval_sod_guard_insert.sql)_

---

## Audit

**audit_log** — immutable, append-only record of writes: `actor_user_id`, `action`
(INSERT | UPDATE | DELETE), `entity_type`, `entity_id`, `before`/`after` jsonb, `occurred_at`.
_(migration `…000002_people_responsibility_audit.sql`)_

Written only by the `fn_audit` AFTER-trigger (`SECURITY DEFINER`) on the audited tables
(purchase_requests, budgets, budget_lines, farm_event, expenses, inventory_movements;
organization_member added in …000019). Immutability is enforced two ways (AP-4): no
INSERT/UPDATE/DELETE policy, **and** INSERT/UPDATE/DELETE/TRUNCATE are revoked from client roles
so the trigger is the only writer — clients can only SELECT. _(…000008_audit_triggers.sql,
re-asserted in …000009)_

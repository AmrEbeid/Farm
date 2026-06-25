# 03 — Architecture & Data Model

Stack: **Next.js (App Router) + TypeScript + Tailwind** · **Supabase** (Postgres + PostGIS + Auth + Storage + Realtime + RLS) · **Vercel**. Arabic RTL-first, mobile/offline-tolerant PWA.

`[V]` verified from cited source · `[I]` recommended.

---

## 1. Architecture overview

```
                         ┌─────────────────────────────────────────────┐
   Mobile PWA (field)    │  Next.js app (RSC reads / Server Actions     │
   - offline queue       │  writes) + Tailwind RTL + Recharts           │
   - camera / GPS  ──────┤                                              │
                         │  /api: AI route, WhatsApp webhook, reports   │
   Desktop (office)      └───────────────┬─────────────────────────────┘
                                         │
                         ┌───────────────▼─────────────────────────────┐
                         │  Supabase                                    │
                         │  Postgres + PostGIS  ── RLS (org isolation)  │
                         │  Auth (email+pwd)   Storage (attachments)    │
                         │  Realtime (alerts)  Edge Fns (cron, sims)    │
                         │  Postgres functions: stock-coverage sim,     │
                         │  budget check, reorder calc, reservations    │
                         └──────────────────────────────────────────────┘
   Integrations (later): weather API · WhatsApp Business · Phytech sensors · Palmear RPW
```

**Principles:** heavy logic in **Postgres functions/RPC** (the stock-coverage simulation and budget checks run in-DB, close to the data); reads via React Server Components; writes via Server Actions/Route Handlers; **AI and any secret-bearing call server-side only**.

---

## 2. Multi-tenancy & security

**Model:** single shared schema, **`org_id` on every tenant-owned table**, isolated by **Row-Level Security** — Supabase's recommended SaaS pattern `[V]`.

```
organization(id, name, locale='ar', currency='EGP', area_unit='feddan', fiscal_year_start, settings jsonb)
organization_member(org_id, user_id, role, scope jsonb, PRIMARY KEY(org_id, user_id))
```

**Consultants (user in many orgs, different roles):** use **membership-table RLS** (not a single `org_id` in the JWT — that breaks multi-org users and delays revocation) `[V]`. Resolve access by joining `organization_member` inside policies, via a `security definer` helper so it's indexable and non-recursive:

```sql
create or replace function auth.user_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.organization_member where user_id = (select auth.uid())
$$;

alter table farm_event enable row level security;
create policy tenant_all on farm_event for all to authenticated
using ( org_id in (select auth.user_org_ids()) )
with check ( org_id in (select auth.user_org_ids()) );
```

**RBAC:** `role` + `role_permission(role, permission)` + an `authorize(permission)` security-definer fn so policies call `authorize('voucher.approve')` rather than hard-coding roles `[V]`:

```sql
create policy voucher_approve on payment_voucher for update to authenticated
using ( org_id in (select auth.user_org_ids()) and authorize('voucher.approve') );
```

**RLS performance rules `[V]` (don't skip — RLS is per-row):** wrap `auth.uid()`/`auth.jwt()` in `(select …)` (~95% faster, cached per query); **index `org_id`** (and `user_id` on membership) (~99% faster); always add `TO authenticated`; re-state the tenant filter in app queries; use `security definer` helpers for membership lookups.

**Roles (default):** `owner`, `admin`, `farm_manager`, `agri_engineer`, `accountant`, `storekeeper`, `supervisor`, `worker`, `consultant`, `viewer`. **Scope** (which sectors/categories) lives in `organization_member.scope` and is enforced in policies (e.g., a supervisor writes operations only for assigned sectors).

**Audit log:** append-only `audit_log(id, org_id, actor_user_id, action, entity_type, entity_id, before jsonb, after jsonb, occurred_at)` written by `AFTER INSERT/UPDATE/DELETE` triggers; org members can `SELECT` their org's rows; **no UPDATE/DELETE policy at all → immutable by omission** `[I]`.

**Attachments:** Supabase Storage, path convention `{org_id}/{entity}/{uuid}`; RLS on `storage.objects` checks `(storage.foldername(name))[1] in (select auth.user_org_ids()::text)` `[V]`. Metadata + `org_id` in an `attachment` table.

---

## 3. The data spine — Asset + Event + Quantity

Adopted from farmOS's proven triad `[V]`, with LiteFarm's typed-finance and ERPNext's Bin-style stock snapshots `[I]`. **The key property: one append-only event table whose `status` (`planned` → `reserved` → `done`/`abandoned`) makes *plan*, *reservation*, and *actual* the same row at different stages — which is exactly what the stock-coverage simulation iterates over.**

### 3.1 Structure & assets
```sql
-- Location hierarchy (labels are per-org configurable: قطاع/حوض/حوشة/بلوك…)
farms(id, org_id, name, code, location, geom geography, area_feddan, owner_person_id, manager_person_id,
      soil_type, water_source, irrigation_method, main_crop, notes)
sectors(id, org_id, farm_id, name, code, area_feddan, crop, planting_date, soil_type, irrigation_method, geom)
hawshat(id, org_id, sector_id, name, code, area_qirat, row_count, palm_count_barhi, palm_count_male,
        planting_date, spacing, soil_type, geom)            -- "حوشة/حوض/بلوك"
lines(id, org_id, hawsha_id, line_no, line_code, palm_count, direction, notes)

-- Assets = the things (thin nouns; history lives in events)
assets(id, org_id, type, name, parent_id,                   -- type: palm|equipment|material|product|offshoot|trap|structure
       sector_id, hawsha_id, line_id,
       variety, sex, status, health_status,                 -- status: active|watch|sick|dead|removed|replaced
       planting_date, source_asset_id, id_tag, geom, archived bool, data jsonb)
palm_status_history(id, org_id, asset_id, status, health_status, changed_by, changed_at, reason)
```
Palm code standard: `[FarmCode]-[SectorCode]-[HawshaCode]-L[LineNo]-P[PalmNo]` → `EBD-BAB-H03-L12-P008`; Arabic display "حوض البابور / حوشة 3 / خط 12 / نخلة 8"; short label "خ12-ن8".

### 3.2 Events (the heart) + quantities
```sql
farm_event(
  id, org_id, type,            -- operation|issue|inspection|note|weather_alert|material_movement|
                               -- labor_log|expense|sale|approval|followup|recommendation|photo|harvest|treatment
  subtype,                     -- irrigation|fertilization|spraying|pollination|pruning|thinning|bagging|
                               -- offshoot_removal|harvest|rpw_trap_check|… (operation library)
  status,                      -- planned|reserved|ready|blocked|in_progress|done|abandoned|skipped
  occurred_at timestamptz, planned_at timestamptz,
  season_id, enterprise_id,    -- enterprise = crop line (dates/citrus/beet/grapes…) — Ebeid is mixed-crop
  performed_by_person_id, assigned_to_person_id, created_by, plan_id,
  notes, geom, data jsonb
) PARTITION BY RANGE (occurred_at);                         -- see §6 scaling

event_assets(event_id, asset_id, org_id)                    -- M:N: which assets the event touched (events ref assets; assets never ref events)
event_locations(event_id, org_id, farm_id, sector_id, hawsha_id, line_id)
quantities(id, org_id, event_id, measure, value_num numeric, value_den numeric, unit_term_id, label,
           material_id, inventory_adjustment numeric)        -- measure: count|weight|volume|area|currency|temperature|…
event_attachments(id, org_id, event_id, storage_path, kind, checksum)
event_followups(id, org_id, event_id, due_at, assigned_to_person_id, status, note)
event_status_history(id, org_id, event_id, status, changed_by, changed_at)
```
**Why this matters:** "everything that ever happened to palm #2481" = one query on `event_assets`. A *planned* fertilization is a `status=planned` event with a material quantity carrying a negative `inventory_adjustment`; flipping it to `done` posts the issue to the ledger and clears the reservation. Plan-vs-actual, reservations, audit, and the AI's data substrate all fall out of this one model.

### 3.3 People & responsibility (many-to-many)
```sql
people(id, org_id, name, phone, email, position, employment_type, rate, user_id, active, reports_to_person_id)
positions(id, org_id, name)                                 -- org-customizable
teams(id, org_id, name) ; team_members(team_id, person_id, org_id)
responsibility_assignments(id, org_id, person_id, scope_type, scope_id, responsibility_type)
  -- scope_type: farm|sector|hawsha|operation_type|budget_category|inventory_category|team
  -- responsibility_type: accountable_manager|engineer|daily_supervisor|inventory_responsible|
  --                      budget_reviewer|expense_approver|operation_executor|quality_inspector|consultant|backup
```
Enables **one part → many responsible people** and **one person → many parts**, and **auto-routing**: a disease issue → area supervisor + engineer + manager; stock shortage → storekeeper + accountant + manager; budget overrun → accountant + manager + owner.

### 3.4 Inventory, budget, finance
```sql
-- Inventory (ERPNext Bin-style materialized snapshot avoids re-summing the ledger)
inventory_items(id, org_id, name, category, unit, pack_size, min_stock, max_stock, safety_stock,
                reorder_point, reorder_qty, lead_time_days, preferred_supplier_id, criticality, expiry_tracked bool)
inventory_bin(item_id, org_id, location, on_hand, reserved, ordered, projected)   -- materialized per item×location
inventory_movements(id, org_id, item_id, type, qty, unit, unit_cost, occurred_at, event_id, plan_id,
                    supplier_id, expiry_date, batch_no)       -- type: receipt|issue|return|adjustment|transfer|loss|expiry|reserve|release
suppliers(id, org_id, name, phone, terms, lead_time_days)
purchase_requests(id, org_id, code, requested_by, needed_by, reason, plan_id, event_id, status, budget_category_id)
purchase_request_items(pr_id, org_id, item_id, qty, unit, supplier_id, est_cost)

-- Budget
budgets(id, org_id, name, period, scope_type, scope_id, category, planned, approved, committed, actual, status)
budget_lines(id, org_id, budget_id, category, planned, approved, committed, actual)
budget_variances(id, org_id, budget_id, variance, variance_pct, computed_at)

-- Finance (cash-basis voucher ledger; allocatable to farm/sector/hawsha/crop/operation/season)
expenses(id, org_id, date, farm_id, sector_id, hawsha_id, event_id, plan_id, enterprise_id, season_id,
         category, description, supplier_id, qty, unit, unit_price, total, payment_method, recorded_by, approved_by, status)
sales(id, org_id, date, farm_id, sector_id, enterprise_id, season_id, product, qty, unit, price, gross,
      commission, labor_cost, packaging, transport, net, buyer_id, payment_status)
payment_vouchers(id, org_id, number, payee_type, payee_id, amount, method, expense_id, pr_id,
                 status, requested_by, approved_by, approved_at, paid_at)        -- status: draft|submitted|approved|rejected|paid
voucher_audit(id, org_id, voucher_id, action, actor, at, ip)                     -- immutable
buyers(id, org_id, name, type, phone, terms)
ledger_entries(id, org_id, event_id, direction, account_code, amount, season_id, enterprise_id, sector_id, cost_center)
```

### 3.5 Planning, weather, academy, issues
```sql
plans(id, org_id, type, period_start, period_end, scope_type, scope_id, status)  -- type: weekly|monthly|quarterly|annual
plan_operations(id, org_id, plan_id, subtype, target_type, target_id, planned_at, priority,
                responsible_person_id, est_cost, approval_needed bool, status)
plan_material_requirements(id, org_id, plan_op_id, item_id, qty, unit)
plan_labor_requirements(id, org_id, plan_op_id, person_or_team, count, days)
plan_checks(id, org_id, plan_id, kind, result, detail jsonb)                      -- kind: weather|stock|budget|labor|responsibility
plan_approvals(id, org_id, plan_id, step, approver_person_id, status, at)
plan_variances(id, org_id, plan_op_id, metric, planned, actual, variance, reason)

farm_locations(id, org_id, farm_id, lat, lon)
weather_forecasts(id, org_id, farm_location_id, date, temp_max, temp_min, humidity, wind_kmh, rain_prob, source)
weather_rules(id, org_id, operation_subtype, condition, threshold, action)        -- action: block|warn
weather_alerts(id, org_id, farm_id, type, severity, window_start, window_end, message)

crop_care_stages(id, org_id|null, crop, age_band, water, fertilization, micros, key_ops, disease_risks, mistakes, checklist jsonb)
disease_profiles(id, org_id|null, name_ar, name_en, crop, risk_level, symptoms, inspection, immediate_action,
                 prevention, treatment, escalate_when, followup_interval, data_to_log jsonb)
learning_materials(id, org_id|null, topic, crop, age_band, body, media)

issues(id, org_id, type, severity, status, location refs, asset_id, reported_by, assigned_to, description)
issue_actions(id, org_id, issue_id, action, by, at) ; issue_followups(...)
inspections(id, org_id, checklist_id, location refs, by, at, result jsonb)
inspection_checklists(id, org_id|null, name, items jsonb)

notifications(id, org_id, type, priority, recipient_person_id, payload jsonb, read_at)
```
Academy/disease/weather-rule rows with `org_id IS NULL` are **global seed content** (shipped defaults); orgs can override/extend with their own rows.

---

## 4. Stock-Coverage Intelligence engine (the wedge)

A lightweight MRP built on three classic primitives — **reorder point**, **available-to-promise**, **time-phased projected balance** — run per item×location as a Postgres function over the event/movement stream. References: APICS/ASCM MPS-MRP, Oracle MRP docs, standard safety-stock literature `[V]`.

### 4.1 Reorder point & safety stock `[V]`
```
ROP = (average demand per period × lead time) + safety stock
```
| Safety-stock method | Formula | Use |
|---|---|---|
| Fixed (rule-of-thumb) | `SS = k_days × d̄` (e.g. 7 days cover) | MVP default, no variance data |
| Service-level, demand-variable | `SS = Z · σ_d · √L` | demand varies, lead time stable |
| Service-level, both variable (King's) | `SS = Z · √(L·σ_d² + d̄²·σ_L²)` | most rigorous |

`Z` = service-level factor: **1.28→90%, 1.65→95%, 2.33→99%** `[V]`. Pick service level by item criticality (a fertilizer that stalls planting → 97–99%).

### 4.2 Available / Available-to-Promise
```
Available (on-hand) = on_hand − reserved − expired           [V][I — expiry is our agrochemical twist]
ATP(period 1)  = on_hand + scheduled_receipt(p1) − Σ commitments before next receipt   [V]
ATP(period n)  = scheduled_receipt(pn) − Σ commitments(pn … before next receipt)
```
"commitments" = approved consumption plans (reserved events).

### 4.3 Coverage & projected stock-out
```
Coverage (periods)        = available ÷ planned consumption rate
Projected stock-out date  = today + Coverage
Flag when Coverage < lead time   →  cannot replenish in time
```

### 4.4 Time-phased projected balance (the "plan simulation") `[V]`
Iterate the **Projected Available Balance (PAB)** recurrence per period (day or week):
```
PAB(t)  = PAB(t−1) − planned_issues(t) + expected_receipts(t)
PAB(0)  = on_hand − reserved − expired
```
- `planned_issues(t)` = gross requirements from approved plans landing in *t* (the `status=reserved` consumption events).
- `expected_receipts(t)` = open PO quantities scheduled to arrive in *t*.
- **Flag the first period where `PAB(t) < 0`** (or `< safety_stock` for an earlier warning) → projected shortage period; shortfall magnitude drives the recommended PO quantity.

This is MRP "gross requirements → net against on-hand + scheduled receipts → planned order release," scoped to one item-location (no BOM explosion needed).

### 4.5 Reservations
On plan **approval**, insert reserve movements (or `status=reserved` consumption events) that decrement **available** but not **on_hand**. On execution, flip `reserved → done`: the issue hits the ledger (on_hand drops) and the reservation clears. One event table; two states of the same row.

### 4.6 Worked example (Arabic-first output)
Given: on_hand 300 kg, plan needs 500 kg next week, lead time 5 days, 95% service (Z=1.65), σ_d=20 kg/day.
1. Available = 300.
2. Safety stock = 1.65×20×√5 ≈ **74 kg**.
3. ROP ≈ 500 + 74 = **574 kg** > 300 on-hand → **reorder now**.
4. PAB(1) = 300 − 500 = **−200 kg → shortage week 1**.
5. Coverage = 300 ÷ 500/week ≈ **4.2 days < 5-day lead time** → unrecoverable without action.
6. Recommended PO = shortfall + SS = 200 + 74 ≈ **274 kg → round to 300 kg**, order today.

**System message:** *"⚠️ نقص متوقع: 200 كجم سلفات بوتاسيوم الأسبوع القادم. الغطاء الحالي 4 أيام < مهلة التوريد 5 أيام. اطلب 300 كجم اليوم."*

**Alarm types:** below reorder point · plan shortage · early stock-out · lead-time risk · reserved-stock conflict · safety-stock breach · expiry risk · over-consumption · purchase-delay risk · budget conflict.

**Sources:** [Oracle MRP — Available to Promise](https://docs.oracle.com/cd/A60725_05/html/comnls/us/mrp/atp.htm) · [APICS MPS time-phased record](https://en.wikiversity.org/wiki/Master_Production_Schedule) · [NetSuite — Safety Stock](https://www.netsuite.com/portal/resource/articles/inventory-management/safety-stock.shtml) · [Netstock — Reorder Point](https://www.netstock.com/blog/reorder-point-formula/).

---

## 5. Budget engine
Mirror the stock logic for money:
```
committed   = Σ approved-but-unpaid commitments (approved PRs + reserved plan costs)
available   = approved_budget − actual − committed
coverage    = available ÷ planned future spend rate   → budget-runout date
variance    = actual + committed − planned ;  variance_pct = variance / planned
```
When planning an operation: `planned_cost + committed + actual` vs budget → states **enough / low / exceeded / approval-needed / transfer-needed**. Budget-gating is what makes a purchase request require owner approval when it breaches a category threshold.

---

## 6. Scaling the event table `[V]`
The `farm_event` table is the hottest/largest. From day one:
1. **Declarative RANGE partitioning by `occurred_at`** (monthly; daily if heavy) → partition pruning.
2. **BRIN index on `occurred_at`** per partition (`WITH (pages_per_range=32)`) — tiny vs btree on append-only time-correlated data.
3. **Composite btree `(org_id, occurred_at)`** on hot partitions for tenant-scoped queries.
4. Query with `occurred_at >= $from AND occurred_at < $to`; never wrap the partition key in a function (breaks pruning).
5. Run `brin_summarize_new_values()` after bulk loads.
6. Keep materialized `inventory_bin` (on-hand snapshot per item×location) so reads never re-sum the ledger.

**Sources:** [PostgreSQL partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Supabase RBAC / custom claims](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac).

---

## 7. AI assistant "عبدالجليل" architecture
- **Server-side only** (`/api/chat`); LLM key in env; **never client-side**. Recommend **Claude** for Arabic financial/agronomic reasoning.
- **Tool-calling against read-only RPCs** that already enforce RLS for the asking user — the model never gets raw table or service-role access. Whitelisted tools: `sector_profit(season)`, `pending_vouchers()`, `stock_coverage(item)`, `plans_blocked()`, `rpw_trend(sector)`, `last_operation(hawsha, subtype)`, `budget_status(category)`.
- **Permission-aware:** a supervisor can't get financials unless allowed (AI honors the same RBAC).
- **System-prompt guardrail:** "answer only from tool results; never invent numbers; if data is missing, say so; label forecasts as estimates." Counters hallucination.
- **Outputs:** owner summary, weekly plan draft, monthly review, budget/stock-risk explanation, disease checklist, operation recommendation, WhatsApp message, report narrative.

---

## 8. Migration from existing data (Ebeid → product)
Flat `expenses`/`sales` rows → `farm_event(type=expense|sale)` + `ledger_entries` tagged season/enterprise/sector; `palm_trees`/registry → `assets(type=palm)` with the per-hawsha counts/dates; offshoot jard → `assets(type=offshoot, parent=mother palm)` + movements. Reuse the existing `migrate-data.mjs`. **Validation:** Σ(hawsha palms)=farm total; every expense/sale has season+enterprise+sector; dual-run one closed season vs the Excel totals before cutover. **Cleanup flagged in the real data:** separate `مسحوبات` (owner drawings) from operating expenses; fix `العام الحقلي` typos; remove the Gmail+plaintext-password from the source sheet.

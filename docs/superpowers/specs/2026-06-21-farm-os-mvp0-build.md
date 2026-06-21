# Build — Farm OS MVP-0 proof-of-value wedge (Sub-project B)
*Status: Draft → ready for implementation plan · Date 2026-06-21 · Owner: Amr Ebeid*

## 1. Context & scope
**Farm OS** (نظام تشغيل المزارع) is an Arabic-RTL-first, multi-tenant SaaS — *plan the season, control stock and budget before money is spent, assign responsibility, and keep a tree-level activity file* — for medium/large date-palm and fruit farms in Egypt/MENA. Its differentiator (PRD §2): *the only system that answers "given my plan, will I run out of stock or budget — and what do I buy, when?" in Arabic, at tree level, with an approval gate.*

This spec is **Sub-project B, scoped to MVP-0 only** — the proof-of-value wedge, **not the whole product**. MVP-0 stands up the wedge loop end-to-end on **one reference tenant (Ebeid Farm / `مزارع عبيد`)** to validate four kill/continue hypotheses (06 §1):
- **H1** — a farm manager builds a monthly plan in the tool instead of paper/WhatsApp.
- **H2** — the stock-coverage forecast changes a purchasing decision (catches a shortage before the field).
- **H3** — the farm/palm file is something the owner/engineer opens repeatedly.
- **H4** — an owner confirms willingness to pay a setup fee after seeing it.

B **consumes `@farm-os/ui` (Sub-project A)** — the publish-ready, white-label, RTL component library — as its presentation layer; A owns components and theming, B owns screens, data, auth, and workflows (A's spec §1). The library is presentational only and ships no strings, so **B owns all Arabic copy, i18n, and `dir`**.

**Explicitly deferred to later specs:** the full product — MASTER-PLAN Stages 1–11 in their complete form, plus Stage M (real-data migration) and Stage P (production deploy). MVP-0 cherry-picks the thin slice of Stages 1–6 needed for the loop and stubs/skips the rest. This is a **non-production pilot** (no real money, no customer deploy, reference tenant only; 06 §1). Per the OS, this spec defines **WHAT, not authorization to start** — each stage is Owner-gated separately.

## 2. Decisions locked
Pulled from 03-architecture (header + §1–2) and A's design spec.

| Decision | Choice |
|---|---|
| App framework | **Next.js (App Router) + TypeScript** — RSC for reads, Server Actions / Route Handlers for writes |
| Backend / DB | **Supabase**: Postgres (+ PostGIS), **Auth (phone OTP)**, Storage, Realtime, Edge Functions, **RLS** |
| Tenancy model | Single shared schema, **`org_id` on every tenant table**, **RLS deny-by-default**, membership-table isolation via `auth.user_org_ids()` |
| Styling | **Tailwind, RTL-first** + `@farm-os/ui` CSS-variable theme tokens (logical CSS, `dir="rtl"`) |
| Component library | **`@farm-os/ui`** (Sub-project A) — AppShell, DataTable, KpiCard, VerdictBanner, LoopStepper, charts wrappers, etc. |
| Charts | **Recharts** (per 03 architecture diagram) via A's theme-aware chart wrappers |
| Hosting | **Vercel** |
| Field capture | **PWA, offline-first for drafts** (IndexedDB queue); approvals/financial posting are online-only |
| Heavy logic | **In Postgres** — stock-coverage simulation, budget check, reorder calc, reservations run as DB functions/RPC close to the data |
| Secrets / AI | server-side only; no service-role key or secret in the client bundle |

## 3. Goal & success criteria
**Goal (06 §1):** prove the wedge loop end-to-end on Ebeid Farm — *plan a month → see stock coverage → hit a budget gate → draft a purchase request → record the operation → see planned-vs-actual in the farm file.*

**Build is functionally done when** the §7 core loop runs end-to-end against real seed tables (not mocks) and these acceptance gates pass (09; 06 §7) — written **checks-first**:
- **SC-1 covered / SC-2 shortage+recommendation / SC-3 reorder point / SC-5 time-phased PAB** — stock-coverage math.
- **RS-1** — approve reserves, execute issues (available moves, on_hand doesn't until receipt/issue).
- **BG-1** — budget gate on breach routes to Owner approval; **AP-1/AP-2** — only Owner approves, author ≠ approver (enforced at RLS/`authorize`, not UI).
- **TI-1** — cross-tenant SELECT returns zero rows even with a guessed org id.
- **FF-1** — an operation rolls up into palm → line → hawsha → sector → farm files.
- **OF-1** — offline draft survives and syncs.
- Performance smoke: dashboard **< 2s**, stock-coverage fn **< 300ms** (09 PF-1/PF-2).

**Commercial validation gate (the real kill/continue — 06 §10, tracked on PROJECT-TRACKER):** Pilot is a **PASS only if ≥ 5 of 7**: 5 farms interviewed · 2 share real data · 1 builds a monthly plan unaided · 1 validates stock coverage ("would have caught a real shortage") · 1 owner confirms WTP a setup fee · 1 accountant confirms reports useful · 1 supervisor confirms mobile flow (< 60s to log). **< 5/7 → pause, do not start the full MVP.**

## 4. Data model (MVP-0 subset)
The spine is farmOS's proven **Asset + Event + Quantity** triad (03 §3): *one append-only `farm_event` table whose `status` (`planned → reserved → done/abandoned`) makes plan, reservation, and actual the same row at different stages* — which is exactly what the stock-coverage simulation iterates over. MVP-0 builds **only** the tables below (06 §3); everything else (full accounting/expenses/sales/vouchers/ledger, payroll, weather_*, academy/disease_*, CRM, harvest grading, AI RPCs) is later.

**Tenancy & people**
- `organization(id, name, locale='ar', currency='EGP', area_unit='feddan', fiscal_year_start, settings jsonb)`
- `organization_member(org_id, user_id, role, scope jsonb, PRIMARY KEY(org_id, user_id))`
- `people(id, org_id, name, phone, email, position, employment_type, rate, user_id, active, reports_to_person_id)`
- `responsibility_assignments(id, org_id, person_id, scope_type, scope_id, responsibility_type)` — auto-routing (shortage → storekeeper + accountant + manager).
- `audit_log(id, org_id, actor_user_id, action, entity_type, entity_id, before jsonb, after jsonb, occurred_at)` — append-only via AFTER triggers; **no UPDATE/DELETE policy → immutable by omission.**

**Structure & assets (`type=palm` only in MVP-0)**
- `farms(id, org_id, name, code, …, area_feddan, owner_person_id, manager_person_id, main_crop, …)`
- `sectors(id, org_id, farm_id, name, code, area_feddan, crop, planting_date, …)`
- `hawshat(id, org_id, sector_id, name, code, area_qirat, row_count, palm_count_barhi, palm_count_male, planting_date, …)`
- `lines(id, org_id, hawsha_id, line_no, line_code, palm_count, direction, notes)`
- `assets(id, org_id, type, name, parent_id, sector_id, hawsha_id, line_id, variety, sex, status, health_status, planting_date, id_tag, …)` — `status: active|watch|sick|dead|removed|replaced`.
- `palm_status_history(id, org_id, asset_id, status, health_status, changed_by, changed_at, reason)`
- Palm code standard: `[FarmCode]-[SectorCode]-[HawshaCode]-L[LineNo]-P[PalmNo]` → `EBD-BAB-H03-L12-P008`.

**Events (the spine) + quantities**
- `farm_event(id, org_id, type, subtype, status, occurred_at, planned_at, season_id, enterprise_id, performed_by_person_id, assigned_to_person_id, created_by, plan_id, notes, geom, data jsonb)` — `status: planned|reserved|ready|blocked|in_progress|done|abandoned|skipped`; partitioned by `occurred_at`.
- `event_assets(event_id, asset_id, org_id)` — M:N which assets an event touched (events ref assets, never the reverse).
- `event_locations(event_id, org_id, farm_id, sector_id, hawsha_id, line_id)`
- `quantities(id, org_id, event_id, measure, value_num, value_den, unit_term_id, label, material_id, inventory_adjustment)` — a planned fertilization is a `status=planned` event with a material quantity carrying a negative `inventory_adjustment`; flipping to `done` posts the issue and clears the reservation.
- `event_attachments(id, org_id, event_id, storage_path, kind, checksum)`; `event_followups(id, org_id, event_id, due_at, assigned_to_person_id, status, note)`; `event_status_history(…)`.

**Inventory (the wedge)**
- `inventory_items(id, org_id, name, category, unit, pack_size, min_stock, max_stock, safety_stock, reorder_point, reorder_qty, lead_time_days, preferred_supplier_id, criticality, expiry_tracked)`
- `inventory_bin(item_id, org_id, location, on_hand, reserved, ordered, projected)` — materialized ERPNext-style snapshot per item×location, so reads never re-sum the ledger.
- `inventory_movements(id, org_id, item_id, type, qty, unit, unit_cost, occurred_at, event_id, plan_id, supplier_id, expiry_date, batch_no)` — `type: receipt|issue|return|adjustment|transfer|loss|expiry|reserve|release`.
- `suppliers(id, org_id, name, phone, terms, lead_time_days)`

**Planning**
- `plans(id, org_id, type, period_start, period_end, scope_type, scope_id, status)`
- `plan_operations(id, org_id, plan_id, subtype, target_type, target_id, planned_at, priority, responsible_person_id, est_cost, approval_needed, status)`
- `plan_material_requirements(id, org_id, plan_op_id, item_id, qty, unit)`
- `plan_labor_requirements(id, org_id, plan_op_id, person_or_team, count, days)`
- `plan_checks(id, org_id, plan_id, kind, result, detail jsonb)` — `kind: weather|stock|budget|labor|responsibility` (weather always ✅ in MVP-0).

**Budget & purchase**
- `budgets(id, org_id, name, period, scope_type, scope_id, category, planned, approved, committed, actual, status)`
- `budget_lines(id, org_id, budget_id, category, planned, approved, committed, actual)`
- `purchase_requests(id, org_id, code, requested_by, needed_by, reason, plan_id, event_id, status, budget_category_id)`
- `purchase_request_items(pr_id, org_id, item_id, qty, unit, supplier_id, est_cost)`

**Platform**
- `attachments(id, org_id, entity, path, kind, checksum, uploaded_by, created_at)` — Supabase Storage path `{org_id}/{entity}/{uuid}`; storage RLS checks `(storage.foldername(name))[1] in (select auth.user_org_ids()::text)`; signed URLs only.

**RLS (every table, from line one):** deny-by-default, `org_id` isolation, `TO authenticated`, indexed `org_id`. Policies join membership via the security-definer helper (03 §2):
```sql
create or replace function auth.user_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.organization_member where user_id = (select auth.uid())
$$;
create policy tenant_all on farm_event for all to authenticated
  using ( org_id in (select auth.user_org_ids()) )
  with check ( org_id in (select auth.user_org_ids()) );
```
RBAC uses `authorize('permission')` security-definer fn so policies call `authorize('pr.approve')` rather than hard-coding roles.

## 5. The 14 MVP-0 screens
The full v1 catalogue is in 07-SCREEN-MAP; MVP-0 ships only these 14 (06 §2). `@farm-os/ui` component names per A's catalog (A spec §4). Roles: O=owner, M=manager, E=engineer, A=accountant, S=storekeeper, V=supervisor.

| # | Screen | Purpose | Role(s) | `@farm-os/ui` components |
|---|---|---|---|---|
| 1 | **Login + Role** | phone-OTP auth (stub OK in pilot), org pick, role badge | all | Field, Input/NumberField, Button, Tag (role badge), AppShell (post-auth) |
| 2 | **Owner Dashboard (lite)** | profit-to-date, pending PR approvals, stock risks, alerts | O | AppShell, KpiCard, Stat, Alert, DataTable, Bar/Line chart wrappers |
| 3 | **Manager Dashboard (lite)** | this month's plan, blocked ops, stock readiness | M | AppShell, KpiCard, DataTable, StatusPill, Progress |
| 4 | **Supervisor Mobile Home** | today's tasks + 3 big buttons (Record op / Report issue / Request stock) | V | AppShell (compact), Button (IconButton), EmptyState, offline-draft badge (Tag) |
| 5 | **Farm Map / Structure** | sectors → hawshat list (grid map optional) | M/E/O | AppShell, DataTable/cards, PalmGrid/PalmCell (optional), Breadcrumbs |
| 6 | **Farm / Sector / Hawsha / Palm File** | one living activity file, 4 scopes, event timeline | O/E/M | DescriptionList, Timeline/FileTimeline, Tabs, Tag, Avatar, KpiCard |
| 7 | **Monthly Plan** | plan operations + status chips + check summary | M | DataTable, StatusPill, LoopStepper, Alert, Button |
| 8 | **Operation Builder** | add one planned op: type, target, date, materials, labor, est cost | M | Modal/Drawer, Field, Select, Combobox, DateField, NumberField, FormRow |
| 9 | **Operation Execution Form (mobile)** | record actual: location, materials used, labor, photo, mark done | V | Drawer/Sheet, Field, NumberField, camera/file input, Button, offline-draft Tag |
| 10 | **Inventory List** | items, on-hand, reserved, available, reorder flag | S | DataTable (sortable, tabular nums, RTL), Tag/StatusPill, Button |
| 11 | **⭐ Stock Coverage Screen (the wedge)** | per-item coverage days, projected stock-out, PAB chart (first-shortage highlighted), purchase recommendation | M/S | **VerdictBanner**, KpiCard/Stat, Line chart wrapper (PAB), Alert, Button (Create PR) |
| 12 | **Budget Check Screen** | budget vs planned, verdict (enough/low/exceeded), route-to-approval | A/O | VerdictBanner, KpiCard, Progress, ApprovalChain, Button |
| 13 | **Purchase Request (draft)** | create draft from shortage → owner approves | S/M/O | DataTable, ApprovalChain, ConfirmDialog, Button, Tag |
| 14 | **Planned-vs-Actual Report** | per plan: planned vs actual cost/materials/dates + variance | O/M | DataTable, Stat, Bar chart wrapper, DescriptionList |

**Excluded screens (post-MVP-0):** full accounting, sales/CRM, payroll/HR, weather, Academy, export, AI assistant, audit-log UI (events still written), advanced settings, billing.

## 6. Stock-coverage engine (the kill/continue differentiator)
Summarizes **SPEC-0001** + 03 §4. A lightweight MRP built on three classic primitives — **reorder point, available-to-promise, time-phased projected balance** — run **per item×location as a Postgres function** (`fn_stock_coverage(item_id, location, horizon)`) over the append-only event/movement stream + the materialized `inventory_bin` snapshot. It is the **first deep workstream**: the wedge must be proven before the rest of the build earns investment.

**Inputs:** `on_hand`, `reserved`, expired stock, planned consumption (the `status=reserved` consumption events from approved plans), `lead_time_days` (item or supplier), `safety_stock`, scheduled receipts (open PO qty).

**Formulae:**
- `Available = on_hand − reserved − expired`
- `ROP = (average demand per period × lead time) + safety stock`
- Safety stock: fixed-days default (`SS = k_days × d̄`) → upgrade to `SS = Z·σ_d·√L` when variance data exists (`Z`: 1.28→90%, 1.65→95%, 2.33→99%).
- `Coverage (periods) = available ÷ planned consumption rate`; `Projected stock-out date = today + coverage`; **flag when coverage < lead time** (cannot replenish in time).
- Time-phased PAB recurrence: `PAB(t) = PAB(t−1) − planned_issues(t) + expected_receipts(t)`, `PAB(0) = on_hand − reserved − expired`. **Flag the first period where `PAB(t) < 0`** (earlier warning at `< safety_stock`); shortfall magnitude drives the recommended PO qty.

**Outputs:** available, ROP, coverage days, projected stock-out date, time-phased PAB series, first-shortage period, and a **purchase recommendation** = shortfall + safety stock − scheduled receipts, rounded to pack/MOQ, with an order-by date — plus an **Arabic-first message string**.

**Reservations:** on plan approval, insert reserve movements / `status=reserved` consumption events that decrement **available** but not **on_hand**; on execution, flip `reserved → done` (issue hits the ledger, on_hand drops, reservation clears). One event table, two states of the same row. The `inventory_bin` snapshot is the materialized result.

**Worked Ebeid example (03 §4.6):** on_hand 300 kg سلفات بوتاسيوم, plan needs 500 kg next week, lead time 5 days, 95% service (Z=1.65), σ_d=20 kg/day →
1. Available = 300. 2. SS = 1.65×20×√5 ≈ **74 kg**. 3. ROP ≈ 500 + 74 = **574 kg** > 300 → reorder now. 4. PAB(1) = 300 − 500 = **−200 kg → shortage week 1**. 5. Coverage = 300 ÷ 500/week ≈ **4.2 days < 5-day lead** → unrecoverable without action. 6. Recommended PO = 200 + 74 ≈ 274 → **round to 300 kg, order today**.
System message: *"⚠️ نقص متوقع: 200 كجم سلفات بوتاسيوم الأسبوع القادم. الغطاء الحالي 4 أيام < مهلة التوريد 5 أيام. اطلب 300 كجم اليوم."*

The seed data deliberately reproduces this shortage so the demo is real, not mocked. **Reconciliation invariant:** `Σ(movements) per item×location == inventory_bin.on_hand` at all times (SC-6) — a rebuild-from-ledger utility is the fallback. **Independent review of the math is REQUIRED** before this ships (SPEC-0001 risks; MASTER-PLAN Stage 5).

## 7. The core loop workflow (must work end-to-end — 06 §6)
1. Manager opens **Monthly Plan** for الحصوة → **Operation Builder** → adds تسميد بوتاسي (target الحصوة, date next week, material سلفات بوتاسيوم 500 kg, labor 4, est cost 42,000).
2. System runs **plan_checks**: stock (⛔ shortage), budget (⚠️ low), weather (skip in MVP-0 → always ✅), labor (✅), responsibility (✅).
3. Manager opens **Stock Coverage** for سلفات بوتاسيوم → available 300, coverage ~4 days < 5-day lead → **shortage**, recommendation ~300 kg, order today.
4. Manager/storekeeper clicks **Create Purchase Request (draft)** → PR-0001 linked to plan + shortage; **reserves 500 kg** (available drops, on_hand unchanged).
5. **Budget Check** shows أسمدة category at 87%, this plan pushes over the comfort threshold → routes to **owner approval**.
6. **Owner approves PR-0001** (writes `audit_log`; WhatsApp link is a stub in MVP-0).
7. Storekeeper records a **receipt** (300 kg) → on_hand rises; available recomputes.
8. Supervisor opens **Operation Execution Form** (mobile) → logs actual 480 kg used, 4 labor, photo → marks **done**. Inventory issues; cost allocates to الحصوة.
9. **Farm/palm files update automatically** (the operation appears in the الحصوة file + each touched palm).
10. **Planned-vs-Actual Report** shows planned 500 kg/42,000 vs actual 480 kg/40,320, variance −20 kg/−1,680, reason captured.

**Supporting workflows:** report an issue (supervisor → auto-assign engineer → appears in palm file); reserve→release when a plan op is cancelled (RS-2); reconcile bin from ledger (admin utility).

## 8. Roles & permissions
**MVP-0 roles** (subset of the 10 defaults in 03 §2): `owner`, `farm_manager`, `agri_engineer`, `accountant`, `storekeeper`, `supervisor`. The pilot seeds 5 members + 1 storekeeper (06 §5).

- **RLS** enforces tenancy in Postgres, deny-by-default, `org_id` isolation via `auth.user_org_ids()` — never only in the app layer.
- **RBAC** via `authorize(permission)` (e.g. `authorize('pr.approve')`); **scope** (which sectors) lives in `organization_member.scope` — a supervisor writes operations only for assigned sectors.
- **Separation of duties is absolute (author ≠ approver):** only `owner` can approve a budget-breaching PR, enforced at the RLS/`authorize` layer not the UI (AP-1); the PR author cannot self-approve (AP-2); approvals are idempotent and reject stale versions (AP-3); every approve/reject/edit writes an immutable `audit_log` row (AP-4).

## 9. Non-functional requirements
- **Arabic-RTL-first** — RTL layout, فدان/قيراط, قطاع/حوشة/خط/نخلة; not an afterthought. `@farm-os/ui` is RTL-capable; B supplies all copy.
- **Offline-first PWA for field capture** — drafts (operation reports, issues, photos, stock requests, inspections) saved locally (IndexedDB) with a "pending sync" badge; sync on reconnect (OF-1). **Online required** for approvals, final stock posting, financial posting, permission changes (OF-2). No full offline *sync* in MVP-0 — drafts only.
- **Audit-on-write immutability** — every state change writes `audit_log`; the table has no UPDATE/DELETE policy. Approved financial-style records are corrected via reversing entries, never silently edited (FC-1/FC-2 — applies to PR/budget commitments in MVP-0).
- **Attachments** — Supabase Storage, path `{org_id}/{entity}/{uuid}`, signed URLs (TTL ~15 min), compress on upload, max 10 MB, jpg/png/webp/pdf only (AT-1/AT-2).
- **Performance targets** — owner dashboard renders **< 2s**; stock-coverage fn returns **< 300ms** per item×location; file timelines paginated; `farm_event` partitioned by month with BRIN on `occurred_at` + composite `(org_id, occurred_at)`; keep `inventory_bin` materialized (09 PF-1/2/3, 10 §15).
- **Seed data (Ebeid reference tenant — real figures, never fabricated; 06 §5):** 1 org `مزارع عبيد` (locale=ar, currency=EGP, area_unit=feddan); 5 members + 1 storekeeper (Amr Ebeid owner, عبد الجليل أسامة manager, حسام زكي engineer, أحمد ماهر accountant, السيد أبو أحمد supervisor); 1 farm; **5 sectors** (الـ22 فدان 948 برحي, الحصوة 1,165 + موركيت, حوض البابور 1,485, الشفعة 269, الخطارة 513); **28 hawshat** with real area/palm-count/planting-date; **~60 sample palm assets** in الحصوة/حوشة 2 (lines 1–8) with mixed status; **6 inventory items** (سلفات بوتاسيوم 300/200, يوريا 140/200, مبيد فطري 22/15, كرتون تعبئة 420/500, سولار 850/400, فرمون السوسة 30/20) + 1 supplier «الدلتا للأسمدة» (lead 5d); **1 monthly plan** for الحصوة with 3 ops; **budget lines (2025)** أسمدة 1,000,000 (spent 870,000, committed 70,000 → available 60,000), ري ووقود 400,000, عمالة 1,400,000 — **deliberately reproducing the worked shortage (300 vs 500, 5-day lead) and the budget breach.**

## 10. Testing & gates
- **Checks-first for the stock engine** — write the SPEC-0001 unit checks (worked example + edge cases: zero demand, on_hand ≥ requirement, lead time > horizon, expiry netting, multiple receipts) **before** implementing `fn_stock_coverage`. The check is the oracle; never weaken a test to make the engine pass.
- **Cross-org RLS leak test** — TI-1: user in org A querying any tenant table returns only A's rows; a guessed org B id returns zero. This is the Stage-1 gate; **independent review + manual verification REQUIRED**.
- **Acceptance tests from 09** (the §3 list) become the automated suite: SC-1/2/3/5, RS-1/2, BG-1/2/3, AP-1..4, TI-1, FF-1, OF-1/2, AT-1/2, plus PF smoke targets.
- **Reconciliation oracle** — `Σ(movements) == inventory_bin.on_hand` (SC-6) in CI.
- **Validation gates (commercial, the real go/no-go)** — the §3 pilot criteria (≥5/7) on PROJECT-TRACKER; **< 5/7 → pause.**
- **Per-stage Definition of Done (10 §16):** code complete (approved slice only) · acceptance tests written-first & passing (evidence attached) · RLS verified · Arabic-RTL checked · mobile behavior checked · audit events written · no secrets committed · Owner gated · independent reviewer approved (High/Critical) · tracker/spec/brief updated · rollback path documented.

## 11. Non-goals (MVP-0)
Do **not** build in MVP-0 (06 §8, 02 §7–8): full accounting (expenses/sales/vouchers/ledger, P&L) · full payroll/HR · weather engine (check always passes) · Care Academy + disease library · AI assistant عبدالجليل · export/traceability/certs · harvest grading · sales CRM · audit-log UI (events still written) · advanced settings · billing/subscriptions · multi-tenant self-signup / customer onboarding UI · native mobile app · offline *sync* (drafts only) · production deploy (Stage P) · real-data migration beyond seeded reference figures (Stage M). These are deferred to MVP and later staged specs.

## 12. Decisions log
- **2026-06-21** — MVP-0 scoped as the proof-of-value wedge on one reference tenant (Ebeid), validating H1–H4; not the full ERP. (06 §1)
- **2026-06-21** — B consumes `@farm-os/ui` (Sub-project A) as presentation layer; B owns all Arabic copy/i18n/`dir` (library is presentational, ships no strings). (A spec §1, §4)
- **2026-06-18** — Stock-coverage engine built as an **in-DB Postgres function** (not app-layer) so API + future AI RPC reuse it; safety stock starts fixed-days, upgrades to `Z·σ·√L` when data allows. (SPEC-0001)
- **2026-06-18** — Asset+Event+Quantity spine with `status` lifecycle adopted as the data model; to be locked as **ADR-0001** once Stage 0 closes. (03 §3, MASTER-PLAN §9)
- **2026-06-18** — Tenancy via membership-table RLS + `auth.user_org_ids()` (not JWT-only `org_id`, which breaks multi-org consultants and delays revocation). (03 §2)
- **2026-06-18** — Pricing is **per-farm in EGP**, never per-seat (a project non-negotiable; not built in MVP-0 but must not be contradicted).

## Open questions
- **Palm-count sign-off** — registry (Nov 2025) is canonical at **4,380 برحي / 299 ذكور / 28 حوش**; Owner must sign off before any palm import beyond the ~60 seeded samples. (MASTER-PLAN §9 action 2)
- **4-vs-5 sectors** — seed lists 5 sectors (الـ22 فدان, الحصوة, حوض البابور, الشفعة, الخطارة); MASTER-PLAN flags a 4-vs-5 label decision for the Owner. Resolve before structure import.
- **Agronomist sign-off** — any NPK/irrigation/pesticide numbers are editable templates, not prescriptions; require a named local agronomist + current Egyptian pesticide-registration sign-off. Not in MVP-0 scope, but seed agronomy values (e.g. 500 kg potassium) must be flagged as illustrative, not authoritative. (MASTER-PLAN Stage 10, action 3)
- **Phone-OTP provider** — 03 names Supabase Auth phone OTP; pilot allows a stub. Confirm whether a real SMS provider is wired for the pilot or OTP stays stubbed.
- **WhatsApp approval** — stubbed in MVP-0 (a link); confirm it stays a stub for the pilot demo.
- **Safety-stock data** — σ_d / lead-time variance are sparse early; default to fixed-days SS until variance data exists (documented default). Confirm the default `k_days`.

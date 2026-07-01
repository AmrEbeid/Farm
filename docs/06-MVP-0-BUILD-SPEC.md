# 06 — MVP-0 Build Spec (the first build)
*The tight, buildable document. A developer or Claude Code builds **only** what is here — nothing more. Risk: Low–Medium (it is a non-production pilot on a single reference tenant). Owner: Amr Ebeid.*

> ⚠️ **HISTORICAL (2026-07-02):** MVP-0 shipped and has been far exceeded (accounting/custody kernel, weather
> gates, pest scouting, labor, templates and more are live — see [`STATUS.md`](STATUS.md)). Kept as the build
> record. **Retired decision:** auth is **email + password** (Owner decision 2026-06-24, no SMS/phone-OTP);
> the "phone OTP" row below is stale — do not reintroduce it.

> **Why MVP-0 exists:** the master plan's MVP is still large. MVP-0 is the *proof-of-value prototype* that answers one question before we invest in the full ERP: **will farms actually use planning + stock coverage + farm files?** It is deliberately smaller than MVP.

---

## 1. MVP-0 goal & hypothesis
**Goal:** prove the wedge loop end-to-end on **one reference tenant (Ebeid Farm)** — *plan a month → see stock coverage → hit a budget gate → draft a purchase request → record the operation → see planned-vs-actual in the farm file.*

**Hypothesis to validate (kill/continue):**
- H1 — a farm manager will **build a monthly plan** in the tool instead of on paper/WhatsApp.
- H2 — the **stock-coverage forecast** changes a purchasing decision (catches a shortage before the field).
- H3 — the **farm/palm file** is something the owner/engineer wants to open repeatedly.
- H4 — an owner confirms **willingness to pay** a setup fee after seeing it.

If H1–H4 don't hold on the pilot, we do **not** build the full ERP yet.

**Constraints:** Arabic-RTL-first; mobile-responsive supervisor flow; non-production (no real money, no real deploy to customers); reference tenant only.

---

## 2. Included screens (MVP-0 subset only)
Full v1 screen catalogue is in [07-SCREEN-MAP.md](07-SCREEN-MAP.md); MVP-0 ships **only** these 14:

| # | Screen | Primary user | MVP-0 cut |
|---|---|---|---|
| 1 | Login + role pick | all | phone OTP (stub OK in pilot) + role |
| 2 | Owner Dashboard (lite) | owner | profit-to-date, pending PR, stock risks, alerts |
| 3 | Manager Dashboard (lite) | manager | this month's plan, blocked ops, stock readiness |
| 4 | Supervisor Mobile Home | supervisor | today's tasks, "record operation", "report issue" |
| 5 | Farm Map / Structure | manager/engineer | sectors → hawshat list (grid map optional) |
| 6 | Farm / Sector / Hawsha / Palm File | owner/engineer | one file component, 4 scopes, activity timeline |
| 7 | Monthly Plan | manager | list of plan operations + status |
| 8 | Operation Builder | manager | add operation: type, target, date, materials, labor, est cost |
| 9 | Operation Execution Form (mobile) | supervisor | location, materials used, labor, photo, mark done |
| 10 | Inventory List | storekeeper | items, on-hand, reserved, available, reorder flag |
| 11 | **Stock Coverage Screen** | manager/storekeeper | per-item coverage + PAB chart + recommendation |
| 12 | Budget Check Screen | accountant/owner | budget vs planned, verdict, route-to-approval |
| 13 | Purchase Request (draft) | storekeeper/manager | create draft from shortage → owner approves |
| 14 | Planned-vs-Actual Report | owner/manager | per plan: planned vs actual cost/materials/dates |

**Excluded screens** (post-MVP-0): full accounting, sales/CRM, payroll/HR, weather, academy, export, AI assistant, audit log UI (events still written), advanced settings, billing.

---

## 3. Included tables (MVP-0 schema subset)
From [03-architecture §3](03-architecture-and-data-model.md). MVP-0 builds **only** these; everything else is later.

```
-- tenancy & people
organization, organization_member, people, responsibility_assignments, audit_log
-- structure & assets
farms, sectors, hawshat, lines, assets (type=palm only in MVP-0), palm_status_history
-- events (the spine)
farm_event, event_assets, event_locations, quantities, event_attachments, event_followups
-- inventory (the wedge)
inventory_items, inventory_bin, inventory_movements, suppliers
-- planning
plans, plan_operations, plan_material_requirements, plan_labor_requirements, plan_checks
-- budget & purchase
budgets, budget_lines, purchase_requests, purchase_request_items
-- platform
attachments
```
**Not in MVP-0:** expenses/sales/vouchers/ledger_entries (full accounting), payroll, weather_*, academy/disease_*, buyers/CRM, certifications/export, harvest_batches/grading, AI RPCs. RLS (`org_id` + membership) is on **every** table from line one.

---

## 4. User stories (MVP-0 features)
Full per-module/per-persona set in [08-USER-STORIES.md](08-USER-STORIES.md). MVP-0 must satisfy these:

- **Manager — Monthly Plan:** *As a farm manager, I want to build a monthly operation plan, so I know the required materials, labor, budget, and risks before execution.*
- **Manager/Storekeeper — Stock Coverage:** *As a manager, I want to see, when I add an operation, whether stock covers it and when it runs out, so I order before I'm short.*
- **Storekeeper — Reorder:** *As a storekeeper, I want a recommended purchase quantity and order-by date for each shortage, so I don't guess.*
- **Accountant/Owner — Budget gate:** *As an owner, I want a shortage to draft a budget-gated purchase request that I approve, so spending stays controlled.*
- **Supervisor — Mobile capture:** *As a supervisor, I want to record an operation on my phone with a photo in under a minute, so the record exists without paperwork.*
- **Owner/Engineer — Farm file:** *As an engineer, I want every event to appear automatically in the palm/hawsha/sector/farm file, so I never lose a record.*
- **Owner — Proof:** *As an owner, I want a planned-vs-actual report per plan, so I can see discipline and variance.*

---

## 5. Test data (seed the reference tenant — real Ebeid data)
Seed script must load:

- **1 organization:** `مزارع عبيد` (locale=ar, currency=EGP, area_unit=feddan).
- **5 members:** Amr Ebeid (owner), عبد الجليل أسامة (manager), حسام زكي (engineer), أحمد ماهر (accountant), السيد أبو أحمد (supervisor) + 1 storekeeper.
- **1 farm; 5 sectors** with real figures: الـ22 فدان (948 برحي), الحصوة (1,165 + موركيت), حوض البابور (1,485), الشفعة (269), الخطارة (513). **28 hawshat** with real area/palm-count/planting-date.
- **~60 sample palm assets** in الحصوة/حوشة 2 (line 1–8) with mixed status (sliver of watch/sick) so the map + files have data.
- **6 inventory items:** سلفات بوتاسيوم (on_hand 300, reorder 200, lead 5d, pack 50kg, cost 105), يوريا (140/200), مبيد فطري (22/15), كرتون تعبئة (420/500), سولار (850/400), فرمون السوسة (30/20). 1 supplier «الدلتا للأسمدة» (lead 5d).
- **1 monthly plan** for الحصوة with 3 operations: تسميد بوتاسي (needs 500 kg potassium next week), ري تأسيس (daily), رش وقائي (20th). 
- **Budget lines (2025):** أسمدة 1,000,000 (spent 870,000, committed 70,000 → available 60,000); ري ووقود 400,000 (spent 360,000); عمالة 1,400,000 (spent 1,290,000).
- This seed deliberately reproduces the **worked shortage** (300 on hand vs 500 needed, 5-day lead) and the **budget breach** (42,000 plan vs 60,000 available but category at 87%).

---

## 6. Exact workflows (MVP-0)
**The core loop (must work end-to-end):**
1. Manager opens **Monthly Plan** for الحصوة → **Operation Builder** → adds تسميد بوتاسي (target: الحصوة, date: next week, material: سلفات بوتاسيوم 500 kg, labor 4, est cost 42,000).
2. System runs **plan_checks**: stock (⛔ shortage), budget (⚠️ low), weather (skip in MVP-0 → always ✅), labor (✅), responsibility (✅).
3. Manager opens **Stock Coverage** for سلفات بوتاسيوم → sees available 300, coverage ~4 days < 5-day lead → **shortage**, recommendation ~300 kg, order today.
4. Manager/storekeeper clicks **Create Purchase Request (draft)** → PR-0001 linked to the plan + shortage; reserves 500 kg (available drops, on_hand unchanged).
5. **Budget Check** shows أسمدة category at 87%, this plan pushes over the comfort threshold → routes to **owner approval**.
6. Owner approves PR-0001 (writes `audit_log`; in MVP-0 a WhatsApp link is a stub).
7. Storekeeper records a **receipt** (300 kg) → on_hand rises; available recomputes.
8. Supervisor opens **Operation Execution Form** (mobile) → logs actual: 480 kg used, 4 labor, photo → marks **done**. Inventory issues; cost allocates to الحصوة.
9. **Farm/palm files** update automatically (the operation appears in الحصوة file + each touched palm).
10. **Planned-vs-Actual Report** for the plan shows planned 500 kg/42,000 vs actual 480 kg/40,320, variance −20 kg/−1,680, reason captured.

**Supporting workflows:** record an issue (supervisor → auto-assign engineer → appears in palm file); reserve→release if a plan op is cancelled; reconcile bin from ledger (admin utility).

---

## 7. Acceptance tests (MVP-0 critical features)
Full Given/When/Then catalogue in [09-ACCEPTANCE-TESTS.md](09-acceptance-tests.md). MVP-0 must pass at least these:

**Stock coverage — covered**
```
Given current stock = 100 kg, reserved = 20 kg
And a planned consumption of 50 kg on 10 July
Then available stock = 80 kg
And the operation is marked covered
And remaining stock after the operation = 30 kg
```
**Stock coverage — shortage**
```
Given current stock = 40 kg
And planned consumption = 70 kg
Then the operation is marked "blocked by stock"
And the system recommends a purchase of at least 30 kg + safety stock
And the recommended order-by date is today if coverage < lead time
```
**Reservation**
```
Given on_hand = 300 and reserved = 0
When a plan reserving 500 is approved
Then available = -200 is flagged as shortage, reserved = 500, on_hand stays 300
When the operation executes using 480
Then on_hand = 300 + receipts - 480, reserved clears, a movement(type=issue) exists
```
**Budget gate**
```
Given budget approved = 1,000,000, actual = 870,000, committed = 70,000 (available = 60,000)
When a plan adds a 42,000 fertilizer cost in that category
Then the budget check returns "low/approval-needed" (category at 91% after commit)
And the purchase request requires Owner approval before it can move past draft
```
**Tenant isolation (RLS)**
```
Given user U belongs only to org A
When U queries farm_event
Then only org A rows return; an org B id returns zero rows even if guessed
```
**Farm-file rollup**
```
Given an operation recorded against palm #2481 in الحصوة/حوشة 2
Then it appears in the palm file, the hawsha file, the sector file, and the farm file
```

---

## 8. Out-of-scope (MVP-0) — explicit
Do **not** build in MVP-0: full payroll · full accounting (expenses/sales/vouchers/ledger) · AI assistant عبدالجليل · full weather engine · full Care Academy · production billing/subscriptions · advanced multi-tenant customer management/self-signup · export/traceability/certs · harvest grading · sales CRM · offline *sync* (drafts only, see ops doc) · native mobile app. These are deferred to MVP and later phases per [02-PRD §8](02-prd.md).

---

## 9. Demo script (pilot demo — 10 beats)
1. Login as **owner** → dashboard (profit + 1 pending approval + 1 stock risk).
2. Switch to **manager** → open الحصوة → **Sector File** (history).
3. **Monthly Plan** → **Operation Builder** → add the potassium fertilization.
4. System flags **stock shortage** + **budget low**.
5. Open **Stock Coverage** → PAB chart shows run-out in ~4 days < 5-day lead.
6. **Create Purchase Request** (300 kg, order today) — reserves stock.
7. **Budget Check** → routes to owner; switch to **owner** → approve.
8. Switch to **supervisor (mobile)** → **Operation Execution Form** → photo → done.
9. **Farm/palm file** updates live.
10. **Planned-vs-Actual Report** → variance shown. *(This is the `farm-os-prototype.html` loop, now backed by real tables.)*

---

## 10. Pilot validation criteria (commercial gates — must hit before building full MVP)
```
Pilot is a PASS only if:
☐ 5 farms interviewed (Arabic customer-voice gap closed)
☐ 2 farms share real sample data (structure + a little stock/expense)
☐ 1 farm creates a monthly plan in the prototype unaided
☐ 1 farm validates the stock-coverage workflow ("this would have caught a real shortage")
☐ 1 owner confirms willingness to pay a setup fee
☐ 1 accountant confirms the planned-vs-actual / reports are useful
☐ 1 supervisor confirms the mobile operation flow is easy (<60s to log)
```
Track these on the [PROJECT-TRACKER](PROJECT-TRACKER.md). **If <5 of 7 pass, pause and rethink — do not start the full MVP.**

---
*MVP-0 is a planning artifact. Per the OS, building it is a separate, Owner-approved set of stages (each with its own execution prompt + gate). This spec defines WHAT, not authorization to start.*

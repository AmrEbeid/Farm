# SPEC-0030 — Navigation & workflow revamp: finish the task-first migration

*Status: **DRAFT** — design/plan only, no code. The Owner's standing verdict (SPEC-0025 §3): "not user
friendly… hard to navigate… need a guide to do any trx or to get a report… each trx done in a different
module… very hard to use." SPEC-0025 (task-first) + SPEC-0026 (operations lifecycle) already committed the
right direction and shipped most of it. **This spec is the finishing plan: retire the module-first IA that
still sits under the task-first shell, consolidate the 20-page finance module, wire the missing «راجع»
approvals intent, and close the concrete workflow dead-ends — all frontend-only, honoring the six
non-negotiables.***

## 0. Thesis

The vision is not in doubt and is not greenfield. Farm OS already has: a **task-first spine** (سجّل / المعاملات
/ التقارير + role homes), guided plain-Arabic **wizards** with review-sentence + confirm + quick-repeat, a
**story-first** narration layer (StoryLine, DashboardHub, KpiCard valence), a **⌘K command palette**, an
**auto-breadcrumb** trail, a **role-aware mobile tab bar**, a **five-question help drawer** (67 entries,
CI-guarded), an **honest offline execute-outbox**, and a **generated month-close checklist**. The problem is
that this task-first shell was **layered on top of the original spec-per-module IA** — so the same destinations
are reachable 2–3 ways, one module (finance) still lists **20 pages**, the third daily intent («راجع» /
approve) has **no home**, and several journeys **dead-end**. The revamp = **finish the migration**, not
reinvent.

## 1. Diagnosis (evidence-based)

**Navigation IA (`lib/nav.ts`, 11 modules / 51 sidebar pages + 26 invisible detail "360" pages):**
1. **Module-first IA under the task shell — the core debt.** The 4 "tasks" modules are a thin verbs layer over
   7 dense "admin" modules; the same page is reachable from the sidebar *and* the `/record`/`/reports` hubs.
2. **Finance = 20 pages (39% of the whole nav)**, one flat un-subgrouped list, with heavy overlap:
   **3 P&L surfaces** (`/finance/income-statement` قائمة الدخل, `/finance/pnl-trend` اتجاه الأرباح, and the
   orphan `/finance/pnl` linked only from the hub); **2 owner-insights pages** (`/finance/insights-summary`
   ملخّص الرؤى vs `/finance/insights` رؤى المالك); **2 scorecards** (sector + enterprise); a **budget triplet**
   (budgets / budget-vs-actual / budget-360); a **custody pair** (live `/custody` vs `/finance/custody-reports`);
   a **season/close pair**. (SPEC-0029's insight pages added to this — they need folding in.)
3. **Dashboard proliferation:** 9 module dashboards + 2 role dashboards (`/dashboard/owner`, `/dashboard/manager`)
   + the reports hub that *re-lists* the module dashboards as cards. Three answers to "where's home?".
4. **Cross-module misplacement:** attendance (تسجيل الحضور) is under Planning not Team; academy + offshoots (a
   valuation/finance concept) under Farm; the mobile surface is **split** (`/m` under Planning, `/m/receive`
   under Inventory).
5. **Desktop ↔ mobile paradigm mismatch:** a collapsible module sidebar (desktop) vs a hardcoded 5-tab bar
   (mobile) with a *different, role-variable* destination set the user must relearn.
6. **Role-gating is scattered** (inline `roles:[…]` in `nav.ts` + locally-redefined role sets in
   `record/page.tsx`/`reports/page.tsx` + per-page `requireRole`) → drift risk between sidebar visibility and
   server authorization, and the storekeeper-mobile bug below.
7. **The «الإدارة» label** ("administration") is a poor fit for farm/planning/inventory/weather — day-to-day
   operational work, not admin.

**Workflow dead-ends & friction (traced click-paths):**
8. **Approvals have no unified queue.** Only plan sign-offs have an inbox (`/plans/approvals`). Purchase-request
   and payment-request approvals are reached only by KPI-filter hunting. The owner's "what needs my signature
   today?" is spread across three modules with three patterns. **Highest-leverage fix.**
9. **Storekeeper mobile is broken:** the bottom-bar "الميدان" tab and `/m/receive`'s back-link both point to
   `/m`, which `requireRole` **rejects** for storekeeper → a bounce loop on their primary device.
10. **Money-in is one story sold as three hub cards** (سلّمت حمولة → حدّدت سعر → حصّلت) with no delivery→price
    chaining, and "الأسعار المعلّقة" surfaced under two different routes/names (`/record/price` vs
    `/finance/revenue-reports`).
11. **"Record an operation" is a detour, not a task:** the hub card dumps the user at the whole `/m` feed to hunt
    for the op (no "which operation?" picker), and there is **no way to record an unplanned/ad-hoc field
    activity** (`fn_execute_operation` requires a pre-existing plan line).
12. **Payment-request actions are tab-scattered:** the StoryLine names the next actor perfectly, but the button
    for that action is usually on a *different tab*; confirm-paid is per-line (20 taps for a 20-line request).
13. **Month-close can't close:** `/finance/close` generates the checklist but hands off to `/finance/periods` to
    actually lock; the three "مصروفات بلا…" items all link to the **unfiltered** `/expenses` list.
14. **Missing flows:** no **stock-take (جرد)** screen at all (only help copy), and no **multi-item purchase
    basket** (five short items = five single-line PRs from five coverage pages).
15. **Duplicate/decorative operations UX:** two competing "add operation" affordances on the plan page
    (OperationBuilder Drawer vs a PlanWizard link), and a **decorative `LoopStepper`** whose pr/approve/execute/
    report steps are hardcoded "pending" — it advertises a lifecycle it doesn't track, and none of its steps
    are links.
16. **`عدد العمال` is required for every op subtype** (incl. labor-less inspection) → forces a fabricated number.

**Rollout incomplete (the migration's unfinished edges):** `LineItemsEditor` not yet on receipts/attendance/
offshoots/جرد; `StoryLine` + the «لماذا؟» KPI-drill are prescribed for every section but applied unevenly;
wizards (the highest-confusion surface) fall back to the *parent page's* help, not their own; offline is
*tolerant* not *capable* (outbox covers only execute; PWA install blocked on a logo asset).

## 2. Principles (adopt, don't reinvent — from SPEC-0025 §2 + SPEC-0026)

1. **User states the event; the system keeps the books.** No internal vocabulary in any wizard ("payment
   request", "journal", "kind", "subtype" never shown — only questions a farmer/accountant would ask).
2. **Three always-visible intents: سجّل (record) · اعرف (get an answer) · راجع (approve/follow up)** — each ≤1
   tap from anywhere. **«راجع» is the missing one today.**
3. **≤ 3 clicks to any of the ~6 daily actions, from anywhere.**
4. **One ledger, one reports hub** — retire duplicate report/insight surfaces.
5. **Story-first:** lead with the templated Arabic sentence over live data, then chart (with takeaway caption),
   then table; every KPI has a «لماذا؟» drill; **rule-based only, no AI (Stage-11 gate), honest nulls (#1).**
6. **No dead ends:** every problem chip links to its fixing action; the drill chain sentence→chart→table→
   transaction→document never breaks.
7. **Operations in five plain-Arabic stages:** خطّط ← تحقّق ← اعتمد ← نفّذ ← تابع; the words said in the field
   (تسميد، رشة، حوش), never expert vocabulary.

## 3. Target navigation IA (the restructure)

### 3a. Elevate the spine to the three intents + one home
Replace the shallow tasks/«الإدارة» split with a **stable 5-item primary nav, identical on desktop and mobile**,
derived from ONE role-gated model:
- **الرئيسية** — the role home (owner/manager/field/store), the single "home".
- **سجّل** — the record launcher (exists).
- **راجع** *(NEW)* — the unified approvals/attention inbox (see §4.1).
- **التقارير** — the one reports hub (exists; absorb the module report pages).
- **الميدان / المعاملات** — field feed for field roles, ledger for finance roles (as today, but bug-fixed and
  role-derived, not hardcoded).
Everything else = **domain sections** below the spine, renamed from «الإدارة» to plain operational groupings
(**المزرعة · العمليات · المخزون · المال · الفريق · الطقس · الإعدادات**), each a *lean landing*, not a 20-item list.

### 3b. Consolidate finance (20 → ~7) — the biggest single win
Retire duplicates and sub-group the rest:
- **Merge the 3 P&L surfaces** → one "الأرباح والخسائر" that carries the statement + the trend/J-curve (fold
  `pnl-trend` in; delete the orphan `/finance/pnl`).
- **Merge the 2 owner-insights pages** → keep `/finance/insights-summary` (the cockpit) as "رؤى المالك"; retire
  the older `/finance/insights` or make it the cost-center detail *inside* the cockpit.
- **Group under 6–7 headings, not a flat list:** **الرؤى** (insights-summary cockpit → trend, sector-scorecard,
  enterprise-scorecard) · **القوائم** (income statement, balance sheet, trial balance/COA) · **الموازنات**
  (budgets + budget-vs-actual merged) · **العهدة والصرف** (custody live + custody report) · **الإقفال والموسم**
  (season + close, with close able to lock — §4.5) · **الدفاتر** (accounting ledger). Reports move into the hub.
- Net: the finance sidebar goes from 20 flat items to ~7 grouped entries; every insight page I shipped in
  SPEC-0029 lives under **الرؤى** with the cockpit as the entry.

### 3c. Collapse dashboard proliferation
The **role home** (owner/manager) is THE dashboard. Module "dashboards" become either (a) the module's landing
list, or (b) folded into the role home / reports hub as sections (SPEC-0025 §8's open decision — **recommend
folding**: one home, module landings are lean). The reports hub stops re-listing module dashboards.

### 3d. Fix cross-module placement + unify the mobile surface
- **attendance → Team**; **offshoots** stays discoverable from both Farm (physical) and المال/الرؤى (valuation)
  via cross-links, owned by one.
- **One field home «الميدان»** for all field roles that hosts execute + receive + harvest + attendance —
  fixing the split (`/m` vs `/m/receive`) and the storekeeper bounce (§4.2).
- **Desktop = mobile** primary nav (§3a), so there's one mental model.

## 4. Workflow fixes (the journeys)

1. **«راجع» — one unified approvals inbox.** Merge plan sign-offs (`/plans/approvals`), purchase-request
   approvals, and payment-request approvals into a single role-scoped queue ("ما يحتاج قرارك/توقيعك اليوم"),
   each row a StoryLine one-liner with its **one legal next action inline** and separation-of-duties enforced by
   the DB (`authorize`, `requested_by != me`). Surface it as the 3rd nav intent + a mobile tab + an owner-home
   AttentionInbox section.
2. **Fix storekeeper mobile** (Phase-1 bug): derive the mobile tab set from the role-gated model; point the
   storekeeper's field tab + `/m/receive` back-link at their real home (`/inventory/dashboard` or a store field
   home), never `/m`.
3. **Money-in as one story:** chain delivery → «سعّرها الآن» → «حصّل الآن»; one canonical "الأسعار المعلّقة"
   route (the pricing wizard), referenced consistently.
4. **Record-an-operation** becomes a picker ("أي عملية؟" — today/mine first) instead of a dump to `/m`; add an
   **ad-hoc field-activity capture** for unplanned work (a light `fn_record_event`-backed path), so "record what
   happened" is never a dead-end. Make `عدد العمال` optional for labor-less subtypes.
5. **Month-close can lock:** the close checklist performs the period lock inline (or embeds the `/finance/periods`
   action), and each "مصروفات بلا…" row links to a **pre-filtered** expense list, not the raw list.
6. **Payment-request:** surface the single next action **inline with the StoryLine lead** (not a different tab);
   add batch confirm-paid.
7. **Operations lifecycle:** remove the duplicate "add operation" affordance (keep the friendly multi-line
   wizard as primary, the power Drawer as "خيارات متقدمة"); make **`LoopStepper` stateful + every step a link**
   to its stage (خطّط/تحقّق/اعتمد/نفّذ/تابع), reflecting real progress.
8. **Missing flows:** design a **stock-take (جرد)** count-sheet → variance → reconciling-movement flow; add a
   **multi-item purchase basket** (batch reorder from the coverage list into one supplier PR).

## 5. Consistency rollouts (finish the migration)
- **Centralize role→surface authorization** in one module (the single source of truth for both nav visibility
  and page gating) so sidebar and server never drift; the storekeeper bug is a symptom of the current scatter.
- **`LineItemsEditor`** onto the remaining data-entry surfaces (receipts, attendance/labor, offshoots, جرد).
- **StoryLine + «لماذا؟» drill** on every dashboard section and report that still opens with a bare grid.
- **Dedicated wizard help** (the highest-confusion surface) instead of parent-page fallback.
- **No-dead-ends audit:** every empty state, every problem chip, every "→ رجوع" link verified to a valid,
  role-allowed destination (the storekeeper and close cases prove this isn't uniform yet).

## 6. Foundations (gated / larger — sequence last)
- **Offline → capable:** extend the outbox beyond execute (receive/harvest/attendance), ship the PWA
  installability (blocked on a brand-logo asset), run the offline→online smoke test.
- **Onboarding:** persist completion state; extend the first-run tour + the five-question help to wizards; the
  **WhatsApp field layer (SPEC-0022)** — the #1 adoption risk — remains security-gated (lethal-trifecta) and
  design-only until its review.

## 7. Non-negotiables (must hold throughout)
#1 honest nulls · #2 Arabic-RTL-first + mobile/offline-tolerant for field roles · #3 per-farm pricing · #4
agronomy = template pending agronomist + Egyptian-registration sign-off (keep the «اعتمادات مطلوبة» gate; **AI
narration stays behind Stage-11** — rule-based StoryLine/«لماذا» only) · #5 canonical palm registry · #6
drawings split from opex · **role separation** with decision-8 money posture (the FM home leads with field
actions and no absolute money; the accountant home leads with money) · **RLS-enforced** (UI only hides
affordances; the server re-checks). **Frontend-only** — compose existing RPCs; the only backend touch is
tiny owner-gated migrations (e.g. `plan_operations.blocked_reason` per SPEC-0026, and a possible `farm_event`
path for ad-hoc capture).

## 8. Phasing (quick wins → structural → foundations)

| Phase | Scope | Value | Effort |
|---|---|---|---|
| **1 — bug-fix quick wins** | storekeeper mobile bounce; month-close can lock + pre-filtered fix links; record-op picker + optional `عدد العمال`; money-in chaining + one pending-price route; retire duplicate add-op affordance | ★★★★★ | Low |
| **2 — «راجع» unified approvals inbox** | one role-scoped queue (plan + PR + payment) as the 3rd nav intent + mobile tab + owner-home section | ★★★★★ | Med |
| **3 — finance consolidation** | merge 3 P&L → 1, 2 insights → 1, budget triplet → 1; sub-group finance 20→~7; fold module dashboards into role homes; one reports hub | ★★★★★ | Med–High |
| **4 — missing flows** | stock-take (جرد); ad-hoc field-activity capture; multi-item purchase basket; stateful+linked LoopStepper | ★★★★ | Med–High |
| **5 — consistency rollouts** | centralize role-gating; LineItemsEditor everywhere; StoryLine/«لماذا» everywhere; dedicated wizard help; no-dead-ends audit; unify desktop/mobile nav | ★★★★ | Med |
| **6 — foundations** | offline-capable + PWA; onboarding persistence; WhatsApp field layer (gated) | ★★★ | High |

## 9. Success metrics (from SPEC-0025 §9, extended)
- «أحمد ماهر (accountant) records a real custody expense and pulls one report without asking anyone.»
- The owner sees **everything awaiting their decision in one place** («راجع») — zero cross-module hunting.
- **≤ 3 clicks** to any of the ~6 daily actions from anywhere; **≤ 2 taps** to execute in the field.
- **Storekeeper's phone works** end-to-end (no bounce, receive is offline-tolerant).
- **Finance sidebar ≤ ~7 grouped entries** (from 20 flat); **one** home, **one** reports hub, **one** ledger,
  **one** approvals queue — no duplicate report/insight/P&L surface remains.

## 10. What this spec is NOT
Not a redesign of the shipped task-first vision (it's right), not a backend rewrite (RLS/RPCs are sound and
audited), not AI (Stage-11 gated). It is the **consolidation-and-consistency pass** that makes the already-built
task-first, story-first, plain-Arabic app actually feel like one coherent, guided, no-dead-ends product.

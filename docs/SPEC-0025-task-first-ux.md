# SPEC-0025 — المهمة أولاً: task-first UX (سهولة الاستخدام)

*Status: **DRAFT for Owner review** — design only. Written 2026-07-04 from the Owner's direct feedback after
using the app: **"not user friendly… hard to navigate… need a guide to do any trx or to get a report…
each trx done in a different module… very hard to use."***

*Companions: SPEC-0017 (table/admin patterns), SPEC-0024 (COA/cost centers/reports — now live),
SPEC-0014 (page-help content — exists but buried), the OS design revamp (visual tokens — live). This spec is
the **information-architecture and flow layer**: the visual revamp made pages prettier; this makes them usable.*

---

## 0. The problem, diagnosed honestly

The Owner's complaint is correct and structural. The app was built **spec-per-module**, so navigation mirrors
the database, not the user's day:

- **Nav surface today:** 8 modules, 26+ pages, and reports live in ≥6 different places (لوحة المالية،
  تقارير التكلفة، تقارير الإيرادات، لوحة المخزون، لوحة التخطيط، المحاسبة…).
- **One real-world event spans 3–5 screens and 4 internal concepts.** "دفعت ٥٠٠٠ ج سماد من العهدة" =
  المصروفات (create) → تصنيف الحساب → مركز التكلفة → العهدة (حركة) → طلب صرف (سطر) → اعتماد. The user must
  already know what an "expense kind", "account", "cost center", "custody movement", and "payment request"
  are — and in which module each lives — to record one payment.
- **There is no place that answers "ماذا أفعل الآن؟"** The dashboard shows KPIs, not actions.
- Help exists (`lib/page-help.ts`, user manual) but is not surfaced in the flow where confusion happens.

**Root cause:** module-first IA. **Fix:** task-first IA. The backend needs *zero* change — every wizard below
calls the same gated RPCs that exist today. This is a frontend-only program.

## 1. Design principles (the contract every screen must pass)

1. **المستخدم يحكي ما حدث، والنظام يمسك الدفاتر.** The user states the real-world event in plain Arabic;
   the system does the bookkeeping (accounts, journals, routing) invisibly.
2. **Three entry intents, always visible:** **سجّل** (record something) · **اعرف** (get an answer/report) ·
   **راجع** (approve / follow up). Everything reachable within one tap of these.
3. **≤ 3 clicks to any of the 6 daily actions**, from anywhere.
4. **Never require internal vocabulary.** "Payment request", "journal", "kind" never appear in a wizard —
   only questions a farmer/accountant would ask each other.
5. **One ledger, one reports hub.** All money events in one filterable list; all reports in one place.
6. Non-negotiables intact: #1 honest nulls, #2 Arabic-RTL, #6 drawings split — the wizards *enforce* them
   with better wording, not less rigor.

## 2. Part A — «+ سجّل» the global action launcher

A single prominent button (header, every page; FAB on mobile `/m`) opening a launcher with the **6 daily
actions**, each a guided 2–3-step wizard that composes the existing RPCs:

| Action (as the user thinks of it) | What the wizard hides |
|---|---|
| **دفعت مصروفًا** — "اشتريت/دفعت…" | expense insert + kind + `fn_set_expense_kind` + account picker (suggested from category) + cost-center picker (suggested from sector) + payment routing: «من العهدة» → `fn_set_expense_payment_status(paid_from_custody)`; «آجل» → post_paid + offer "أضفه لطلب الصرف المفتوح؟" (`fn_add_expense_to_request`) |
| **سلّمت محصولًا / بعت** | `fn_save_sale` — **delivery-before-price is the default path**: qty + crop + buyer now, price later; ends with "سيذكّرك النظام بتحديد السعر" |
| **حدّدت سعر بيع** | `fn_finalize_sale_price` (picked from the pending-price list) |
| **حصّلت فلوسًا من عميل** | `fn_record_sale_collection` against the buyer's open receivables |
| **استلمت بضاعة** | `fn_post_receipt` (existing receive flow, re-skinned as a wizard step) |
| **استلمت عهدة من المالك** | `fn_record_custody_movement(استلام عهدة)` |

Wizard mechanics: one question per step, big touch targets, smart defaults (last-used custody account,
cost center derived from chosen sector, account suggested from category history), a plain-Arabic summary
before save ("سيُسجَّل: ٥٠٠٠ ج أسمدة على نخيل الحصوة، مدفوعة من عهدة مدير المزرعة — صحيح؟"), and a
**"التالي المقترح"** chip after save (e.g. after an آجل expense → "أضِفه لطلب صرف").

### 2b. Owner follow-up (2026-07-04): wizards by money direction + multi-LINE entry everywhere

The Owner refined the ask after using the first wizard:

1. **Money wizards, organized by direction** — the launcher groups money actions the way the accountant thinks:
   - **نقدية داخلة** (cash in): استلام عهدة من المالك · تحصيل من عميل.
   - **آجل / على الحساب** (on debt): مصروف أو مشتريات لم تُدفع بعد → post_paid + طلب صرف لاحقًا.
   - **نقدية خارجة** (cash out): مصروف مدفوع من العهدة (the live U-1 wizard already does this + آجل).
2. **Multi-LINE entry in EVERY wizard.** One session, many rows: the user adds as many lines as he wants,
   each line individually guided. A shared **`LineItemsEditor`** component (add row / remove row / per-row
   fields + validation + a running summary) is the pattern for all of them.
3. **U-7 — the plan wizard (الخطة الأسبوعية/الشهرية).** The farm manager creates or edits a plan for the
   WHOLE farm or selected parts only (قطاع/حوش): pick the scope + period, then add **lines** — each line is
   an operation (تسميد، ري، رش، تقليم، حصاد…) with its details in the row's cells (target hawsha/lines,
   dates/recurrence, materials + quantities, labor). Add/edit/remove lines freely, save once. Backed
   entirely by the LIVE atomic RPCs (`fn_create_plan` + `fn_add_plan_operation_multi` — which already
   accepts materials + labour + assignees + multi-day in one call); the wizard is pure UI.
4. **U-8 — the operation-execution wizard (نفّذت عملية).** Guided recording of executed work →
   `fn_execute_operation`, with the same line pattern for multi-hawsha days.
5. **"Do that for all inputs":** every data-entry surface migrates to the guided multi-line pattern over
   time — the wizards above first (highest frequency), then receipts, attendance/labor, offshoots, جرد.

## 3. Part B — «المعاملات» one unified ledger

One page listing **every money event** (expenses, sales, collections, custody movements, request payouts,
receipts) as one filterable/sortable/exportable table (the S-8a primitives): type chips
(مصروف/بيع/تحصيل/عهدة/استلام), date range, cost center, account, person. Row → the existing detail page.
KPI cards on top act as filters (existing `DashboardKpiLink` pattern). **This kills the hunt** — "أين
أجد العملية؟" has one answer.

## 4. Part C — «التقارير» one hub

One `/reports` page where **every report in the system is a card**: ميزان المراجعة، مصروفات حسب
الحساب/المركز، الإيرادات حسب المحصول/المشتري، الذمم، العهدة، تغطية المخزون، لكل فدان، بنك الفسائل، ربحية
المركز… Grouped by question ("أين تذهب الفلوس؟" / "من أين تأتي؟" / "ماذا أملك؟"), searchable, each opening
the existing report page. Module dashboards stay, but the hub is the canonical answer to "أريد تقرير".

## 5. Part D — Navigation restructure (the big visible change)

Collapse the 8-module sidebar into **5 task-oriented items**:

1. **الرئيسية** — actions ("ماذا تريد أن تفعل؟") + alerts + the role's 4 KPIs.
2. **سجّل +** — the launcher (Part A).
3. **المعاملات** — the ledger (Part B).
4. **التقارير** — the hub (Part C).
5. **الإدارة** — everything administrative, grouped: المزرعة (structure/croquis/فسائل/آفات)، التخطيط،
   المخزون والموردون، المالية (حسابات/مراكز/موازنات/عهدة/طلبات)، الفريق، الأكاديمية، الإعدادات.

Role-aware: the FM's الرئيسية leads with field actions and no absolute money (decision 8 posture); the
accountant's leads with the money actions. Deep links/bookmarks keep working (routes don't move — only nav).

## 6. Part E — the guidance layer

- **First-run tour** (3 steps, per role, dismissible): سجّل → المعاملات → التقارير.
- **? drawer on every page** rendering the existing `PAGE_HELP` entry (already written for 26 pages,
  currently unreachable) — what/why/how/common-mistakes.
- Every empty state links to its wizard ("لا مصروفات بعد — سجّل أول مصروف").

## 7. Slices (frontend-only; each independently shippable)

| # | Slice | Contents | Risk |
|---|---|---|---|
| U-1 | **Launcher + expense wizard** | Part A shell + the دفعت-مصروفًا flow (the #1 pain) | Low (composes live RPCs) |
| U-2 | Sale/collection/custody wizards | rest of Part A | Low |
| U-3 | «المعاملات» ledger | Part B | Low (read-only) |
| U-4 | «التقارير» hub | Part C | Low (read-only) |
| U-5 | Nav restructure + role homes | Part D (behind a small feedback window with the real users) | Med (habit change) |
| U-6 | Tour + help drawer + empty-state links | Part E (drawer already live via SPEC-0014 A2) | Low |
| U-7 | **Plan wizard (multi-line)** | §2b.3 — scope picker + operation lines over fn_create_plan/fn_add_plan_operation_multi | Med |
| U-8 | Operation-execution wizard | §2b.4 — guided fn_execute_operation | Low |
| U-9 | LineItemsEditor rollout | §2b.2/§2b.5 — multi-line entry in every wizard, then all inputs | Med |

**Success metric (the honest one):** أحمد ماهر records a real custody expense and pulls one report
**without asking anyone anything**. Repeat with م. عبدالجليل for a field flow. That test passing = done.

## 8. Owner decisions

1. Approve the 5-item nav (Part D) — or keep modules visible and add the 3 task items on top?
2. Wizard defaults: is «من العهدة» the default payment answer for the FM's expenses?
3. Module dashboards: keep as-is under الإدارة, or fold their cards into الرئيسية/التقارير over time?
4. Pilot: run U-1..U-4 with the accountant + FM for a week before U-5 (the nav change)?

*Docs only — stopped at the gate. No code in this PR.*

# SPEC-0026 — دورة العمليات كاملة: plan → approve → execute → track (task-first)

*Status: **DRAFT for Owner review** — design only. Written 2026-07-04 from the Owner's directive:
"the operation plan wizard and its process — write the full plan for all the operation module revamping;
totally user-friendly: easy to **record and edit** the plan, to **review** it, and for **employees to use
and record their operations according to the plan**."*

*Companions: SPEC-0011 (plan builder — live), SPEC-0019 (op templates — live), SPEC-0021 (season engine —
design), SPEC-0025 §2b (U-7 plan wizard — live) + §2c (story-first). This spec is the LIFECYCLE layer: it
composes the live machinery into five plain-Arabic stages with zero backend change unless marked.*

---

## 0. What already exists (verified on `main` — compose, don't rebuild)

| Capability | Live machinery |
|---|---|
| Create plan (weekly/monthly/quarterly/annual; scope farm/قطاع/حوش) | `fn_create_plan` + U-7 wizard `/record/plan` |
| Add operation lines atomically (materials + labor + assignees + multi-day) | `fn_add_plan_operation_multi` (+ `addPlanOperation`, dependencies, `unassignPlanOperationAssignee`) |
| Reusable operation templates | `instantiateOperationTemplate` (SPEC-0019) |
| Readiness checks (stock coverage vs plan demand → ok/block) | `runPlanChecks` + `plan_checks` |
| Agronomist sign-off gate on spray/dose ops (#4) | `signOffPlanOperation` + `plan_op_signoff_guard` trigger |
| Plan lifecycle status | `setPlanStatus` (draft → active → done) |
| Field execution (qty + labor; posts stock demand) | `/m` + `/m/execute/[opId]` → `fn_execute_operation`, **offline outbox** (F1) |
| Attendance / labor logs | `/people/attendance`, `labor_logs` |
| Planned-vs-actual report | `/reports/[planId]/pva` |
| Irrigation basis, harvest stage, preferred time-of-day | columns + guards on `plan_operations` |

**The gap is not machinery — it is the JOURNEY.** Each capability lives on a different screen with expert
vocabulary. This spec turns them into five stages a farmer can walk.

## 1. The five stages (the whole module reorganizes around these)

> **خطّط ← تحقّق ← اعتمد ← نفّذ ← تابع**
> Plan it → the system checks it → the right people approve it → the crew executes it → everyone tracks it.

### Stage 1 — خطّط: build & edit the plan (farm manager)
**The plan workbench** (`/plans/[planId]` redesigned; U-7's wizard remains the create door):
- The plan is a **table of operation LINES** (the shared `LineItemsEditor` interaction): each line =
  العملية (تسميد/ري/رش/…) · النطاق (حوش/قطاع) · من–إلى · المواد (صنف+كمية، عدة أسطر) · العمالة (نوع+عدد+أيام)
  · المسؤول والمكلَّفون. **Add/edit/duplicate/remove lines freely** — exactly the Owner's "lines" model.
- **انسخ الأسبوع الماضي**: one tap clones last period's plan into a new draft (dates shifted) — the single
  biggest time-saver for a repeating farm week. *(new server action composing existing RPCs — no schema)*
- **القوالب**: the SPEC-0019 template gallery inline («برنامج رش دوري»…) — instantiate then adjust.
- **Per-line readiness chips**, live as he types: 🟢 مواد متوفرة · 🔴 نقص ٢٠ شيكارة (from `fn_stock_coverage`)
  · 🖊 يحتاج اعتماد المهندس (spray/dose) · 👤 غير مُسنَد. No surprises later.
- Plain Arabic everywhere; a line never asks for anything the DB doesn't need.

### Stage 2 — تحقّق: the system reviews first (automatic)
On save/edit, `runPlanChecks` renders as a **story header** on the plan (§2c contract):
> «الخطة جاهزة **٨٠٪** — ينقصها ٢٠ شيكارة سلفات (يكفي ٣ من ٥ أيام)، ورشّتان تنتظران اعتماد المهندس.»
- Each problem is **one tap to its fix**: نقص مواد → «أنشئ طلب شراء» (pre-filled from the shortfall) ·
  اعتماد → «أرسل للمهندس» · غير مُسنَد → assignee picker.
- The plan cannot go **active** while a `block` check stands (already enforced — now it's *explained*).

### Stage 3 — اعتمد: review by the right people
- **المهندس الزراعي**: a new **«اعتمادات مطلوبة»** queue page — every spray/dose line awaiting
  `signOffPlanOperation` across all plans, with the dose details in the row, one-tap اعتمد/أرجِع بملاحظة.
  (The gate exists; the QUEUE is the new UX — today he must hunt plan by plan.)
- **المالك/المدير**: activating the plan becomes a 1-step **approval summary** — the story sentence + the
  line table + cost-if-priced (owner only; FM sees quantities per decision 8) → «اعتمد الخطة وفعّلها»
  (`setPlanStatus('active')`). A plan edit after activation shows a "changed since approval" chip.

### Stage 4 — نفّذ: the crew's day (supervisor/worker, phone-first)
- **«يومي»** — `/m` becomes the day view: **today's assigned operations as cards**, each answering the
  four field questions: *ماذا؟ أين؟ بماذا؟ مع من؟* (op + target حوش + materials to draw + crew), ordered by
  preferred_time_of_day. Overdue-yesterday items pinned on top.
- Big **«سجّلت التنفيذ»** on each card → the **execution wizard** (guided `fn_execute_operation`): الكمية
  المستخدمة فعلًا (defaults to planned; editable — honest actuals #1) → العمال الحاضرون (defaults to
  assignees; ties into labor logs) → ملاحظة/مشكلة اختيارية → summary sentence → حفظ. **Offline-safe**
  (the F1 outbox already covers this path).
- Partial done is honest: «نفّذت حوشين من ثلاثة» → the line stays open with progress, never fake-done.
- A worker can flag **«لم أستطع التنفيذ»** with a reason (weather/no materials/no crew) — the reason lands
  in the plan's attention list, not in a void.

### Stage 5 — تابع: everyone sees the same truth
- **Plan 360 story header**: «أسبوع ٢٧: نُفّذ **١٢ من ١٨** عملية (٦٧٪) — متأخر: رش الحصوة (يومان)…» +
  the progress bar per line + the PvA report link (exists) for planned-vs-actual quantities.
- **Dashboards**: the FM attention inbox (live) gains «عمليات متأخرة عن الخطة» and «أسباب تعثّر أمس»;
  the Owner sees the same plus cost-to-date when priced.
- **History**: finished plans are readable stories («خطة أسبوع ٢٦ — اكتملت ٩٤٪، تأخر الري مرتين بسبب…»).

## 2. Design rules (inherited contracts, applied here)
1. Plain Arabic; the words on screen are the words said in the field (تسميد، رشة، حوش) — never "subtype".
2. **Lines everywhere** (LineItemsEditor): add as many as needed, each row guided, running summary.
3. ≤ 3 taps from anywhere: خطّط (launcher) · يومي (/m tab) · اعتمادات (engineer's inbox).
4. Story-first: every plan/day/report opens with the sentence, then the table.
5. Honest data (#1): actuals default to planned but are edited to truth; partial ≠ done; a skipped op
   carries its reason. Agronomy sign-off gate (#4) untouched and surfaced, never bypassed.
6. No dead ends: every problem chip links to its fixing action.

## 3. Slices (frontend-composition unless marked; each independently shippable)

| # | Slice | Contents | Depends / risk |
|---|---|---|---|
| P-1 | **Plan workbench** | `/plans/[planId]` rebuilt on LineItemsEditor: inline edit/add/duplicate/remove lines, readiness chips per line, story header (Stage 1+2 render) | Low — composes live RPCs + fn_stock_coverage |
| P-2 | **انسخ الأسبوع الماضي** | clone-plan server action (create plan + re-add lines with shifted dates) + wizard/workbench buttons | Low — new action, existing RPCs only |
| P-3 | **Fix-it chips** | shortfall → pre-filled purchase request; unassigned → picker; sign-off → send-to-engineer | Low-med |
| P-4 | **«اعتمادات مطلوبة» engineer queue** | cross-plan sign-off inbox + one-tap approve/return-with-note | Low — reads plan_operations awaiting sign-off |
| P-5 | **Approval summary** | activate-plan 1-step review (story + lines + owner-only costs) + changed-since-approval chip | Low |
| P-6 | **«يومي» day view + execution wizard** | /m day cards (ماذا/أين/بماذا/مع من) + guided fn_execute_operation with honest actuals + «لم أستطع» reason | Med — the crew-facing heart; offline path reused |
| P-8 | **Calendar view (Owner follow-up)** | RTL week-grid (السبت-first) of the plan period; each op a colored chip on every day it spans (done/planned/due tones, «اليوم» highlight, +N overflow); reusable `OpsCalendar` → also the plans dashboard month view + an /m week strip | Low — pure render |
| P-7 | **Track & history** | plan 360 progress story, dashboard attention items (late ops, blocked reasons), finished-plan story | Low |

**Backend deltas (owner-gated, tiny):** P-6's «لم أستطع التنفيذ» reason needs a nullable
`plan_operations.blocked_reason text` + a gated setter (one migration); everything else is zero-schema.

## 4. Owner decisions
1. **Approval strictness:** may the crew execute lines while the plan is still `draft`, or only `active`
   (recommended: active-only — approval means something)?
2. **Who approves activation:** owner only, or farm manager too (recommended: FM activates; owner sees)?
3. **Cost visibility on the approval summary:** owner-only (decision 8 posture — recommended) or FM too?
4. **Copy-last-week default scope:** whole plan (recommended) or ops-without-assignees?
5. Pilot P-1/P-6 with م. عبدالجليل + one supervisor for a real week before P-3/P-5 polish?

## 5. Success metric (the honest test)
- م. عبدالجليل builds **and edits** a real week's plan for one حوش in **≤ 5 minutes**, zero help.
- A supervisor opens «يومي» on his phone and records a real execution in **≤ 60 seconds**, zero help.
- The Owner reads the plan's story header and can say what's late and why **without asking anyone**.

*Docs only — stopped at the gate. Build order recommendation: P-1 → P-6 (the two halves of the daily loop),
then P-2/P-4, then the rest.*

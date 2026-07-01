# SPEC-0019 — Operations maturity (from generic task engine → date‑palm operating system)

*Status: **DRAFT for Owner review** — design only; no schema applied, no prod mutation, no code shipped with
this doc. Grounded in a full read‑only review of `origin/main` (2026‑07‑01): the operations code + data model,
best‑in‑class field‑ops software (Agrivi / Croptracker / Conservis / Agworld / Fieldwire / xarvio), and the real
Egyptian date‑palm operational calendar (FAO Y4360E, Egyptian APC, Gulf extension practice).*

*This spec **sequences and builds on** the existing operations specs rather than restating them:*
- *[`SPEC-0011`](SPEC-0011-planning-workspace.md) — plan create / status / assign / labor primitives (`fn_create_plan`, `fn_set_plan_status`, `fn_assign_plan_operation`, `fn_add_plan_labor`).*
- *[`SPEC-0010`](SPEC-0010-activity-event-recording.md) — ad‑hoc event recording (`fn_record_event`, `fn_set_event_status`, `fn_add_event_followup`).*
- *[`SPEC-0001`](SPEC-0001-stock-coverage-engine.md) — the stock‑coverage engine (operations are its demand source; the "never mask a shortage" rule is binding on every change here).*
- *[`SPEC-0016`](SPEC-0016-export-compliance-and-certification.md) — export/GACC/CAPQ/residue (the spray‑record → PHI → export‑eligibility chain lands here).*
- *[`SPEC-0006`](SPEC-0006-people-labor-payroll.md) — labor/payroll (operation costing consumes it; real PII stays behind the Stage‑M privacy review).*
- *[`SPEC-0008`](SPEC-0008-care-academy.md) — pesticide safety / PHI knowledge; non‑negotiable #4 (agronomy = template, needs a named agronomist + APC sign‑off).*
- *Companion to [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stages 3/4, [`CLAUDE.md`](CLAUDE.md) non‑negotiables #2/#4/#6.*

---

## 1. Thesis — the machine is bigger than the product running on it

Farm OS already has a **quietly excellent operations engine**: atomic `SECURITY DEFINER` RPCs, an idempotent
claim‑first execute (`fn_execute_operation`), a 9‑state operation status vocabulary already CHECK‑constrained,
multi‑material / multi‑day / multi‑assignee authoring (`fn_add_plan_operation_multi`), and a live demand→coverage
engine that reads operations directly. **The problem is not the engine — it is that the operations *product* runs
on ~15% of it, and the model it exposes is a *generic task*, not a *date‑palm operation*.**

Three structural findings from the review (ground truth, with citations):

1. **The state machine is dormant.** `plan_operations.status` is CHECK‑constrained to 9 values
   (`planned, approved, reserved, ready, in_progress, done, blocked, abandoned, skipped` —
   `20260622000058_plan_op_status_check.sql`), but **only `planned → done` is reachable** through the app.
   There is no approve / schedule / start / verify / cancel / skip action. `fn_set_plan_status` exists
   (SPEC‑0011) but **has no UI** — plans are stuck in `draft` (which the engine already counts as demand).
2. **The vocabulary is generic.** `subtype` is free text with **5 labels** (تسميد/ري/رش/تلقيح/تفتيش —
   `lib/labels.ts:39`). The real farm runs **~15 operations** — تلقيح، خف، تحدير، تكييس، تكريب، حصاد (by stage
   خلال/رطب/تمر)، فحص مصائد السوسة — none of which the system names. Fertilization‑specific logic is hardcoded
   (`lib/budget-check.ts`, `budget/[planId]/check/page.tsx:47`), so other ops aren't even budget‑checked.
3. **The field loop is thin, and one path is incorrect.** `/m` is a flat list (no today/overdue/mine, despite
   `assignee_ids` being stored). Execute captures only `qty + labor + note` — no photo/GPS. "Offline‑tolerant"
   is claimed (`ExecuteForm.tsx`, `MasterTable.tsx`) but there is **no service worker / outbox**. And a real
   correctness defect: **`fn_execute_operation` consumes only the first material** of a multi‑material op
   (`order by item_id limit 1`, `20260701190000_execute_no_blind_release.sql:60`) — a 3‑input op issues stock
   for one item and under‑records the other two.

**The move:** evolve `plan_operations` **in place** into a proper **Work Order** (it is already one in all but
name), light up the dormant state machine, and load it with the **real date‑palm operation vocabulary + records**.
Extend, do not rewrite.

## 2. What already exists (do not rebuild)

| Layer | Built | Where |
|---|---|---|
| Plan spine | `plans`, `plan_operations`, `plan_material_requirements`, `plan_labor_requirements`, `plan_checks` | `…0006_plans.sql` |
| Event spine (actuals) | `farm_event` (partitioned) + `event_locations` + `quantities` + `event_status_history` + `event_followups` + `event_attachments` | `…0004_events_quantities.sql` |
| Authoring | `fn_add_plan_operation` (0038) / `fn_add_plan_operation_multi` (0091/0093) — atomic, deduped, unit‑reconciled | `…0093`, `…170000` |
| Plan lifecycle RPCs | `fn_create_plan`, `fn_set_plan_status`, `fn_assign_plan_operation`, `fn_add_plan_labor` (SPEC‑0011) | `…0084_plan_builder.sql` |
| Multi‑day + assignees | `plan_operations.ends_on`; `plan_operation_assignees` (`assignee_ids` + `is_lead`) | `…0090` |
| Execute | `fn_execute_operation` — idempotent claim‑first, issues stock, writes `done` event + actuals, computes cost | `…190000` |
| Checks | `runPlanChecks` — stock (engine per material) + budget (أسمدة line) + weather/labor/responsibility (**stubbed**) | `plans/[planId]/actions.ts` |
| Reports | `/reports/[planId]/pva` (planned‑vs‑actual), `/plans/dashboard`, `/budget/[planId]/check` | — |
| Status/labels | 9‑value CHECK; `OP_STATUS_AR`, `SUBTYPE_AR`, `isExecutableOpStatus` | `…0058`, `lib/labels.ts` |

**Engine coupling (binding constraint):** `fn_stock_coverage` builds demand **directly** from
`plan_operations ⋈ plan_material_requirements` for live ops (`status in (planned,approved,reserved,ready,in_progress)`)
in plans `in (draft,active,approved)`, bucketed weekly. A BEFORE‑trigger (`…170000`) forces every requirement's
unit to equal the item's canonical unit so the unit‑blind `sum(qty)` can't mask a shortage. **Every change in this
spec that touches demand must err toward more demand / less available — never the reverse** (SPEC‑0001 cardinal sin).

## 3. Target model

### 3.1 Operation as a Work Order
Keep `plan_operations` as the object; give **every quantity a `planned_*` / `actual_*` twin**, a typed
`operation_type`, and the full lifecycle. Inputs stored as **rate‑per‑area line items** (product + rate + area →
derived total) so demand, variance, and dose calculation all fall out of one model.

### 3.2 Controlled operation vocabulary (net‑new)
Replace the 5 free‑text subtypes with an `operation_types` reference table (Arabic + English + engine hints).
Ship the real date‑palm set:

| type | Arabic | notes |
|---|---|---|
| pruning_dethorning | التقليم / التكريب | Dec–Feb; protect every wound (RPW) |
| offshoot_mgmt | إدارة الفسائل | Feb–Mar / Sep–Oct |
| pollen_collection | جمع اللقاح | Feb–Mar |
| **pollination** | **التلقيح** | late Feb–Apr; **2–3 passes**, temp ≥18°C, redo if rain <48h; **peak labor** |
| bunch_limiting | تحديد العراجين | ~8–10 fronds/bunch |
| **thinning** | **الخف** | Apr–May (Kimri); 50–60% strand removal |
| bunch_tilting | التحدير / التقويس | May |
| **bagging** | **التكييس / التغطية** | Jun–Jul (before Rutab) |
| irrigation | الري | seasonal curve; deficit‑aware |
| fertilization | التسميد | split Mar/May/Aug + organic winter |
| **pest_scouting** | **فحص المصائد / المراقبة** | RPW traps, weekly |
| pesticide_application | المكافحة | APC‑registered only; REI/PHI |
| **harvest** | **الحصاد** | **stage sub‑field**: خلال (Aug–Sep) / رطب (Sep–Oct) / تمر (Oct–Nov) |
| post_harvest | ما بعد الحصاد | grading, cold storage |
| inspection / note | تفتيش / ملاحظة | ad‑hoc (via SPEC‑0010 `fn_record_event`) |

`subtype` stays free text for backward‑compat; `operation_type` is the new controlled FK. Fertilization‑specific
budget logic generalizes to "any op with known cost."

### 3.3 Lifecycle (converged industry state machine)
```
draft ─►[recommended: agronomist]─► approved ─► scheduled ─► assigned
   ─► in_progress ─► done ─► verified (supervisor sign‑off) ─► closed
   cancel / skip / hold = branches; reassign allowed up to in_progress
on `done`: deplete stock by ACTUAL qty · start REI/PHI clocks · post labor+material cost · attach GPS+photo
```
The CHECK vocab already covers planned/approved/reserved/ready/in_progress/done/blocked/abandoned/skipped and
`fn_execute_operation` tolerates every live status. Net‑new: a **`verified`** state + `verified_by`/`verified_at`,
and transition RPCs (mirroring `fn_set_plan_status`). The `recommended`/`approved` gate is **skippable for routine
ops but mandatory for crop‑protection sprays** (compliance, §3.5).

### 3.4 Field execution (`/m`) — the most‑used surface
Task feed keyed to `assignee_ids` + date: **اليوم / متأخر / قادم**, overdue in danger tone, **"مهامي فقط"** toggle,
one‑tap status advance (Fieldwire pattern). Execute form captures per‑material actuals + man‑days + **GPS + photo**,
≥44px targets, offline‑aware banner. Reuse the design‑system **Toast + ConfirmDialog** (currently unused app‑wide).

### 3.5 Spray & compliance record (the export unlock — with SPEC‑0016)
A compliance‑first form on `pesticide_application`: product resolving to an **APC‑registered** entry
(`apc.gov.eg` is Egypt's sole authority), rate×area, target pest, applicator, wind/temp at application, and
**computed + enforced REI/PHI** that flags/blocks a harvest event inside the interval. One‑click GlobalGAP
spray‑diary export. This ties `pesticide_application → PHI → harvest eligibility → SPEC‑0016 export readiness`.
Requires extending `plan_checks.kind` (a fixed 5‑value CHECK today) and adding a `spray`/`agronomy` check kind.

### 3.6 Agronomist sign‑off (non‑negotiable #4)
Dose‑bearing ops (fertilization/spraying) render as **"قالب — يحتاج اعتماد مهندس زراعي"** until a **named
agronomist** signs, showing the pesticide‑registration reference. This is the `recommended → approved` gate and
doubles as the GlobalGAP justification artifact. **Requires the Owner to name the agronomist/role.**

## 4. Phased roadmap (each phase = gated tasks / independent PRs; migrate‑first, then merge)

### P0 — Correctness & cheap wins
- **P0‑1 Fix multi‑material execute** — loop `plan_material_requirements` (drop `limit 1`); per‑material
  `data.actual_qty`. **Engine‑adjacent consumption path → independent review + pgTAP oracle required** (SPEC‑0001).
- **P0‑2 `/m` task feed** — today/overdue/upcoming grouping + "مهامي فقط" (uses existing `assignee_ids`) + one‑tap
  advance + `/m/loading.tsx` + ≥44px targets. Pure frontend.
- **P0‑3 Operation vocabulary** — `operation_types` table + seed the ~15 types; harvest **stage** sub‑field;
  generalize budget‑check beyond `fertilization`.
- **P0‑4 Surface assignees** on op row + PvA; add an **un‑assign** RPC (`plan_operation_assignees` has no DELETE
  grant today).
- **P0‑5 Honesty fix** — soften the "offline‑tolerant" copy until P2 ships the real queue.

### P1 — The operational spine
- **P1‑1 Light up the state machine** — transition RPCs (approve/schedule/start/**verify**/cancel/skip/hold) +
  `verified_by/at`; plan‑lifecycle UI (activate/close — `fn_set_plan_status` exists, no button calls it).
- **P1‑2 Labor → people & cost** — FK `plan_labor_requirements`→`people` (or fold into assignees); man‑days on
  execute; **cost/operation = labor + materials(actual×unit) + machinery**; revives `lib/payroll.ts` (SPEC‑0006).
- **P1‑3 Operation templates ("جداول العمليات")** — fertigation split (Mar/May/Aug), pollination round (2–3 passes),
  RPW 6‑month preventive drench, harvest picking; instantiate dated ops across a block in one action.
  *(Watch the `(plan_id, subtype, planned_at)` dedup — recurrence must vary the date.)*

### P2 — Field‑grade & compliance
- **P2‑1 Offline‑first PWA** — IndexedDB outbox + Service Worker background sync + version‑column LWW; real PWA
  icons; GPS+photo on `done`. Execute is already idempotent (`23505` on replay) → safe to retry.
- **P2‑2 Compliance‑first spray record** — §3.5; APC list, REI/PHI enforce, spray‑diary export → SPEC‑0016.
- **P2‑3 Agronomist sign‑off gate** — §3.6.

### P3 — Differentiation (the date‑palm moat)
- **P3‑1 Phenology/season engine** — stage per block (Kimri→Khalal→Rutab→Tamar, Egyptian NH calendar) →
  next‑operation suggestions + template pre‑load.
- **P3‑2 RPW scouting module** — trap register (~1/ha detection; catches peak Mar–Apr), weekly catch counts,
  90‑day lure‑change reminders, infestation → treatment → quarantine/removal workflow.
- **P3‑3 Operational KPIs** — yield/palm, fronds‑per‑bunch (~8–10:1), fruit‑set %, alternate‑bearing index,
  RPW infestation rate, cost/palm — on the plans dashboard and per block.

## 5. Owner decisions required before build (per the gated method)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Palm‑level vs block/hawsha‑level operations now? | **Block/hawsha now; palm‑level after the real registry import (#239).** Synthetic palms ≠ real registry (non‑neg #5). |
| D2 | Is EU/China export near‑term? | If **yes**, P2 compliance jumps ahead of P1‑2/P1‑3 (SPEC‑0016 already has the cert schema live). |
| D3 | Who is the **named agronomist** for dose sign‑off (non‑neg #4)? | Owner must name a person/role; the gate can't ship without it. |
| D4 | Build offline now, or soften the claim first? | **Soften copy now (P0‑5); build the outbox in P2.** |
| D5 | Extend `plan_operations`, or introduce a `work_orders` concept? | **Extend in place** — it is already a work order; a rename is churn/risk. |

## 6. Risks & guardrails
- **Engine (cardinal sin):** P0‑1, templates, and any demand‑touching change must err toward more demand /
  less available; independent review + the pgTAP oracle before merge (SPEC‑0001).
- **`authorize()` re‑emit footgun:** new perms (e.g. `op.verify`, `spray.write`) must re‑emit `authorize()` from
  the **current** definition carrying the full union; `tests/22` + `tests/97` guard it.
- **RLS/RPC discipline:** every new write path gates `authorize(perm, org_id)` **inside** the DB; new tables get
  `enable`+`force` RLS deny‑by‑default (`tests/29` invariant).
- **Migrate‑first, then merge:** `main` auto‑deploys via Vercel — apply schema before merging code (Owner‑only).
- **PII:** labor/agronomist real data stays behind the Stage‑M privacy review (SPEC‑0006).
- **Compliance ≠ auto‑certify:** REI/PHI/export‑eligibility are computed decision‑support; final sign‑off is human
  (mirrors the #4 agronomy and SPEC‑0016 posture).

## 7. Validation (per change)
`npx tsc --noEmit` · `npx eslint <touched>` · `npm run build` · `npx vitest run` ·
`bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh` (authoritative DB gate; add oracle tests for P0‑1 and
any engine‑touching change) · independent review for engine/security‑touching PRs.

## 8. Ground-truth refinements from real farm reports (2026‑07‑02)

The Owner shared two real monthly operational reports from the farm (personnel names withheld here per
`docs/CLAUDE.md`'s hard stop on staff PII — only the *operational pattern* is used). One is a forward‑looking
program from the farm's consulting agronomist, organized by **palm age‑cohort** (large producing / young‑training
/ new plantings); the other is the farm's monthly execution report, organized by **physical block** (real plot
names, e.g. a 22‑feddan block, several named حياض/حوض blocks, and a newer‑plantings block), recording actual
irrigation cadence, the fertigation doses applied, and per‑operation date ranges. This is a real, independent
confirmation of the agronomist‑recommendation → farm‑work‑order pattern in §3.6/§3.3, and it surfaces concrete
refinements this spec should carry:

- **Irrigation is not calendar‑fixed.** One cohort's program reads "N irrigations over the rest of the month,
  based on a soil‑moisture test" — frequency is a soil‑test‑driven decision, not a static schedule. Observed
  cadences also vary hugely by block/age (e.g. 3×/week at 2h vs. 2×/week at 1h vs. every 6 days at 2h). §3 should
  add a **soil‑test‑driven irrigation planning mode** alongside the fixed‑calendar mode, not replace it.
- **Fertigation is a numbered cycle, not a flat repeat list.** Both reports list 6–8 sequential, distinct
  multi‑chemical doses (a monthly micronutrient dose called out separately from the main NPK rotation). The
  **operation templates** feature (already built this session, §4 P1‑3) should track a dose's **position in the
  cycle**, not just repeat identical lines — refine the template's `recurrence` shape to carry per‑occurrence
  distinct line items (it already technically supports this; make it the *documented, intended* usage, and seed
  a realistic 6–8‑step fertigation template using this pattern rather than a uniform repeat).
- **Spray timing is relative and time‑of‑day‑sensitive, not just dated.** Real instructions read "spray only at
  day's end once the heat breaks" (to avoid fruit deformity) and "cover the bunches before 6/25" — a deadline
  tied to a *different* operation (bagging) completing after a spray. §3.5's spray‑compliance record should add
  a **time‑of‑day** field (not just a date) and §3.3's lifecycle should support an operation's `planned_at` being
  expressed **relative to another operation** (e.g. "N days after op X"), not only an absolute date.
- **Spray/drench records need a target‑zone field.** Real instructions specify the exact plant part treated —
  "drench the bunch‑stalks and palm crown," "spray the bunches only" — not just "the palm." Add a `target_zone`
  enum (bunch / crown / trunk / offshoot / whole‑palm) to the spray‑compliance record in §3.5.
- **Individual "weak palm" rescue treatments already happen in practice**, alongside block‑wide bulk fertigation
  — a root‑stimulant drench targeted at specific ailing palms, separate from the cohort program. This is real
  evidence for **decision D1**: block/hawsha‑level operations are right for the bulk case, but a lightweight
  **individual‑palm exception/rescue operation** is worth supporting sooner than the full per‑palm registry
  rollout, since it's already how the farm actually works.
- **Offshoot care has a concrete, real recurring cadence** — a root‑stimulant drench "every 21 to 30 days,"
  dosed per‑offshoot (3–5 L of solution around the offshoot body). This is a ready‑made third seed template
  (alongside the fertigation‑split and pollination‑round templates already seeded in PR #552).
- **This is a mixed orchard, not pure date‑palm** — the execution report explicitly includes mango‑tree pruning.
  Flagged for the Owner's awareness rather than decided here: the current operation vocabulary (§3.2, PR #543)
  is date‑palm‑specific; whether to add a light non‑palm‑crop escape hatch (or treat it as out of scope) is a
  product call, not an engineering one.

None of the real block/plot names or chemical‑dose specifics above have been seeded into the app's synthetic dev
data — that would be a real‑data‑import decision for the Owner to make deliberately, distinct from (though
related to) the Stage‑M PII review that gates staff-personnel data specifically.

---
*Sources behind this spec (external research, 2026‑07‑01): FAO Date‑Palm guide Y4360E (technical calendar /
pollination / irrigation / propagation), FAO RPW management guidelines, Egyptian APC (apc.gov.eg), Egyptian NPK/
organic trials (Siwa, Medjool), Gulf/Kuwait irrigation (ISHS); field‑ops software — Agrivi work orders, Croptracker
spray records + MRL chain‑of‑custody, Conservis complete‑to‑deplete, Agworld plan→rec→WO + offline, Fieldwire task
status/verify, xarvio spray‑timer/phenology; EPA WPS + AMS + GlobalGAP PSA for the spray field set; offline‑first
architecture (IndexedDB outbox + Background Sync + version‑column LWW). Full citation list in the session review doc.*

# SPEC-0021 — Season-Cycle Engine (محرك الموسم)

*Status: DRAFT — Owner review required. Created 2026-07-02 from the 360° review + market research. Build gate: Stage M (real data) must land first; this spec exists so Season-1 build starts designed, not improvised.*

## 1. Problem

Farm OS today is **record-keeping + coverage math**: it answers "what happened" and "will materials run out against the plan I typed in." It does not answer the question the farm actually lives by: **"what should the farm be doing this week, and are we ready for it?"** The date-palm year is a fixed, knowable cycle; today every season's plan is re-authored by hand, and the coverage engine only sees demand after someone types it.

## 2. The idea

Make the **date-palm phenological calendar a first-class product spine** that drives planning, coverage, and labor forward:

```
تقليم/توريق → تلقيح (التلقيح) → خف/تدلية (bunch thinning/tie-down) → تكميم (bagging)
→ مراحل الحصاد (كمري → خلال → رطب → تمر) → ما بعد الحصاد / السباخ / الري الشتوي
```

- Each **season stage** carries: a window (org-editable dates, defaulted from last season's actuals per sector/hawsha + cultivar), the operation templates it instantiates, expected labor (man-days/palm from history), and expected materials (qty/palm).
- On stage approach (configurable lead, e.g. 21 days), the engine **proposes** a plan per hawsha (never auto-commits — Owner/manager approves), so material demand hits `fn_stock_coverage` **weeks earlier** than hand-authoring ("you will run out of pollen bags in 3 weeks").
- The owner dashboard gets a **"this week in the season"** panel: current stage per sector, readiness (materials ✓/✗ via coverage, labor ✓/✗ via people module, budget ✓/✗ via #157 gate), and gaps.

**Why this is the moat:** competitors do records (Mazoon Soft) or imagery/carbon (Zr3i, Platfarm). Nobody drives forward operations from the palm calendar with run-out forecasting. This turns "a database" into "an operating system."

## 3. Composition, not new infrastructure

Every primitive already exists — this spec is mostly configuration + one proposal RPC + UI:

| Need | Existing primitive |
|---|---|
| Stage → operations | `plan_operation_templates` + `fn_instantiate_operation_template` (#552) |
| Stage internal ordering | relative scheduling / depends-on + offset (#572) |
| Harvest maturity | `harvest_stage` vocabulary (#543) |
| Weather windows (spray/frost/wind) | weather gates + per-org thresholds (#556) |
| Dose safety | agronomist sign-off gate (#557) |
| Material readiness | `fn_stock_coverage` (SPEC-0001) |
| Labor readiness | labor requirements + person links (#549/#558) |
| History to default from | `farm_event` spine + PVA reports |

## 4. Proposed model (Owner to ratify)

- `season_stages` (org-scoped, seeded editable template per crop/cultivar): `key`, Arabic name, default window (month/day ± days), lead-time days, sort. **Agronomy content = editable template, NOT prescription** (non-negotiable #4 applies; dose-bearing templates stay behind the sign-off gate).
- `season_stage_templates`: stage → operation-template links with per-palm labor/material coefficients.
- `fn_propose_stage_plan(org, stage, scope)` (SECURITY DEFINER, `plan.write`): instantiates a **draft** plan for the scope (sector/hawsha) from the stage's templates × palm counts from the registry; returns the draft id. Idempotent per (org, stage, scope, season-year).
- Proposal ≠ approval: drafts flow through the existing plan approval + budget-check path. **No auto-commit, ever.**
- Readiness view: SQL view/RPC joining stage window × coverage × labor × budget-check for the dashboard panel.

## 5. MVP slice (one season stage end-to-end)

Build **تلقيح (pollination)** first — the most time-critical, highest-labor stage, and the one no competitor productizes:

1. Pollination window per hawsha (spathe-split observations recorded as events; optimal pass = 12–36h after split; 2–4-day re-pass intervals — editable template numbers, agronomist-gated).
2. **Pollen inventory as stock items** (pollen from the 299 ذكور + bags/tools) → the coverage engine natively answers "enough pollen for the projected passes?"
3. Per-palm/per-hawsha pass records via existing `/m` execute flow (supports the piece-rate wage model, #388).
4. Readiness panel for the stage on the owner dashboard.

Acceptance: for the reference tenant, proposing the pollination stage on real registry data generates a draft plan whose material/labor totals reconcile to hand-computed values; coverage flags a seeded pollen shortage; nothing posts without approval.

## 5A. Intercropping constraint (Owner fact, 2026-07-02 — issue #595)

Some hawshat carry **other crops between the palms (زراعات بينية)**. Consequences for this engine:
season stages must be scoped per **(hawsha × crop)**, not per hawsha — a hawsha can be inside the palm
pollination window AND an intercrop's own calendar simultaneously; proposals must never assume a
hawsha's labor/materials belong to palms alone; and intercrop templates are a separate, later template
family (post-Stage-M slice per #595 D3). The MVP slice (pollination) is unaffected — it is palm-only by
nature — but the `fn_propose_stage_plan` signature should carry a `crop` dimension from day one so the
model doesn't need a breaking change later.

## 6. Explicitly out of scope

Auto-executing plans; CV/AI phenology detection; IoT triggers; any dose presented as authoritative without the Stage-10 sign-off; building before Stage M real data.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Template numbers treated as agronomy advice | Sign-off gate (#557) + "template not prescription" labeling (non-negotiable #4) |
| Proposal spam / duplicate drafts | Idempotency per (org, stage, scope, season-year); lead-time config |
| Wrong defaults from synthetic history | Build AFTER Stage M; default from real events only |
| Scope creep into a "farm calendar app" | MVP = one stage (pollination); each further stage is its own gated task |

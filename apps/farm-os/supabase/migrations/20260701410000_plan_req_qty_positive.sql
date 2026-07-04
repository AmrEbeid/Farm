-- Farm OS — F2 follow-up: tighten plan-requirement quantity floors from `>= 0` to `> 0`.
--
-- THE GAP. Migration 0054 added `>= 0` CHECKs on plan_material_requirements.qty and
-- plan_labor_requirements.count/days, reasoning that "zero is a benign no-op, only negatives mask the
-- invariants." F2 (REVIEW-360) showed that reasoning is wrong at the data-honesty layer: a plan
-- operation that requires 0 of a material, or 0 workers, or 0 days, is a FABRICATED record — it asserts
-- "we planned to use this material / this labour" while quantifying it as nothing (non-negotiable #1,
-- never fabricate). F2 already rejects `<= 0` in the client and the plan server action; this is the
-- DB-layer backstop (the cardinal enforcement point) so a direct-REST insert can't reintroduce it.
--
-- THE FIX. Replace the three `_nonneg` (`>= 0`) CHECKs with `_positive` (`> 0`) CHECKs. Named
-- explicitly for clear 23514 violation errors (toArabicError maps 23514 → Arabic). est_cost keeps its
-- `>= 0` (a genuinely-free operation can legitimately cost 0); the spray-compliance rei/phi/wind
-- `_nonneg` CHECKs (migration 20260701320000) are untouched (0 hours/days is a valid "no restriction").
--
-- APPLY SAFETY — NOT VALID. Unlike 0054 (which verified 0 negative rows on prod and validated
-- immediately), this author cannot verify prod has zero qty/count/days = 0 rows — the very
-- fabricated-zeros F2 was about may already be persisted. So each constraint is added `NOT VALID`:
-- it is enforced for every NEW and UPDATED row immediately, but existing rows are grandfathered rather
-- than failing the apply. A NULL still satisfies a CHECK, so nullable columns are unaffected (qty is
-- NOT NULL via 0099; count/days follow the table definition).
--
-- OWNER FOLLOW-UP (after apply). Confirm and clean any historical violators, then validate:
--     select count(*) from public.plan_material_requirements where qty <= 0;      -- expect 0
--     select count(*) from public.plan_labor_requirements     where count <= 0;   -- expect 0
--     select count(*) from public.plan_labor_requirements     where days  <= 0;   -- expect 0
--   If all are 0 (or after cleaning), promote to fully-validated:
--     alter table public.plan_material_requirements validate constraint plan_material_requirements_qty_positive;
--     alter table public.plan_labor_requirements     validate constraint plan_labor_requirements_count_positive;
--     alter table public.plan_labor_requirements     validate constraint plan_labor_requirements_days_positive;
--
-- SECURITY. Pure table-invariant CHECKs; no RLS, grant, or SECURITY DEFINER surface touched. The
-- engine (fn_stock_coverage) reads these quantities as demand — a 0 no longer dilutes a real
-- requirement, same invariant family as 0054's negative-masking fix.
--
-- ROLLBACK. Drop the three `_positive` constraints and re-add the `_nonneg` (`>= 0`) ones.

alter table public.plan_material_requirements
  drop constraint if exists plan_material_requirements_qty_nonneg;
alter table public.plan_material_requirements
  add constraint plan_material_requirements_qty_positive check (qty > 0) not valid;

alter table public.plan_labor_requirements
  drop constraint if exists plan_labor_requirements_count_nonneg;
alter table public.plan_labor_requirements
  add constraint plan_labor_requirements_count_positive check (count > 0) not valid;

alter table public.plan_labor_requirements
  drop constraint if exists plan_labor_requirements_days_nonneg;
alter table public.plan_labor_requirements
  add constraint plan_labor_requirements_days_positive check (days > 0) not valid;

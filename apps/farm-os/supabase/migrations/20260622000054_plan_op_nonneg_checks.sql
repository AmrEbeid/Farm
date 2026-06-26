-- Farm OS MVP-0 — #280 F5: non-negativity CHECKs on the plan-operation numeric inputs.
--
-- THE GAP. plan_operations.est_cost, plan_material_requirements.qty, and
-- plan_labor_requirements.count/days carry NO check constraint (confirmed via pg_constraint on prod).
-- A negative value isn't just nonsensical — it MASKS the very invariants the engine/budget enforce:
--   • a negative plan_material_requirements.qty REDUCES projected demand in fn_stock_coverage
--     (demand = sum(qty)), so it can hide a real shortage (a shortage-mask, same family as F2/F4);
--   • a negative plan_operations.est_cost UNDER-counts the plan total in the budget check, so an
--     over-budget plan can pass.
-- These are reachable through any direct-REST insert/update that the RLS USING predicate allows.
--
-- THE FIX. Add non-negativity CHECKs. `>= 0` (not `> 0`): zero is a benign no-op input; the masking
-- risk is strictly the negative side. A CHECK is satisfied on NULL, so nullable columns (est_cost) keep
-- accepting NULL. Prod has 0 violating rows (verified), so the constraints validate immediately. Named
-- explicitly for clear violation errors (23514). Small tables — no NOT VALID/VALIDATE split needed.

alter table public.plan_operations
  add constraint plan_operations_est_cost_nonneg check (est_cost >= 0);

alter table public.plan_material_requirements
  add constraint plan_material_requirements_qty_nonneg check (qty >= 0);

alter table public.plan_labor_requirements
  add constraint plan_labor_requirements_count_nonneg check (count >= 0);

alter table public.plan_labor_requirements
  add constraint plan_labor_requirements_days_nonneg check (days >= 0);

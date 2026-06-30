-- 0099 — plan_material_requirements.qty NOT NULL: close the NULL-qty masked-shortage gap.
--
-- PROBLEM (engine cardinal sin, SPEC-0001 #1). public.plan_material_requirements.qty was nullable.
-- The CHECK (qty >= 0) added in migration 0054 does NOT reject NULL: `NULL >= 0` evaluates to NULL,
-- and a CHECK constraint is SATISFIED when its expression is NULL. A NULL qty then flows into
-- public.fn_stock_coverage's demand aggregation as `sum(qty)` over an all-NULL bucket = NULL, which
-- the PAB recurrence coalesces to 0 (`coalesce(v_issues[i], 0)`) — SILENTLY DROPPING that operation's
-- demand and MASKING a real shortage. This is the NULL sibling of the NEGATIVE-qty masking that
-- migration 0054 already closed ("a negative plan_material_requirements.qty REDUCES projected demand").
--
-- REACHABLE TODAY: fn_add_plan_operation_multi (0093) validates only `coalesce(qty,0) < 0` (NULL passes)
-- and then inserts `(v_mat->>'qty')::numeric` directly, so a material entry with a missing/null "qty"
-- key stores NULL; the `tenant_all` RLS policy (0061) also permits a direct NULL insert.
--
-- INTENT: every material requirement must carry a quantity. Making qty NOT NULL means the masking
-- condition can never exist. A requirement with no quantity is meaningless data.
--
-- DATA NOTE: if any pre-existing row has qty IS NULL, this SET NOT NULL will FAIL LOUDLY on apply.
-- That is intentional — such rows are already silently mis-projecting demand and must be corrected
-- (set the real quantity, or delete the stray requirement) BEFORE this migration is applied. Probe:
--   select id, plan_op_id, item_id from public.plan_material_requirements where qty is null;
--
-- SECURITY: no RLS / grant / EXECUTE / function change. Pure column constraint.
-- ROLLBACK: alter table public.plan_material_requirements alter column qty drop not null;

alter table public.plan_material_requirements
  alter column qty set not null;

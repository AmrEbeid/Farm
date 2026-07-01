-- 54 — #280 F5: plan-operation numeric inputs are non-negative. plan_operations.est_cost,
-- plan_material_requirements.qty, and plan_labor_requirements.count/days had NO check constraint, so a
-- direct-REST negative value could mask the engine/budget invariants: a negative qty reduces projected
-- demand in fn_stock_coverage (hides a shortage), a negative est_cost under-counts the budget total.
-- 0054 adds non-negativity CHECKs. Inserts here run as superuser — the CHECK fires regardless of role
-- (it is a table invariant, not RLS), so the throws are the 23514 check_violation, not an RLS/grant
-- denial. POTASSIUM item + orgA from seed.sql.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(6);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set plan 'eeee0054-0000-0000-0000-0000000000a1'
\set op   'eeee0054-0000-0000-0000-0000000000b1'

-- valid parents (plan + a planned op) seeded as superuser
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');
insert into public.plan_operations (id, org_id, plan_id, subtype, est_cost, status)
  values (:'op', :'orgA', :'plan', 'fertilization', 100, 'planned');

-- ===== negatives are rejected by the new CHECKs (23514 check_violation) =====
select throws_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, est_cost, status)
            values (%L, %L, 'irrigation', -1, 'planned') $$, :'orgA', :'plan'),
  '23514', null,
  '#280 F5: a negative plan_operations.est_cost is rejected (budget-mask blocked)');

select throws_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values (%L, %L, %L, -5, 'kg') $$, :'orgA', :'op', :'item'),
  '23514', null,
  '#280 F5: a negative plan_material_requirements.qty is rejected (shortage-mask blocked)');

select throws_ok(
  format($$ insert into public.plan_labor_requirements (org_id, plan_op_id, count, days)
            values (%L, %L, -1, 1) $$, :'orgA', :'op'),
  '23514', null,
  '#280 F5: a negative plan_labor_requirements.count is rejected');

select throws_ok(
  format($$ insert into public.plan_labor_requirements (org_id, plan_op_id, count, days)
            values (%L, %L, 1, -1) $$, :'orgA', :'op'),
  '23514', null,
  '#280 F5: a negative plan_labor_requirements.days is rejected');

-- ===== valid non-negative rows (incl. zero) still insert — no over-restriction =====
select lives_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values (%L, %L, %L, 0, 'kg') $$, :'orgA', :'op', :'item'),
  '#280 F5: a zero/positive qty still inserts (zero is a benign no-op, only negatives masked)');

-- structural invariant: the original four #280 F5 non-negativity checks are present, PLUS the three
-- spray-compliance ones added by migration 20260701320000 (rei_hours/phi_days/wind_speed_kmh on
-- plan_material_requirements) — 7 total. Updated (not just re-counted) deliberately: a silent count
-- bump here would hide a future migration accidentally REMOVING one of the original four while ADDING
-- new ones elsewhere; this comment plus the +3 breakdown makes the change reviewable in the diff.
select is(
  (select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and c.contype = 'c' and c.conname like '%\_nonneg' escape '\'
       and t.relname in ('plan_operations','plan_material_requirements','plan_labor_requirements')),
  7,
  '#280 F5 + 20260701320000: 4 original + 3 spray-compliance non-negativity CHECK constraints are present');

select * from finish();
rollback;

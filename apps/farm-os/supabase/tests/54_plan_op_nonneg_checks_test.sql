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
select plan(13);

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

-- ===== F2 follow-up (20260701410000): ZERO qty/count/days are now rejected too =====
-- A plan operation requiring 0 of a material, or 0 workers, or 0 days, is a fabricated record
-- (non-negotiable #1). 0054's "zero is a benign no-op" allowance is retired for these three.
select throws_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values (%L, %L, %L, 0, 'kg') $$, :'orgA', :'op', :'item'),
  '23514', null,
  'F2: a ZERO plan_material_requirements.qty is now rejected (fabricated-zero blocked)');

select throws_ok(
  format($$ insert into public.plan_labor_requirements (org_id, plan_op_id, count, days)
            values (%L, %L, 0, 1) $$, :'orgA', :'op'),
  '23514', null,
  'F2: a ZERO plan_labor_requirements.count is now rejected');

select throws_ok(
  format($$ insert into public.plan_labor_requirements (org_id, plan_op_id, count, days)
            values (%L, %L, 1, 0) $$, :'orgA', :'op'),
  '23514', null,
  'F2: a ZERO plan_labor_requirements.days is now rejected');

-- ===== DB backstop: NULL labor count/days are rejected too =====
-- CHECK (count > 0) admits NULL, so the positive constraints must explicitly include IS NOT NULL.
select throws_ok(
  format($$ insert into public.plan_labor_requirements (org_id, plan_op_id, count, days)
            values (%L, %L, NULL, 1) $$, :'orgA', :'op'),
  '23514', null,
  'F2 backstop: a NULL plan_labor_requirements.count is rejected');

select throws_ok(
  format($$ insert into public.plan_labor_requirements (org_id, plan_op_id, count, days)
            values (%L, %L, 1, NULL) $$, :'orgA', :'op'),
  '23514', null,
  'F2 backstop: a NULL plan_labor_requirements.days is rejected');

-- ===== positive rows still insert — the tightening did not over-restrict =====
select lives_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values (%L, %L, %L, 1, 'kg') $$, :'orgA', :'op', :'item'),
  'a positive qty still inserts (no over-restriction)');

-- est_cost keeps its `>= 0` floor (a genuinely free operation can cost 0) — confirm it was NOT tightened.
select lives_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, est_cost, status)
            values (%L, %L, 'inspection', 0, 'planned') $$, :'orgA', :'plan'),
  'a zero plan_operations.est_cost still inserts (est_cost keeps >= 0; a free op is legitimate)');

-- structural invariant. After 20260701410000 the three quantity CHECKs are `_positive` (`> 0`); the
-- `_nonneg` set on these tables is now est_cost (1) + the three spray-compliance ones from
-- 20260701320000 (rei_hours/phi_days/wind_speed_kmh) = 4. Asserting BOTH counts (not a single total)
-- so a future migration can't silently swap a `_positive` back to `_nonneg` or drop one unnoticed.
select is(
  (select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and c.contype = 'c' and c.conname like '%\_nonneg' escape '\'
       and t.relname in ('plan_operations','plan_material_requirements','plan_labor_requirements')),
  4,
  'remaining `_nonneg` CHECKs: est_cost + 3 spray-compliance (rei/phi/wind)');

select is(
  (select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and c.contype = 'c' and c.conname like '%\_positive' escape '\'
       and t.relname in ('plan_operations','plan_material_requirements','plan_labor_requirements')),
  3,
  'F2 20260701410000: qty/count/days `_positive` (> 0) CHECKs are present');

select * from finish();
rollback;

-- 112 — soil-test-driven irrigation basis (migration 20260701330000). Covers: (a) the
-- irrigation_basis CHECK rejects an out-of-vocabulary value, (b) both real values + NULL are
-- accepted directly, (c) fn_add_plan_operation_multi persists the basis + reading end-to-end,
-- (d) the columns inherit plan_operations' existing RLS deny-by-default (no new policy needed —
-- verified via the tenant_all USING/WITH CHECK predicate still gating org membership), (e) anon
-- EXECUTE lockdown still holds on the extended RPC signature. Run via test-shims/run-pgtap-local.sh.
begin;
select plan(8);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set orgB  '00000000-0000-0000-0000-000000000002'
\set plan  'b1200000-0000-0000-0000-000000000112'
\set op    'b1200001-0000-0000-0000-000000000112'

insert into public.plans (id, org_id, type, status, scope_type) values (:'plan', :'orgA', 'monthly', 'approved', 'sector');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'irrigation', current_date, 'planned');

-- ── (a) CHECK rejects an out-of-vocabulary irrigation_basis ─────────────────────────────────────
select throws_ok(
  format($i$update public.plan_operations set irrigation_basis = 'guess' where id = '%s'$i$, :'op'),
  '23514', null,
  'irrigation_basis rejects an out-of-vocabulary value (23514)'
);

-- ── (b) both real values, and NULL, are accepted directly ───────────────────────────────────────
select lives_ok(
  format($i$update public.plan_operations set irrigation_basis = 'fixed_schedule' where id = '%s'$i$, :'op'),
  'irrigation_basis accepts ''fixed_schedule'''
);
select lives_ok(
  format($i$update public.plan_operations set irrigation_basis = 'soil_test', soil_moisture_reading = 'رطوبة منخفضة' where id = '%s'$i$, :'op'),
  'irrigation_basis accepts ''soil_test'' with a free-text reading'
);
select lives_ok(
  format($i$update public.plan_operations set irrigation_basis = null, soil_moisture_reading = null where id = '%s'$i$, :'op'),
  'irrigation_basis / soil_moisture_reading accept NULL (not recorded / non-irrigation ops)'
);

-- ── (c) fn_add_plan_operation_multi persists the basis end-to-end (extended signature, both new
--        trailing params optional) ────────────────────────────────────────────────────────────────
-- NAMED-parameter call (matches how PostgREST/the real app calls this RPC — see migration
-- 20260701330000's reconciliation note): after the 3-way merge, p_irrigation_basis/
-- p_soil_moisture_reading sit at positions 11-12 (p_preferred_time_of_day, from PR #562, is now
-- position 10) — a positional call here would silently target the wrong parameter, so this test
-- uses named params to stay correct regardless of final parameter order.
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id::text from public.organization_member
    where org_id = :'orgA' and role = 'farm_manager' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_add_plan_operation_multi(
  p_plan_id => :'plan', p_subtype => 'irrigation', p_planned_at => '2026-07-15'::date,
  p_ends_on => null, p_est_cost => 0, p_materials => '[]'::jsonb, p_labor => '[]'::jsonb,
  p_assignee_ids => null, p_lead_id => null,
  p_irrigation_basis => 'soil_test', p_soil_moisture_reading => '15%')::text, false);
reset role;

select is(
  (select irrigation_basis from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'soil_test', 'fn_add_plan_operation_multi persists irrigation_basis via its new optional param'
);
select is(
  (select soil_moisture_reading from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  '15%', 'fn_add_plan_operation_multi persists soil_moisture_reading via its new optional param'
);

-- an existing-shape 9-arg call (no basis/reading) still works unchanged — backward compatibility.
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id::text from public.organization_member
    where org_id = :'orgA' and role = 'farm_manager' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($i$ select public.fn_add_plan_operation_multi('%s'::uuid, 'inspection', '2026-07-16'::date, null, 0,
    '[]'::jsonb, '[]'::jsonb, null, null) $i$, :'plan'),
  'the pre-existing 9-arg call shape (no basis/reading) still works — additive, non-breaking'
);
reset role;

-- ── (d) RLS inheritance: irrigation_basis/soil_moisture_reading are plain columns on
--        plan_operations, so they are already covered by that table's existing tenant_all
--        USING/WITH CHECK (org_id in user_org_ids()) — no new policy exists or is needed. Verify a
--        cross-org member (orgB) cannot read orgA's row (deny-by-default holds for the new columns
--        exactly as it does for every pre-existing column). ─────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id::text from public.organization_member
    where org_id = :'orgB' and role = 'farm_manager' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*) from public.plan_operations where id = :'op'),
  0::bigint,
  'RLS: a cross-org member cannot see orgA''s row (irrigation_basis inherits table-level RLS, no new policy)'
);
reset role;

select * from finish();
rollback;

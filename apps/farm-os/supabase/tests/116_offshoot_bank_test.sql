-- 116 — SPEC-0024 S-7: بنك الفسائل (offshoot bank). Verifies migration 20260701470000: the plan.write gate
-- on the physical ledger, the budget.write gate on the valuation, movement-type + qty validation, the
-- plant/replant destination-leaf requirement, the produce/sell no-destination rule, the valuation range
-- guard, and anon lockdown. plan.write = owner/farm_manager; budget.write = owner/accountant (migration 0001).
--
-- Local shim runs as superuser; authorize() is exercised via jwt impersonation (tests 44/82/85/114/115).

begin;
select plan(13);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.fm', (select user_id::text from public.organization_member where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.sk', (select user_id::text from public.organization_member where org_id = :'org' and role = 'storekeeper' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: an owner exists in orgA');

-- Ensure a real non-system leaf cost center exists as a plant destination, while keeping
-- the seeded system «غير موزَّع» center around to prove it is rejected for planting.
select public.fn_seed_cost_center_defaults(:'org');
select set_config('test.leaf', (select id::text from public.cost_centers where org_id = :'org' and code = 'CC-HSW-PALM'), false);
select set_config('test.system_leaf', (select id::text from public.cost_centers where org_id = :'org' and code = 'CC-UNALLOC'), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1) plan.write gate on the ledger
select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_record_offshoot_movement(%L, 'produce', 100) $$, :'org'),
  '42501', null, 'storekeeper (no plan.write) cannot record an offshoot movement');
reset role;

select pg_temp.as_user(current_setting('test.fm'));
select lives_ok(
  format($$ select public.fn_record_offshoot_movement(%L, 'produce', 400, current_date, null, null, 'فصل من الأمهات') $$, :'org'),
  'farm_manager (plan.write) records a produce movement');

-- 2) validation
select throws_ok(
  format($$ select public.fn_record_offshoot_movement(%L, 'bogus', 5) $$, :'org'),
  '22023', null, 'invalid movement_type is rejected');
select throws_ok(
  format($$ select public.fn_record_offshoot_movement(%L, 'produce', 0) $$, :'org'),
  '22023', null, 'non-positive qty is rejected');
select throws_ok(
  format($$ select public.fn_record_offshoot_movement(%L, 'plant', 50) $$, :'org'),
  '23502', null, 'a plant movement requires a destination cost center');
select throws_ok(
  format($$ select public.fn_record_offshoot_movement(%L, 'plant', 50, current_date, null, %L) $$, :'org', current_setting('test.system_leaf')),
  '22023', null, 'a plant movement cannot land in the system unallocated cost center');
select throws_ok(
  format($$ select public.fn_record_offshoot_movement(%L, 'produce', 50, current_date, null, %L) $$, :'org', current_setting('test.leaf')),
  '22023', null, 'a produce movement must not carry a destination cost center');
select lives_ok(
  format($$ select public.fn_record_offshoot_movement(%L, 'plant', 200, current_date, null, %L, 'زراعة في الحصوة') $$, :'org', current_setting('test.leaf')),
  'a plant movement into an active leaf cost center succeeds');
reset role;

-- 3) valuation gate (budget.write, NOT plan.write) + range
select pg_temp.as_user(current_setting('test.fm'));
select throws_ok(
  format($$ select public.fn_set_offshoot_valuation(%L, 300, 600) $$, :'org'),
  '42501', null, 'farm_manager (no budget.write) cannot set the offshoot valuation');
reset role;
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select public.fn_set_offshoot_valuation(%L, 300, 600) $$, :'org'),
  'owner (budget.write) sets the offshoot valuation range');
select throws_ok(
  format($$ select public.fn_set_offshoot_valuation(%L, 700, 500) $$, :'org'),
  '22023', null, 'a valuation with low > high is rejected');
reset role;

-- 4) anon lockdown
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fn_record_offshoot_movement','fn_set_offshoot_valuation')
       and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'the offshoot RPCs are not EXECUTE-able by anon');

select * from finish();
rollback;

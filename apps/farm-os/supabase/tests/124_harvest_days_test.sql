-- 124 — SPEC-0027 H-B: يوم قطف (migration 20260701540000). plan.write gate, crates>0 validation,
-- cross-org cost-center rejection, quantities-only posture (no journal source), anon lockdown.

begin;
select plan(8);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.fm', (select user_id::text from public.organization_member where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.sk', (select user_id::text from public.organization_member where org_id = :'org' and role = 'storekeeper' limit 1), false);
select isnt(current_setting('test.fm'), '', 'fixture: a farm_manager exists in orgA');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_record_harvest_day(%L, 40) $$, :'org'),
  '42501', null, 'storekeeper (no plan.write) cannot record a picking day');
reset role;

insert into public.organization (id, name) values ('00000000-0000-0000-0000-0000000000dd', 'مزرعة أخرى') on conflict (id) do nothing;
insert into public.cost_centers (id, org_id, code, name_ar) values ('00000000-0000-0000-0000-0000000000cc','00000000-0000-0000-0000-0000000000dd','CC-X','مركز أجنبي') on conflict (id) do nothing;
select pg_temp.as_user(current_setting('test.fm'));
select lives_ok(
  format($$ select public.fn_record_harvest_day(%L, 40, null, 'برحي', current_date, 6, 'حوشة 3') $$, :'org'),
  'farm_manager records a picking day (40 crates, 6 pickers)');
select throws_ok(
  format($$ select public.fn_record_harvest_day(%L, 0) $$, :'org'),
  '22023', null, 'zero crates rejected');
select throws_ok(
  format($$ select public.fn_record_harvest_day(%L, 10, '00000000-0000-0000-0000-0000000000cc') $$, :'org'),
  '42501', null, 'a cross-org cost center is rejected');
reset role;

select is(
  (select count(*)::int from public.journal_entries where source_type = 'harvest_day'),
  0, 'picking days never touch the ledger (quantities only)');
select ok(
  (select relforcerowsecurity from pg_class where relname = 'harvest_days'),
  'harvest_days has FORCE RLS');
select ok(
  not has_function_privilege('anon', 'public.fn_record_harvest_day(uuid, numeric, uuid, text, date, int, text)', 'EXECUTE'),
  'fn_record_harvest_day is not EXECUTE-able by anon');

select * from finish();
rollback;

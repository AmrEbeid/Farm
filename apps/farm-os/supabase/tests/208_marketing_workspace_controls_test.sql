-- SPEC-0032: exact source-control drafts and all-row workspace aggregates.
begin;
select plan(20);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select has_table('public', 'marketing_workspace_control', 'source-control draft table exists');
select ok((select relrowsecurity from pg_class where oid='public.marketing_workspace_control'::regclass), 'RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid='public.marketing_workspace_control'::regclass), 'FORCE RLS enabled');
select ok(has_table_privilege('authenticated','public.marketing_workspace_control','SELECT')
  and not has_table_privilege('authenticated','public.marketing_workspace_control','INSERT')
  and not has_table_privilege('authenticated','public.marketing_workspace_control','UPDATE'), 'authenticated is read-only at table level');
select ok(not has_table_privilege('anon','public.marketing_workspace_control','SELECT'), 'anon has no table access');
select ok(has_function_privilege('authenticated','public.fn_save_marketing_workspace_control(uuid,text,text,jsonb)','EXECUTE'), 'authenticated reaches gated save RPC');
select ok(not has_function_privilege('anon','public.fn_save_marketing_workspace_control(uuid,text,text,jsonb)','EXECUTE'), 'anon cannot save drafts');
select ok((select 'search_path=""'=any(proconfig) from pg_proc where oid='public.fn_save_marketing_workspace_control(uuid,text,text,jsonb)'::regprocedure), 'save RPC has empty search_path');

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($sql$ select public.fn_save_marketing_workspace_control(%L,'farm','farm-1-control-1','"draft"'::jsonb) $sql$, :'org'), 'owner saves a source draft');
select is((select value #>> '{}' from public.marketing_workspace_control where org_id=:'org' and area_id='farm' and control_key='farm-1-control-1'), 'draft', 'draft value persisted');
select lives_ok(format($sql$ select public.fn_save_marketing_workspace_control(%L,'farm','farm-1-control-1','"updated"'::jsonb) $sql$, :'org'), 'owner updates the same draft');
select is((select count(*)::int from public.marketing_workspace_control where org_id=:'org' and area_id='farm' and control_key='farm-1-control-1'), 1, 'draft upsert is idempotent');
select is((select value #>> '{}' from public.marketing_workspace_control where org_id=:'org' and area_id='farm' and control_key='farm-1-control-1'), 'updated', 'updated draft persisted');
select throws_ok(format($sql$ select public.fn_save_marketing_workspace_control(%L,'bad-area','x','true'::jsonb) $sql$, :'org'), '22023', null, 'unknown area is rejected');
reset role;

select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(format($sql$ select public.fn_save_marketing_workspace_control(%L,'farm','x','true'::jsonb) $sql$, :'org'), '42501', null, 'supervisor cannot save drafts');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select public.fn_save_marketing_record(null, :'org', 'daily_sales_report', 'x',
  '{"date":"2026-08-23","lines":[{"sector":"قطاع أ","channel":"بيع","qtyKg":2,"pricePerKg":50}],"expenseItems":[]}'::jsonb,
  null, null, null, 'aggregate:test:daily');
select public.fn_save_marketing_record(null, :'org', 'weekly_availability', 'premium',
  '{"week":"2026-08-17","variety":"Premium","tons":3}'::jsonb, null, null, null, 'aggregate:test:weekly:1');
select public.fn_save_marketing_record(null, :'org', 'weekly_availability', 'commercial',
  '{"week":"2026-08-24","variety":"Commercial","tons":4}'::jsonb, null, null, null, 'aggregate:test:weekly:2');
select is((public.fn_marketing_workspace_aggregates(:'org')->'dailySectorLedger'->0->>'revenue')::numeric, 100::numeric, 'daily ledger aggregates all stored reports');
select is((public.fn_marketing_workspace_aggregates(:'org')->'weeklyAvailability'->>'premiumTons')::numeric, 3::numeric, 'premium availability aggregate is exact');
select is((public.fn_marketing_workspace_aggregates(:'org')->'weeklyAvailability'->>'commercialTons')::numeric, 4::numeric, 'commercial availability aggregate is exact');
select is((public.fn_marketing_workspace_aggregates(:'org')->'weeklyAvailability'->>'weeks')::integer, 2, 'distinct registered weeks are exact');
select cmp_ok((select count(*)::int from public.audit_log where entity_type='marketing_workspace_control'), '>=', 2, 'draft changes are audited');
reset role;

select * from finish();
rollback;

-- SPEC-0032: daily report formulas are canonical at the database boundary.
begin;
select plan(17);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select has_function('public', 'fn_canonicalize_marketing_daily_report', array[]::text[],
  'daily report canonicalizer exists');
select trigger_is('public', 'marketing_record', 'canonicalize_marketing_daily_report',
  'public', 'fn_canonicalize_marketing_daily_report', 'daily report trigger is installed');
select ok(not has_function_privilege('authenticated',
  'public.fn_canonicalize_marketing_daily_report()', 'EXECUTE'), 'canonicalizer is not directly executable');
select has_function('public', 'fn_save_marketing_contact_v3',
  array['uuid','uuid','text','text','text','text','text','text','text','boolean','text','text'],
  'contact status RPC exists');
select ok(has_function_privilege('authenticated',
  'public.fn_save_marketing_contact_v3(uuid,uuid,text,text,text,text,text,text,text,boolean,text,text)', 'EXECUTE'),
  'authenticated can reach the role-gated contact status RPC');

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.report', (public.fn_save_marketing_record(
  null, :'org', 'daily_sales_report', 'forged title',
  jsonb_build_object(
    'date','2026-08-22','seller',' المالك ','buyer','','witnesses','','notes','',
    'lines',jsonb_build_array(
      jsonb_build_object('sector','أ','channel','تصدير','qtyKg',10,'pricePerKg',20),
      jsonb_build_object('sector','ب','channel','','qtyKg',30,'pricePerKg',10)
    ),
    'expenseItems',jsonb_build_array(jsonb_build_object('name','نقل','amount',100)),
    'qtyKg',999,'totalRevenue',999999,'netAfterExpenses',999999,'sectors','forged'
  ), null, 999999, 'forged', null
))->>'id', false);

select is((select title from public.marketing_record where id=current_setting('test.report')::uuid),
  'تقرير مبيعات يوم 2026-08-22', 'title is canonical');
select is((select amount from public.marketing_record where id=current_setting('test.report')::uuid),
  400::numeric, 'stored amount is canonical net revenue');
select is((select status from public.marketing_record where id=current_setting('test.report')::uuid),
  'profit', 'stored status is canonical');
select is((select payload->>'qtyKg' from public.marketing_record where id=current_setting('test.report')::uuid),
  '40', 'quantity is recomputed');
select is((select payload->>'totalRevenue' from public.marketing_record where id=current_setting('test.report')::uuid),
  '500', 'revenue is recomputed');
select is((select payload->>'totalExpenses' from public.marketing_record where id=current_setting('test.report')::uuid),
  '100', 'expenses are recomputed');
select is((select (payload->'sectors'->0->>'expenseShare')::numeric from public.marketing_record where id=current_setting('test.report')::uuid),
  25::numeric, 'expenses are allocated by quantity');
select is((select payload->'lines'->1->>'channel' from public.marketing_record where id=current_setting('test.report')::uuid),
  'بيع', 'blank channel gets the source fallback');

select set_config('test.contact', (public.fn_save_marketing_contact_v2(
  null, :'org', 'جهة حالة', null, null, null, 'exporter', null, null, false, 'status:test',
  '{"website":"https://example.test"}'::jsonb
)->>'id'), false);
select lives_ok(format($sql$ select public.fn_save_marketing_contact_v3(
  %L, null, 'جهة حالة', null, null, null, 'exporter', null, null, false, 'status:test', 'مهتم'
) $sql$, current_setting('test.contact')), 'contact status can be updated atomically');
select is((select metadata->>'status' from public.marketing_contact where id=current_setting('test.contact')::uuid),
  'مهتم', 'contact status is persisted');
select is((select metadata->>'website' from public.marketing_contact where id=current_setting('test.contact')::uuid),
  'https://example.test', 'status update preserves imported provenance metadata');
select throws_ok(
  format($sql$ select public.fn_save_marketing_record(null,%L,'daily_sales_report','x',
    '{"date":"2026-08-22","lines":[]}'::jsonb,null,null,null,null) $sql$, :'org'),
  '22023', null, 'a report without sale lines is rejected');
reset role;

select * from finish();
rollback;

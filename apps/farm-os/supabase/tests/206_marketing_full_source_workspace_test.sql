-- SPEC-0032 full-source Marketing workspace.
begin;
select plan(57);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.as_user_active(uid text, active_org text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org)::text, true);
  execute 'set local role authenticated';
end $$;

select has_column('public', 'marketing_contact', 'metadata', 'contact provenance metadata exists');
select has_table('public', 'marketing_import_run', 'import evidence table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.marketing_import_run'::regclass),
  'marketing_import_run has RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid = 'public.marketing_import_run'::regclass),
  'marketing_import_run has FORCE RLS enabled');
select ok(
  not has_table_privilege('anon', 'public.marketing_import_run', 'SELECT')
  and not has_table_privilege('anon', 'public.marketing_import_run', 'INSERT'),
  'anon has no marketing_import_run access');
select ok(
  has_table_privilege('authenticated', 'public.marketing_import_run', 'SELECT')
  and not has_table_privilege('authenticated', 'public.marketing_import_run', 'INSERT')
  and not has_table_privilege('authenticated', 'public.marketing_import_run', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.marketing_import_run', 'DELETE'),
  'authenticated can read evidence but cannot write it directly');
select ok(
  not has_function_privilege('anon',
    'public.fn_import_marketing_source(uuid,text,jsonb,jsonb,integer,integer,jsonb)', 'EXECUTE'),
  'anon cannot execute the source import');
select ok(
  has_function_privilege('authenticated',
    'public.fn_import_marketing_source(uuid,text,jsonb,jsonb,integer,integer,jsonb)', 'EXECUTE'),
  'authenticated can reach the role-gated source import');
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'public.fn_import_marketing_source(uuid,text,jsonb,jsonb,integer,integer,jsonb)'::regprocedure),
  'source import has an empty search_path');

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($sql$
    select set_config('test.run',
      (public.fn_import_marketing_source(
        %L, repeat('a', 64),
        jsonb_build_array(jsonb_build_object(
          'sourceKey','full:test:contact:owner','name','جهة اختبار المالك',
          'category','exporter','selected',true,
          'metadata',jsonb_build_object('website','https://example.test')
        )),
        jsonb_build_array(jsonb_build_object(
          'sourceKey','full:test:record:owner','recordType','freight_reference',
          'title','مرجع شحن اختباري','payload',jsonb_build_object('market','الكويت'),
          'status','reference','contactSourceKey','full:test:contact:owner'
        )),
        1, 1, jsonb_build_object('tabs',jsonb_build_array('dashboard'))
      )->'run'->>'id'), false)
  $sql$, :'org'),
  'owner can atomically import one contact and one extended record');
select is((select count(*)::int from public.marketing_contact
  where org_id = :'org' and source_key = 'full:test:contact:owner'), 1,
  'owner import created the contact once');
select is((select count(*)::int from public.marketing_record
  where org_id = :'org' and source_key = 'full:test:record:owner'), 1,
  'owner import created the record once');
select is((select metadata->>'website' from public.marketing_contact
  where org_id = :'org' and source_key = 'full:test:contact:owner'), 'https://example.test',
  'contact source metadata persisted');
select is((select record_type from public.marketing_record
  where org_id = :'org' and source_key = 'full:test:record:owner'), 'freight_reference',
  'extended record type persisted');
select is((select c.source_key from public.marketing_record r join public.marketing_contact c on c.id = r.contact_id
  where r.org_id = :'org' and r.source_key = 'full:test:record:owner'), 'full:test:contact:owner',
  'record linked to the same-org source contact');
select is((select imported_contacts || ':' || existing_contacts || ':' || imported_records || ':' || existing_records
  from public.marketing_import_run where id = current_setting('test.run')::uuid), '1:0:1:0',
  'import evidence records exact created/existing counts');
select lives_ok(
  format($sql$ select public.fn_save_marketing_record(
    null, %L, 'daily_sales_report', 'تقرير يومي', '{"date":"2026-08-22"}'::jsonb,
    null, null, 'ready', null
  ) $sql$, :'org'),
  'normal save RPC accepts an extended record type');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('b',64), '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $sql$, :'org'),
  '42501', null, 'accountant cannot approve a source import');
reset role;
select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('c',64), '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $sql$, :'org'),
  '42501', null, 'farm_manager cannot approve a source import');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('d',64), '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $sql$, :'org'),
  '42501', null, 'supervisor cannot import');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, 'bad', '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'bad source hash is rejected');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('e',64), '[]'::jsonb, '[]'::jsonb, 1, 0, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'declared counts must match payload lengths');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('f',64), '{}'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'contacts must be an array');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('1',64),
    jsonb_build_array(
      jsonb_build_object('sourceKey','dup','name','أ','category','other'),
      jsonb_build_object('sourceKey','dup','name','ب','category','other')
    ), '[]'::jsonb, 2, 0, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'duplicate contact source keys are rejected');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('2',64), '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('sourceKey','dup-r','recordType','task','title','أ','payload','{}'::jsonb),
      jsonb_build_object('sourceKey','dup-r','recordType','task','title','ب','payload','{}'::jsonb)
    ), 0, 2, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'duplicate record source keys are rejected');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('3',64), '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'sourceKey','bad-type','recordType','not_a_type','title','x','payload','{}'::jsonb
    )), 0, 1, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'unknown record type is rejected');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('4',64), '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'sourceKey','bad-link','recordType','task','title','x','payload','{}'::jsonb,
      'contactSourceKey','missing-contact'
    )), 0, 1, '{}'::jsonb) $sql$, :'org'),
  '23503', null, 'unknown contact source link is rejected');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('5',64),
    jsonb_build_array(jsonb_build_object(
      'sourceKey','bad-meta','name','x','category','other','metadata','[]'::jsonb
    )), '[]'::jsonb, 1, 0, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'contact metadata must be an object');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('8',64),
    jsonb_build_array(jsonb_build_object('sourceKey','missing-category','name','x')),
    '[]'::jsonb, 1, 0, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'contact category is required');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('9',64), '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'sourceKey','missing-type','title','x','payload','{}'::jsonb
    )), 0, 1, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'record type is required');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('0',64), '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'sourceKey','large-amount','recordType','task','title','x','payload','{}'::jsonb,
      'amount',1000000000000001
    )), 0, 1, '{}'::jsonb) $sql$, :'org'),
  '22023', null, 'record amount is bounded before writes');

select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('6',64),
    jsonb_build_array(jsonb_build_object(
      'sourceKey','atomic-contact','name','لن يبقى','category','other'
    )),
    jsonb_build_array(jsonb_build_object(
      'sourceKey','atomic-record','recordType','task','title','x','payload','{}'::jsonb,
      'contactSourceKey','unknown-after-validation'
    )), 1, 1, '{}'::jsonb) $sql$, :'org'),
  '23503', null, 'a bad linked record aborts the import');
select is((select count(*)::int from public.marketing_contact
  where org_id = :'org' and source_key = 'atomic-contact'), 0,
  'failed import leaves no partial contact');

select lives_ok(
  format($sql$ select public.fn_save_marketing_contact_v2(
    (select id from public.marketing_contact where org_id=%L and source_key='full:test:contact:owner'),
    null, 'اسم يدوي محفوظ', null, null, null, 'exporter', 'manual', 'manual note', true,
    'full:test:contact:owner', '{"manual":true}'::jsonb
  ) $sql$, :'org'),
  'v2 contact save supports metadata');
select is((select metadata->>'manual' from public.marketing_contact
  where org_id = :'org' and source_key = 'full:test:contact:owner'), 'true',
  'manual metadata edit persisted');
select lives_ok(
  format($sql$ select set_config('test.repeat',
    (public.fn_import_marketing_source(
      %L, repeat('a',64),
      jsonb_build_array(jsonb_build_object(
        'sourceKey','full:test:contact:owner','name','source name','category','exporter'
      )),
      jsonb_build_array(jsonb_build_object(
        'sourceKey','full:test:record:owner','recordType','freight_reference',
        'title','source title','payload','{}'::jsonb
      )),
      1, 1, '{}'::jsonb
    )->>'idempotent'), false) $sql$, :'org'),
  'repeating the same source hash succeeds');
select is(current_setting('test.repeat'), 'true', 'same source hash reports idempotent');
select is((select name from public.marketing_contact
  where org_id = :'org' and source_key = 'full:test:contact:owner'), 'اسم يدوي محفوظ',
  'idempotent import preserves manual contact edits');
select is((select count(*)::int from public.marketing_import_run
  where org_id = :'org' and source_hash = repeat('a',64)), 1,
  'same source hash has one evidence row');

\set orgC 'cccccccc-cccc-cccc-cccc-cccccccccccc'
reset role;
insert into public.organization (id, name) values (:'orgC', 'مزرعة ج') on conflict (id) do nothing;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('7',64), '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $sql$, :'orgC'),
  '42501', null, 'an owner cannot import into an organization they do not belong to');

reset role;
insert into public.organization_member (org_id, user_id, role)
  values (:'orgC', current_setting('test.accountant')::uuid, 'accountant')
  on conflict (org_id, user_id) do update set role = excluded.role;
select pg_temp.as_user_active(current_setting('test.accountant'), :'orgC');
select throws_ok(
  format($sql$ select public.fn_import_marketing_source(
    %L, repeat('7',64), '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $sql$, :'org'),
  '42501', null, 'active-org narrowing blocks import into another membership');
reset role;
select pg_temp.as_user(current_setting('test.owner'));

select set_config('test.page1', (public.fn_save_marketing_contact_v2(
  null, :'org', 'Page Needle 1', null, null, null, 'other', null, null, false, 'page:1', '{}'))->>'id', false);
select set_config('test.page2', (public.fn_save_marketing_contact_v2(
  null, :'org', 'Page Needle 2', null, null, null, 'other', null, null, false, 'page:2', '{}'))->>'id', false);
select set_config('test.page3', (public.fn_save_marketing_contact_v2(
  null, :'org', 'Page Needle 3', null, null, null, 'other', null, null, false, 'page:3', '{}'))->>'id', false);
select set_config('test.page_result', public.fn_marketing_contacts_page(
  :'org', 'Page Needle', null, false, 1, 2)::text, false);
select is((current_setting('test.page_result')::jsonb->>'total')::int, 3,
  'contact page returns an exact filtered total');
select is(jsonb_array_length(current_setting('test.page_result')::jsonb->'rows'), 2,
  'contact page applies the bounded page size');
select is((current_setting('test.page_result')::jsonb->>'pages')::int, 2,
  'contact page returns exact page count');
select is(jsonb_array_length(public.fn_marketing_contacts_page(
  :'org', 'Page Needle', null, false, 2, 2)->'rows'), 1,
  'contact page returns the final partial page');
select throws_ok(
  format($sql$ select public.fn_marketing_contacts_page(%L, null, null, false, 1, 101) $sql$, :'org'),
  '22023', null, 'contact page rejects an unbounded page size');

select lives_ok(
  format($sql$ select public.fn_log_marketing_contact_activity(
    %L, 'call', 'snapshot activity', now(), now() + interval '1 day') $sql$,
    (select id from public.marketing_contact where org_id = :'org' and source_key = 'full:test:contact:owner')),
  'contact activity can feed the dashboard snapshot');
select set_config('test.snapshot', public.fn_marketing_dashboard_snapshot(:'org')::text, false);
select cmp_ok((current_setting('test.snapshot')::jsonb->>'activeContacts')::int, '>=', 4,
  'dashboard returns exact active contact count from the database');
select cmp_ok((current_setting('test.snapshot')::jsonb->>'selectedContacts')::int, '>=', 1,
  'dashboard returns selected contact count');
select is((current_setting('test.snapshot')::jsonb->'recordsByType'->>'freight_reference')::int, 1,
  'dashboard groups extended records by type');
select cmp_ok(jsonb_array_length(current_setting('test.snapshot')::jsonb->'recentActivity'), '>=', 1,
  'dashboard returns bounded recent activity');
select is(jsonb_typeof(current_setting('test.snapshot')::jsonb->'latestImport'->'coverage'), 'object',
  'dashboard exposes latest import coverage');

select lives_ok(
  format($sql$ select public.fn_archive_marketing_contact(%L, true) $sql$, current_setting('test.page1')),
  'contact can be archived before pagination filtering');
select is((public.fn_marketing_contacts_page(:'org', 'Page Needle', null, false, 1, 50)->>'total')::int, 2,
  'active-only contact page excludes archived rows');
select is((public.fn_marketing_contacts_page(:'org', 'Page Needle', null, null, 1, 50)->>'total')::int, 3,
  'all-state contact page includes archived rows');
reset role;

select pg_temp.as_user(current_setting('test.sup'));
select is((select count(*)::int from public.marketing_import_run where org_id = :'org'), 0,
  'supervisor reads no import evidence rows');
reset role;

select cmp_ok((select count(*)::int from public.audit_log
  where entity_type = 'marketing_import_run'), '>=', 1,
  'successful imports are audited');

select * from finish();
rollback;

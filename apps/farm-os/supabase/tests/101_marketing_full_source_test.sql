-- 101 — SPEC-0032 full-source Marketing workspace (migration 20260822110000). Verifies the four
-- things that migration adds, and only those: `marketing_contact.metadata`, the four extra
-- `marketing_record` types, the `marketing_import_run` ledger + `fn_import_marketing_source`, and the
-- two exact read RPCs (`fn_marketing_contacts_page`, `fn_marketing_dashboard_snapshot`).
--
-- Covered: schema + grant lockdown (RLS/FORCE, RPC-only writes, definer/search_path, anon holds
-- nothing); Owner-only source approval with module-role reads; active-org
-- narrowing and cross-org isolation; every rejection path of the import (bad array shape, wrong
-- declared counts, malformed hash, wrong field types, duplicate sourceKey, unknown contact link);
-- ATOMIC ROLLBACK (a pack that passes field validation but violates a table CHECK leaves nothing
-- behind — no contacts, no records, no run row); idempotency for a repeated (org, hash) and
-- manual-edit preservation on a re-import under a new hash; exact pagination/search totals; exact
-- dashboard aggregates.
--
-- Impersonation via request.jwt.claims. Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(75);

\set org '00000000-0000-0000-0000-000000000001'
\set orgC 'cccccccc-cccc-cccc-cccc-cccccccccccc'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

-- two deterministic 64-hex source-pack hashes (the import's own format gate is exercised in §4).
select set_config('test.h1', repeat('a', 64), false);
select set_config('test.h2', repeat('b', 64), false);

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

-- ===== 1) schema + grant lockdown =====
select has_column('public', 'marketing_contact', 'metadata',
  'marketing_contact.metadata column exists');
select is(
  (select count(*)::int from public.marketing_contact where jsonb_typeof(metadata) <> 'object'),
  0, 'marketing_contact.metadata is always a JSON object (default {} on existing rows)');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
     where oid = 'public.marketing_import_run'::regclass),
  'marketing_import_run has RLS ENABLED and FORCED');
select is(
  (select count(*)::int from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'marketing_import_run' and grantee = 'anon'),
  0, 'anon holds NO privilege at all on marketing_import_run');
select ok(
  has_table_privilege('authenticated', 'public.marketing_import_run', 'SELECT')
  and not has_table_privilege('authenticated', 'public.marketing_import_run', 'INSERT')
  and not has_table_privilege('authenticated', 'public.marketing_import_run', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.marketing_import_run', 'DELETE'),
  'marketing_import_run is read-only to authenticated (ledger writes are RPC-only)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fn_save_marketing_contact_v2', 'fn_import_marketing_source',
                        'fn_marketing_contacts_page', 'fn_marketing_dashboard_snapshot')
      and p.prosecdef
      and 'search_path=""' = any(p.proconfig)),
  4, 'all four new RPCs are SECURITY DEFINER with an EMPTY search_path');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fn_save_marketing_contact_v2', 'fn_import_marketing_source',
                        'fn_marketing_contacts_page', 'fn_marketing_dashboard_snapshot')
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'anon can EXECUTE none of the four new RPCs');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('fn_save_marketing_contact_v2', 'fn_import_marketing_source',
                        'fn_marketing_contacts_page', 'fn_marketing_dashboard_snapshot')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  4, 'authenticated can EXECUTE all four new RPCs');
select ok(
  (select count(*)::int from pg_proc where proname = 'fn_save_marketing_contact') = 1,
  'the v1 contact RPC is PRESERVED alongside v2 (backwards compatible)');

-- ===== 2) the import: owner can run it; every new record type lands =====
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select set_config('test.run1',
    (public.fn_import_marketing_source(%L, %L,
      '[{"sourceKey":"src:c:1","name":"شركة تصدير أ","category":"exporter","selected":true,
          "metadata":{"sourceGroup":"exporters","website":"a.example"}},
        {"sourceKey":"src:c:2","name":"موزع الكويت","category":"kuwait_distributor","selected":false,
          "metadata":{}}]'::jsonb,
      '[{"sourceKey":"src:r:1","recordType":"freight_reference","title":"مرجع شحن","payload":{"lane":"EG-KW"},
          "status":"reference","contactSourceKey":"src:c:1"},
        {"sourceKey":"src:r:2","recordType":"market_reference","title":"مرجع سوق","payload":{},"status":"reference"},
        {"sourceKey":"src:r:3","recordType":"daily_sales_report","title":"تقرير يومي",
          "payload":{"date":"2026-08-22","lines":[{"sector":"أ","channel":"بيع","qtyKg":1,"pricePerKg":1}],"expenseItems":[]},"status":"draft"},
        {"sourceKey":"src:r:4","recordType":"repeat_customer","title":"عميل متكرر","payload":{},"status":"active"}]'::jsonb,
      2, 4, '{"tabs":["dashboard","prices"],"templates":20}'::jsonb))->'run'->>'id', false) $$,
    :'org', current_setting('test.h1')),
  'fn_import_marketing_source: owner can import a reviewed source pack');
select isnt(current_setting('test.run1'), '', 'the import returned a run id');
select is(
  (select count(*)::int from public.marketing_record
     where org_id = :'org' and record_type in
       ('freight_reference', 'market_reference', 'daily_sales_report', 'repeat_customer')),
  4, 'all four NEW record types are accepted by the extended record_type CHECK');
select is(
  (select metadata->>'sourceGroup' from public.marketing_contact
     where org_id = :'org' and source_key = 'src:c:1'),
  'exporters', 'imported contact provenance is preserved in metadata');
select is(
  (select c.source_key from public.marketing_record r
     join public.marketing_contact c on c.id = r.contact_id
    where r.org_id = :'org' and r.source_key = 'src:r:1'),
  'src:c:1', 'a record is linked to its contact by contactSourceKey');
select is(
  (select array[expected_contacts, imported_contacts, existing_contacts,
                expected_records, imported_records, existing_records]
     from public.marketing_import_run where id = current_setting('test.run1')::uuid),
  array[2, 2, 0, 4, 4, 0],
  'the ledger records exact expected / created / already-present counts');
reset role;

-- ===== 3) role gate: module roles can read; only owner can import; supervisor denied =====
select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$ select public.fn_marketing_contacts_page(%L) $$, :'org'),
  'fn_marketing_contacts_page: accountant is allowed');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '42501', null, 'fn_import_marketing_source: accountant cannot approve an import');
reset role;
select pg_temp.as_user(current_setting('test.manager'));
select lives_ok(format($$ select public.fn_marketing_dashboard_snapshot(%L) $$, :'org'),
  'fn_marketing_dashboard_snapshot: farm_manager is allowed');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '42501', null, 'fn_import_marketing_source: farm_manager cannot approve an import');
reset role;

select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '42501', null, 'fn_import_marketing_source: a supervisor is FORBIDDEN');
select throws_ok(format($$ select public.fn_marketing_contacts_page(%L) $$, :'org'),
  '42501', null, 'fn_marketing_contacts_page: a supervisor is FORBIDDEN');
select throws_ok(format($$ select public.fn_marketing_dashboard_snapshot(%L) $$, :'org'),
  '42501', null, 'fn_marketing_dashboard_snapshot: a supervisor is FORBIDDEN');
select throws_ok(
  format($$ select public.fn_save_marketing_contact_v2(null, %L, 'ممنوع', null, null, null, 'exporter',
    null, null, false, null, '{}'::jsonb) $$, :'org'),
  '42501', null, 'fn_save_marketing_contact_v2: a supervisor is FORBIDDEN');
select throws_ok(
  format($$ insert into public.marketing_import_run (org_id, source_hash, expected_contacts,
    imported_contacts, existing_contacts, expected_records, imported_records, existing_records, coverage)
    values (%L, %L, 0, 0, 0, 0, 0, 0, '{}'::jsonb) $$, :'org', current_setting('test.h2')),
  '42501', null, 'direct-REST: a client cannot INSERT an import-run row (RPC-only ledger)');
select is(
  (select count(*)::int from public.marketing_import_run where org_id = :'org'),
  0, 'a supervisor session reads ZERO marketing_import_run rows (role-scoped SELECT)');
reset role;

-- ===== 4) active-org narrowing + cross-org isolation =====
insert into public.organization (id, name) values (:'orgC', 'مزرعة ج') on conflict (id) do nothing;
insert into public.organization_member (org_id, user_id, role)
  values (:'orgC', current_setting('test.accountant')::uuid, 'accountant');

select pg_temp.as_user_active(current_setting('test.accountant'), :'org');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $$,
    :'orgC', current_setting('test.h2')),
  '42501', null,
  'active-org narrowing: an accountant ACTIVE in org A cannot import into org C despite qualifying there');
select throws_ok(format($$ select public.fn_marketing_contacts_page(%L) $$, :'orgC'),
  '42501', null, 'active-org narrowing: the paged read is refused for a non-active qualifying org');
reset role;
select pg_temp.as_user_active(current_setting('test.accountant'), :'orgC');
select is(
  (public.fn_marketing_contacts_page(:'orgC')->>'total')::int,
  0, 'cross-org isolation: org C sees NONE of org A''s imported contacts');
reset role;

-- ===== 5) every rejection path, before anything is written =====
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, 'not-a-hash', '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $$, :'org'),
  '22023', null, 'import: a malformed source hash is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $$,
    :'org', upper(repeat('a', 64))),
  '22023', null, 'import: an uppercase hash is rejected (canonical lowercase hex only)');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '{"not":"an array"}'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: a non-array contacts payload is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: a non-object coverage manifest is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L,
    '[{"sourceKey":"x","name":"ن","category":"exporter"}]'::jsonb, '[]'::jsonb, 5, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: declared counts that do not match the arrays are rejected (no silent short import)');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L,
    '[{"sourceKey":"  ","name":"ن","category":"exporter"}]'::jsonb, '[]'::jsonb, 1, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: a blank contact sourceKey is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L,
    '[{"sourceKey":"d1","name":"ن","category":"exporter"},
      {"sourceKey":"d1","name":"م","category":"exporter"}]'::jsonb, '[]'::jsonb, 2, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: a duplicate contact sourceKey inside one pack is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb,
    '[{"sourceKey":"t1","recordType":"task","title":"م","payload":{},"contactSourceKey":"src:c:1"},
      {"sourceKey":"t1","recordType":"task","title":"ن","payload":{}}]'::jsonb, 0, 2, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: a duplicate record sourceKey inside one pack is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L,
    '[{"sourceKey":"b1","name":"ن","category":"not_a_category"}]'::jsonb, '[]'::jsonb, 1, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: an invalid contact category is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L,
    '[{"sourceKey":"b2","name":42,"category":"exporter"}]'::jsonb, '[]'::jsonb, 1, 0, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: a non-string contact name is rejected (type validation, not coercion)');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb,
    '[{"sourceKey":"b3","recordType":"not_a_type","title":"م","payload":{}}]'::jsonb, 0, 1, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: an invalid record type is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb,
    '[{"sourceKey":"b4","recordType":"task","title":"م","payload":"a string"}]'::jsonb, 0, 1, '{}'::jsonb) $$,
    :'org', current_setting('test.h2')),
  '22023', null, 'import: a non-object record payload is rejected');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L, '[]'::jsonb,
    '[{"sourceKey":"b5","recordType":"task","title":"م","payload":{},"contactSourceKey":"nope:missing"}]'::jsonb,
    0, 1, '{}'::jsonb) $$, :'org', current_setting('test.h2')),
  '23503', null, 'import: a record linking an UNKNOWN contact sourceKey is rejected');
select is(
  (select count(*)::int from public.marketing_import_run where org_id = :'org'),
  1, 'every rejected import above wrote NO ledger row (only the one good run from §2 exists)');

-- ===== 6) pre-write amount validation leaves no partial import =====
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L,
    '[{"sourceKey":"atomic:c","name":"جهة ذرية","category":"other"}]'::jsonb,
    '[{"sourceKey":"atomic:r","recordType":"exw_bid","title":"عرض","payload":{},"amount":1e20}]'::jsonb,
    1, 1, '{}'::jsonb) $$, :'org', current_setting('test.h2')),
  '22023', null, 'validation: an out-of-range amount is rejected before writes');
select is(
  (select count(*)::int from public.marketing_contact where org_id = :'org' and source_key = 'atomic:c'),
  0, 'atomicity: the contact inserted before the failure was ROLLED BACK (all-or-nothing)');
select is(
  (select count(*)::int from public.marketing_import_run
     where org_id = :'org' and source_hash = current_setting('test.h2')),
  0, 'atomicity: the failed import left NO ledger row');

-- ===== 7) idempotency + manual-edit preservation =====
select is(
  (public.fn_import_marketing_source(:'org', current_setting('test.h1'),
    '[{"sourceKey":"src:c:1","name":"شركة تصدير أ","category":"exporter","selected":true,"metadata":{}},
      {"sourceKey":"src:c:2","name":"موزع الكويت","category":"kuwait_distributor","selected":false,"metadata":{}}]'::jsonb,
    '[]'::jsonb, 2, 0, '{}'::jsonb)->>'idempotent')::boolean,
  true, 'idempotency: a repeated (org, source hash) returns the PRIOR completed run and writes nothing');
select is(
  (select count(*)::int from public.marketing_import_run where org_id = :'org'),
  1, 'idempotency: the repeated import created no second ledger row');

-- a human edits an imported contact, then the same rows arrive again under a NEW hash.
select lives_ok(
  format($$ select public.fn_save_marketing_contact(
    (select id from public.marketing_contact where org_id = %L and source_key = 'src:c:1'),
    null, 'اسم عدّله المستخدم', null, null, null, 'exporter', null, 'ملاحظة يدوية', true) $$, :'org'),
  'a module role edits an imported contact by hand');
select throws_ok(
  format($$ select public.fn_import_marketing_source(%L, %L,
    '[{"sourceKey":"src:c:1","name":"الاسم الأصلي من المصدر","category":"exporter","selected":false,"metadata":{}},
      {"sourceKey":"new:c:3","name":"جهة جديدة","category":"platform","selected":false,"metadata":{}}]'::jsonb,
    '[]'::jsonb, 2, 0, '{}'::jsonb) $$, :'org', current_setting('test.h2')),
  '23505', null, 'a new source hash cannot claim parity over a manually changed source key');
select is(
  (select name from public.marketing_contact where org_id = :'org' and source_key = 'src:c:1'),
  'اسم عدّله المستخدم',
  'source conflict leaves the manual contact edit unchanged');
select is(
  (select count(*)::int from public.marketing_import_run
     where org_id = :'org' and source_hash = current_setting('test.h2')),
  0, 'a conflicting source writes no completion evidence');
select is(
  (public.fn_import_marketing_source(:'org', current_setting('test.h2'),
    '[{"sourceKey":"new:c:3","name":"جهة جديدة","category":"platform","selected":false,"metadata":{}}]'::jsonb,
    '[]'::jsonb, 1, 0, '{}'::jsonb)->'run'->>'imported_contacts')::int,
  1, 'a non-conflicting new source row imports under a new hash');
select is(
  (select existing_contacts from public.marketing_import_run
     where org_id = :'org' and source_hash = current_setting('test.h2')),
  0, 'the new import evidence contains no unverified existing rows');

-- ===== 8) pagination + search: the total is EXACT over the filtered set, not the page =====
select is(
  (public.fn_marketing_contacts_page(:'org', null, null, false, 1, 2)->>'total')::int,
  (select count(*)::int from public.marketing_contact where org_id = :'org' and not archived),
  'pagination: `total` is the exact full filtered count, independent of page size');
select is(
  jsonb_array_length(public.fn_marketing_contacts_page(:'org', null, null, false, 1, 2)->'rows'),
  2, 'pagination: a page of size 2 returns exactly 2 rows');
select is(
  (public.fn_marketing_contacts_page(:'org', null, null, false, 1, 2)->>'pages')::int,
  (select ceil(count(*)::numeric / 2)::int from public.marketing_contact where org_id = :'org' and not archived),
  'pagination: `pages` is derived from the exact total');
select is(
  (public.fn_marketing_contacts_page(:'org', 'موزع الكويت', null, false, 1, 50)->>'total')::int,
  1, 'search: a server-side term matches exactly the one contact whose name contains it');
select is(
  (public.fn_marketing_contacts_page(:'org', null, 'kuwait_distributor', false, 1, 50)->>'total')::int,
  1, 'category filter: exactly the one kuwait_distributor contact');
select is(
  (public.fn_marketing_contacts_page(:'org', 'لا_يوجد_هذا_النص', null, false, 1, 50)->>'total')::int,
  0, 'search: a term with no match returns an exact zero, not every row');
select throws_ok(format($$ select public.fn_marketing_contacts_page(%L, null, null, false, 0, 50) $$, :'org'),
  '22023', null, 'pagination: page 0 is rejected (bounded page)');
select throws_ok(format($$ select public.fn_marketing_contacts_page(%L, null, null, false, 1, 5000) $$, :'org'),
  '22023', null, 'pagination: an unbounded page size is rejected');
select throws_ok(format($$ select public.fn_marketing_contacts_page(%L, null, 'not_a_category', false, 1, 50) $$, :'org'),
  '22023', null, 'pagination: an invalid category filter is rejected');

-- ===== 9) dashboard snapshot: every figure matches a direct count over the same rows =====
select lives_ok(
  format($$ select public.fn_log_marketing_contact_activity(
    (select id from public.marketing_contact where org_id = %L and source_key = 'src:c:2'),
    'call', 'متابعة', now() - interval '2 days', now() - interval '1 day') $$, :'org'),
  'an overdue follow-up is logged against an imported contact');
select is(
  (public.fn_marketing_dashboard_snapshot(:'org')->>'activeContacts')::int,
  (select count(*)::int from public.marketing_contact where org_id = :'org' and not archived),
  'snapshot: activeContacts is exact');
select is(
  (public.fn_marketing_dashboard_snapshot(:'org')->>'selectedContacts')::int,
  (select count(*)::int from public.marketing_contact where org_id = :'org' and not archived and selected),
  'snapshot: selectedContacts is exact');
select is(
  (public.fn_marketing_dashboard_snapshot(:'org')->>'activeRecords')::int,
  (select count(*)::int from public.marketing_record where org_id = :'org' and not archived),
  'snapshot: activeRecords is exact');
select cmp_ok(
  (public.fn_marketing_dashboard_snapshot(:'org')->>'overdueFollowUps')::int,
  '>=', 1, 'snapshot: the overdue follow-up is counted');
select is(
  (public.fn_marketing_dashboard_snapshot(:'org')->'recordsByType'->>'freight_reference')::int,
  1, 'snapshot: recordsByType counts a new full-source type exactly');
select is(
  (select sum(value::int)::int from jsonb_each_text(
     public.fn_marketing_dashboard_snapshot(:'org')->'recordsByType')),
  (select count(*)::int from public.marketing_record where org_id = :'org' and not archived),
  'snapshot: the per-type histogram sums to the exact active-record total');
select is(
  public.fn_marketing_dashboard_snapshot(:'org')->'latestImport'->>'source_hash',
  current_setting('test.h2'), 'snapshot: latestImport reports the most recent completed run');
select cmp_ok(
  jsonb_array_length(public.fn_marketing_dashboard_snapshot(:'org')->'recentActivity'),
  '<=', 10, 'snapshot: recentActivity is bounded (never loads the whole activity log)');
reset role;

-- ===== 10) fn_save_marketing_contact_v2 + audit coverage =====
select pg_temp.as_user(current_setting('test.manager'));
select lives_ok(
  format($$ select set_config('test.v2',
    (public.fn_save_marketing_contact_v2(null, %L, 'جهة عبر v2', null, null, null, 'freight',
      null, null, false, 'v2:contact:1', '{"website":"v2.example"}'::jsonb))->>'id', false) $$, :'org'),
  'fn_save_marketing_contact_v2: farm_manager can create a contact with metadata');
select is(
  (select metadata->>'website' from public.marketing_contact where id = current_setting('test.v2')::uuid),
  'v2.example', 'fn_save_marketing_contact_v2: the metadata object is persisted');
select throws_ok(
  format($$ select public.fn_save_marketing_contact_v2(null, %L, 'جهة', null, null, null, 'other',
    null, null, false, null, '"not an object"'::jsonb) $$, :'org'),
  '22023', null, 'fn_save_marketing_contact_v2: a non-object metadata value is rejected');
reset role;

select cmp_ok(
  (select count(*)::int from public.audit_log
     where entity_type = 'marketing_import_run' and entity_id = current_setting('test.run1')),
  '>=', 1, 'marketing_import_run writes an audit_log row');

select * from finish();
rollback;

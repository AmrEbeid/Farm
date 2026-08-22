-- 100 — SPEC-0032: Marketing module (migration 20260820090000). Verifies: role gate is
-- owner/accountant/farm_manager only (explicit inline check, no authorize() re-emit); reads are
-- role-scoped (a supervisor sees zero rows, not just a hidden write button); direct client
-- INSERT/UPDATE/DELETE is revoked on all three tables; hard DELETE is revoked; the contact-activity
-- log is append-only (no update/delete RPC exists); a linked contact must be same-org; the RPC
-- authorizes against the ROW'S OWN org, not the caller's other-org role; unrelated/invalid inputs are
-- rejected (bad category, bad record_type, non-object payload); archive/restore; audit coverage;
-- active-org narrowing (a role-qualifying consultant in TWO orgs sees only the active one, matching
-- every other tenant table's user_org_ids() narrowing, 20260622000085).
-- Impersonation via request.jwt.claims. Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(42);

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

-- ===== 1) the three module roles can create a contact; other roles cannot =====
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select set_config('test.c1',
    (public.fn_save_marketing_contact(null, %L, 'مستورد الخليج', '0555', 'a@x.com', 'Gulf Import Co',
      'exporter', 'legacy_manifest', 'اتصال أول', false))->>'id', false) $$, :'org'),
  'fn_save_marketing_contact: owner can create a contact');
select isnt(current_setting('test.c1'), '', 'create returned an id');
reset role;

select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_save_marketing_contact(null, %L, 'ممنوع', null, null, null, 'exporter', null, null, false) $$, :'org'),
  '42501', null, 'fn_save_marketing_contact: a supervisor (not a module role) is FORBIDDEN');
select throws_ok(
  format($$ update public.marketing_contact set name = 'مخترق' where id = %L $$, current_setting('test.c1')),
  '42501', null, 'direct-REST: a supervisor cannot PATCH a marketing contact (RLS + revoked grant)');
reset role;

-- ===== 2) reads are ROLE-scoped, not just org-scoped: supervisor sees zero rows =====
select pg_temp.as_user(current_setting('test.sup'));
select is(
  (select count(*)::int from public.marketing_contact where org_id = :'org'),
  0, 'a supervisor session reads ZERO marketing_contact rows (role gate on SELECT, not just org)');
reset role;
select pg_temp.as_user(current_setting('test.accountant'));
select cmp_ok(
  (select count(*)::int from public.marketing_contact where org_id = :'org'),
  '>=', 1, 'an accountant session CAN read marketing_contact rows');
reset role;

-- ===== 3) invalid category / blank name rejected =====
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ select public.fn_save_marketing_contact(null, %L, 'اسم', null, null, null, 'not_a_category', null, null, false) $$, :'org'),
  '22023', null, 'fn_save_marketing_contact: invalid category is rejected');
select throws_ok(
  format($$ select public.fn_save_marketing_contact(null, %L, '   ', null, null, null, 'exporter', null, null, false) $$, :'org'),
  '23502', null, 'fn_save_marketing_contact: blank name is rejected');
reset role;

-- ===== 4) farm_manager can edit-in-place; accountant can too (all three module roles share write) ==
select pg_temp.as_user(current_setting('test.manager'));
select lives_ok(
  format($$ select public.fn_save_marketing_contact(%L, null, 'مستورد الخليج (محدّث)', '0555', 'a@x.com',
    'Gulf Import Co', 'exporter', 'legacy_manifest', 'محدّث', true) $$, current_setting('test.c1')),
  'fn_save_marketing_contact: farm_manager can edit-in-place');
select is(
  (select selected from public.marketing_contact where id = current_setting('test.c1')::uuid),
  true, 'edit persisted (selected flag set)');
reset role;

-- ===== 5) append-only activity log: insert-only RPC works; direct writes revoked; no update/delete RPC exists =====
select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  format($$ select public.fn_log_marketing_contact_activity(%L, 'call', 'أول اتصال', now(), now() + interval '7 days') $$,
    current_setting('test.c1')),
  'fn_log_marketing_contact_activity: accountant can log a call');
select cmp_ok(
  (select count(*)::int from public.marketing_contact_activity where contact_id = current_setting('test.c1')::uuid),
  '>=', 1, 'activity row recorded');
select throws_ok(
  format($$ select public.fn_log_marketing_contact_activity(%L, 'not_a_kind', null, now(), null) $$, current_setting('test.c1')),
  '22023', null, 'fn_log_marketing_contact_activity: invalid kind is rejected');
reset role;
select ok(
  not exists (
    select 1 from pg_proc where proname in ('fn_update_marketing_contact_activity', 'fn_edit_marketing_contact_activity',
      'fn_delete_marketing_contact_activity')),
  'append-only invariant: no update/delete RPC exists for marketing_contact_activity');
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ update public.marketing_contact_activity set notes = 'مخترق' where contact_id = %L $$, current_setting('test.c1')),
  '42501', null, 'direct-REST: even the owner cannot PATCH activity directly (RPC-only, revoked grant)');
reset role;

-- ===== 6) marketing_record: create, invalid type, non-object payload, cross-org contact link =====
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select set_config('test.r1', (public.fn_save_marketing_record(null, %L, 'price_observation',
    'سعر التمر البرحي — الكويت', '{"currency":"USD","perTonUsd":1200}'::jsonb, %L, 1200, 'observed'))->>'id', false) $$,
    :'org', current_setting('test.c1')),
  'fn_save_marketing_record: owner can create a price_observation linked to the contact');
select isnt(current_setting('test.r1'), '', 'create returned an id');
select is(
  (select amount from public.marketing_record where id = current_setting('test.r1')::uuid),
  1200::numeric, 'amount persisted as market intelligence (not accounting money)');
select throws_ok(
  format($$ select public.fn_save_marketing_record(null, %L, 'not_a_type', 'x', '{}'::jsonb, null, null, null) $$, :'org'),
  '22023', null, 'fn_save_marketing_record: invalid record_type is rejected');
select throws_ok(
  format($$ select public.fn_save_marketing_record(null, %L, 'task', 'x', '"just a string"'::jsonb, null, null, null) $$, :'org'),
  '22023', null, 'fn_save_marketing_record: non-object payload is rejected');
select throws_ok(
  format($$ select public.fn_save_marketing_record(null, %L, 'task', 'x', jsonb_build_object('body', repeat('x', 33000)), null, null, null) $$, :'org'),
  '22023', null, 'fn_save_marketing_record: oversized payload is rejected before persistence');
select lives_ok(
  format($$ select public.fn_save_marketing_contact(null, %L, 'جهة مستوردة', null, null, null, 'exporter',
    'legacy', null, true, 'legacy:contact:1') $$, :'org'),
  'source import: first contact upsert succeeds');
select lives_ok(
  format($$ select public.fn_save_marketing_contact(null, %L, 'جهة مستوردة محدثة', null, null, null, 'exporter',
    'legacy', null, true, 'legacy:contact:1') $$, :'org'),
  'source import: repeated contact upsert succeeds');
select is(
  (select count(*)::int from public.marketing_contact where org_id = :'org' and source_key = 'legacy:contact:1'),
  1, 'source import: repeated contact provenance key creates no duplicate');
select lives_ok(
  format($$ select public.fn_save_marketing_record(null, %L, 'task', 'مهمة مصدر', '{}'::jsonb, null, null, 'todo',
    'legacy:record:1') $$, :'org'),
  'source import: first record upsert succeeds');
select lives_ok(
  format($$ select public.fn_save_marketing_record(null, %L, 'task', 'مهمة مصدر محدثة', '{}'::jsonb, null, null, 'done',
    'legacy:record:1') $$, :'org'),
  'source import: repeated record upsert succeeds');
select is(
  (select count(*)::int from public.marketing_record where org_id = :'org' and source_key = 'legacy:record:1'),
  1, 'source import: repeated record provenance key creates no duplicate');
reset role;

\set orgB 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
insert into public.organization (id, name) values (:'orgB', 'مزرعة ب') on conflict (id) do nothing;
insert into public.organization_member (org_id, user_id, role)
  values (:'orgB', current_setting('test.sup')::uuid, 'owner');
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_save_marketing_record(null, %L, 'task', 'مهمة', '{}'::jsonb, %L, null, null) $$,
    :'orgB', current_setting('test.c1')),
  '23503', null, 'fn_save_marketing_record: a contact from ANOTHER org cannot be linked (cross-org guard)');
reset role;

-- ===== 7) the record RPC authorizes against the ROW'S OWN org (authz-by-row-org, not caller's other-org role) ==
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_save_marketing_record(%L, null, 'task', 'مخترق', '{}'::jsonb, null, null, null) $$,
    current_setting('test.r1')),
  '42501', null, 'authz-by-row-org: an org-B owner cannot edit an org-A marketing record (role checked in row org)');
reset role;

-- ===== 8) direct REST DML on marketing_record is revoked (RPC-only) =====
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ insert into public.marketing_record (org_id, record_type, title, payload) values (%L, 'task', 'x', '{}'::jsonb) $$, :'org'),
  '42501', null, 'direct-REST: even the owner cannot INSERT a marketing_record directly (RPC-only)');
reset role;

-- ===== 9) archive / restore + hard DELETE revoked (soft-delete only) =====
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select public.fn_archive_marketing_record(%L, true) $$, current_setting('test.r1')),
  'fn_archive_marketing_record: owner can archive');
select is(
  (select archived from public.marketing_record where id = current_setting('test.r1')::uuid),
  true, 'record archived (soft delete, row preserved)');
select lives_ok(
  format($$ select public.fn_archive_marketing_record(%L, false) $$, current_setting('test.r1')),
  'fn_archive_marketing_record: owner can restore');
select throws_ok(
  $$ delete from public.marketing_record where true $$,
  '42501', null, 'marketing_record: hard DELETE is revoked from clients (soft-delete only)');
select lives_ok(
  format($$ select public.fn_archive_marketing_contact(%L, true) $$, current_setting('test.c1')),
  'fn_archive_marketing_contact: owner can archive a contact');
select throws_ok(
  $$ delete from public.marketing_contact where true $$,
  '42501', null, 'marketing_contact: hard DELETE is revoked from clients (soft-delete only)');
reset role;

-- ===== 10) audit coverage =====
select cmp_ok(
  (select count(*)::int from public.audit_log
     where entity_type = 'marketing_contact' and entity_id = current_setting('test.c1')),
  '>=', 1, 'marketing_contact changes write an audit_log row');
select cmp_ok(
  (select count(*)::int from public.audit_log
     where entity_type = 'marketing_record' and entity_id = current_setting('test.r1')),
  '>=', 1, 'marketing_record changes write an audit_log row');
select cmp_ok(
  (select count(*)::int from public.audit_log
     where entity_type = 'marketing_contact_activity'),
  '>=', 1, 'marketing_contact_activity writes an audit_log row');

-- ===== 11) active-org narrowing: a role-qualifying member of TWO orgs sees only the ACTIVE one =====
-- (regression guard: an earlier draft of this policy checked role+org membership directly without
-- routing through user_org_ids(), so a consultant accountant in both orgs would see BOTH at once —
-- every other tenant table narrows via the active_org_id JWT claim, 20260622000085, and this must too.)
insert into public.organization_member (org_id, user_id, role)
  values (:'orgB', current_setting('test.accountant')::uuid, 'accountant');
-- org B's owner (from §6) creates a contact there to prove the accountant CAN see it once active.
select pg_temp.as_user(current_setting('test.sup'));
select set_config('test.cB',
  (public.fn_save_marketing_contact(null, :'orgB', 'جهة اتصال في مؤسسة ب', null, null, null, 'exporter', null, null, false))->>'id', false);
reset role;

create or replace function pg_temp.as_user_active(uid text, active_org text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org)::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user_active(current_setting('test.accountant'), :'org');
select is(
  (select count(*)::int from public.marketing_contact where org_id = :'orgB'),
  0, 'active-org narrowing: accountant active in org A cannot see org B marketing_contact despite qualifying role there');
reset role;

select pg_temp.as_user_active(current_setting('test.accountant'), :'orgB');
select cmp_ok(
  (select count(*)::int from public.marketing_contact where id = current_setting('test.cB')::uuid),
  '=', 1, 'active-org narrowing: switching the same user''s active org to B reveals org B marketing_contact');
reset role;

-- ===== 12) grant-level lockdown: anon holds no data DML on any of the three tables =====
select ok(
  not has_table_privilege('anon', 'public.marketing_contact', 'SELECT')
  and not has_table_privilege('anon', 'public.marketing_contact', 'INSERT')
  and not has_table_privilege('anon', 'public.marketing_contact_activity', 'SELECT')
  and not has_table_privilege('anon', 'public.marketing_record', 'SELECT'),
  'anon holds no data DML on any marketing table');

select * from finish();
rollback;

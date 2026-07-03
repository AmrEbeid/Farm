-- 116 — SPEC public-website: OS-editable marketing content (migration 20260701420000).
-- Verifies: site.write maps to OWNER ONLY; the authorize() re-emit preserved the full union;
-- fn_save_site_content upserts (owner) and is FORBIDDEN for non-owners; direct client DML is
-- revoked (RPC-only writes); the change is audited. Impersonation via request.jwt.claims.
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(15);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.eng', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'agri_engineer' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ===== 1) site.write = OWNER only =====
select pg_temp.as_user(current_setting('test.owner'));
select is(public.authorize('site.write', :'org'), true, 'site.write: owner HAS it');
select is(public.authorize('export.write', :'org'), true, 'authorize union: owner keeps export.write (re-emit intact)');
select is(public.authorize('labor.write', :'org'), true, 'authorize union: owner keeps labor.write (re-emit intact)');
reset role;
select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('site.write', :'org'), false, 'site.write: farm_manager does NOT');
reset role;
select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('site.write', :'org'), false, 'site.write: accountant does NOT');
select is(public.authorize('finance.read', :'org'), true, 'authorize union: accountant keeps finance.read (re-emit intact)');
reset role;
select pg_temp.as_user(current_setting('test.eng'));
select is(public.authorize('site.write', :'org'), false, 'site.write: agri_engineer does NOT');
reset role;

-- ===== 2) owner upserts content via the RPC =====
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select public.fn_save_site_content(%L, '{"brand":{"name":{"ar":"اختبار","en":"Test"}}}'::jsonb) $$, :'org'),
  'fn_save_site_content: owner can save');
select is(
  (select content->'brand'->'name'->>'en' from public.site_content where org_id = :'org'),
  'Test', 'saved content persisted');
select lives_ok(
  format($$ select public.fn_save_site_content(%L, '{"brand":{"name":{"ar":"مُحدّث","en":"Updated"}}}'::jsonb) $$, :'org'),
  'fn_save_site_content: owner can update (upsert)');
select is(
  (select content->'brand'->'name'->>'en' from public.site_content where org_id = :'org'),
  'Updated', 'upsert replaced the content');
-- a non-object payload is rejected
select throws_ok(
  format($$ select public.fn_save_site_content(%L, '"not an object"'::jsonb) $$, :'org'),
  '22023', null, 'fn_save_site_content: a non-object payload is rejected');
reset role;

-- ===== 3) non-owner is forbidden (RPC gate + direct DML) =====
select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(
  format($$ select public.fn_save_site_content(%L, '{"x":1}'::jsonb) $$, :'org'),
  '42501', null, 'fn_save_site_content: a farm_manager (no site.write) is FORBIDDEN');
select throws_ok(
  format($$ update public.site_content set content = '{"hacked":true}'::jsonb where org_id = %L $$, :'org'),
  '42501', null, 'direct-REST: client UPDATE on site_content is revoked (RPC-only writes)');
reset role;

-- ===== 4) audit =====
select cmp_ok(
  (select count(*)::int from public.audit_log where entity_type = 'site_content'),
  '>=', 1, 'site_content changes write an audit_log row');

select * from finish();
rollback;

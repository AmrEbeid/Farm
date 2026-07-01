-- 112 — bulk-import idempotency, BEHAVIORAL proof (migration 20260701150000). Test 106 only checks the
-- index shape (exists/unique/partial); this proves the actual retry scenario the audit found: the
-- sectors/hawshat import descriptors always call fn_save_sector/fn_save_hawsha with p_id = null (a pure
-- INSERT — see lib/import/descriptors/{sectors,hawshat}.ts), so re-submitting the SAME commit payload
-- (client timeout + retry, or re-uploading the same file) must NOT create a second row for a code that
-- already landed. The partial unique index on (org_id, code) where archived is not true makes the second
-- INSERT fail with 23505 instead of silently duplicating — exactly what the import route already turns
-- into a clean per-row "already exists" error (app/api/import/route.ts, toArabicError 23505).
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('t.farm', (select id::text from public.farms
  where org_id = :'org' order by code limit 1), false);
select set_config('t.mgr', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('t.mgr'));

-- ── sectors: first commit of the row succeeds (p_id = null, same as the import descriptor) ──
select lives_ok(
  format($$ select set_config('t.sec1',
    (public.fn_save_sector(null, %L, 'قطاع #112', 'SEC-112'))->>'id', false) $$,
    current_setting('t.farm')),
  '#112: first import of sector code SEC-112 succeeds (attempt 1)');

-- ── "retry the same file": re-run the identical toRpcArgs call (p_id still null) ──
select throws_ok(
  format($$ select public.fn_save_sector(null, %L, 'قطاع #112', 'SEC-112') $$, current_setting('t.farm')),
  '23505', null, '#112: re-submitting the identical sector row (retry) is rejected, not duplicated');

select is((select count(*)::int from public.sectors where org_id = :'org' and code = 'SEC-112'), 1,
  '#112: exactly ONE sector row exists for the code after the retry (no double-insert)');

-- ── hawshat: same retry scenario, one level down the tree ──
select lives_ok(
  format($$ select set_config('t.haw1',
    (public.fn_save_hawsha(null, %L, 'حوش #112', 'HAW-112'))->>'id', false) $$,
    current_setting('t.sec1')),
  '#112: first import of hawsha code HAW-112 succeeds (attempt 1)');

select throws_ok(
  format($$ select public.fn_save_hawsha(null, %L, 'حوش #112', 'HAW-112') $$, current_setting('t.sec1')),
  '23505', null, '#112: re-submitting the identical hawsha row (retry) is rejected, not duplicated');

reset role;
select * from finish();
rollback;

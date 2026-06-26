-- 49 — #270 H3: writing assets (incl. status) requires op.execute, not just org membership. Before
-- migration 0049 the assets tenant_all policy (0012) was org-only, so a non-op.execute member could
-- PATCH assets.status directly via PostgREST — flipping a sick/dead palm with no role gate and no
-- palm_status_history row (the harms 0039's fn_update_palm_status claims to close). 0049 adds
-- authorize('op.execute', org_id) to the WITH CHECK. The app writes assets ONLY via that definer RPC
-- (bypasses RLS), so the legit path is unaffected. op.execute = owner/farm_manager/agri_engineer/
-- supervisor (0001); accountant/storekeeper lack it. Impersonation via request.jwt.claims.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

select set_config('test.palm', (select id::text from public.assets
  where org_id = '00000000-0000-0000-0000-000000000001' and type = 'palm' order by id limit 1), false);
select set_config('test.supA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'supervisor' limit 1), false);
select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'storekeeper' limit 1), false);

select isnt(current_setting('test.palm'), '', 'fixture: a palm asset exists in orgA');

-- ===== a NON-op.execute member (storekeeper) cannot change a palm's status directly =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ update public.assets set status = 'dead' where id = %L $$, current_setting('test.palm')),
  '42501', null,
  '#270 H3: a storekeeper (no op.execute) cannot change a palm status via direct REST (bypass closed)');

select lives_ok(
  $$ select count(*) from public.assets where org_id = '00000000-0000-0000-0000-000000000001' $$,
  '#270 H3: a storekeeper can still READ assets (USING unchanged)');

reset role;

-- ===== an op.execute member (supervisor) CAN (the legit field-role authority) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.supA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  format($$ update public.assets set status = 'watch' where id = %L $$, current_setting('test.palm')),
  '#270 H3: a supervisor (op.execute) CAN change a palm status (field authority preserved)');

reset role;

select * from finish();
rollback;

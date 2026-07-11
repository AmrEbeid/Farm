-- 139 — Supabase advisor security_definer_view (#229): v_cost_center_rollup + v_cost_center_reconciliation_flags
-- must run with security_invoker so they enforce the CALLER's RLS (no cross-org read via the view). Migration
-- 20260712120000. Proves: (1) both views carry security_invoker; (2) an org-A user sees no org-B rollup rows, and
-- an org-B user sees their own — i.e. the definer bypass is closed. Role-switched (RLS applies off superuser).

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB '00000000-0000-0000-0000-0000000cc139'
\set userB 'bbbb0139-0000-0000-0000-000000000001'
\set ccB   'cccc0139-0000-0000-0000-000000000001'

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select set_config('test.ownerA', (select user_id::text from public.organization_member where org_id=:'orgA' and role='owner' limit 1), false);

-- a second org with an owner member and one cost center (RLS bypassed as superuser for setup)
insert into public.organization (id, name) values (:'orgB', 'مزرعة عزل الاختبار') on conflict (id) do nothing;
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (:'userB', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
  on conflict (id) do nothing;
insert into public.organization_member (org_id, user_id, role) values (:'orgB', :'userB', 'owner') on conflict do nothing;
insert into public.cost_centers (id, org_id, code, name_ar) values (:'ccB', :'orgB', 'CC-B139', 'مركز أورج ب');

-- (1)(2) structural: both views are security_invoker
select is(
  (select option_value from pg_options_to_table((select reloptions from pg_class where oid='public.v_cost_center_rollup'::regclass)) where option_name='security_invoker'),
  'true', 'v_cost_center_rollup runs with security_invoker');
select is(
  (select option_value from pg_options_to_table((select reloptions from pg_class where oid='public.v_cost_center_reconciliation_flags'::regclass)) where option_name='security_invoker'),
  'true', 'v_cost_center_reconciliation_flags runs with security_invoker');

-- (3) an org-A user cannot see org-B rows through the view (cross-org isolation via the caller's RLS)
select pg_temp.as_user(current_setting('test.ownerA'));
select is(
  (select count(*)::int from public.v_cost_center_rollup where org_id = :'orgB'),
  0, 'an org-A user sees NO org-B cost-center rows through v_cost_center_rollup');
reset role;

-- (4) the org-B user DOES see their own row (proves it is real RLS scoping, not a blanket empty)
select pg_temp.as_user(:'userB');
select ok(
  (select count(*)::int from public.v_cost_center_rollup where org_id = :'orgB') >= 1,
  'the org-B user sees their own cost-center row through v_cost_center_rollup');
reset role;

select finish();
rollback;

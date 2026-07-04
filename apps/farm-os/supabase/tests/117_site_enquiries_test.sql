-- 117 — SPEC public-website: buyer enquiries (migration 20260701430000).
-- Verifies: FORCE RLS; OWNER-only read (site.write gate) — a non-owner org member sees nothing;
-- client INSERT is revoked (writes are server-action/service-role only, no anon or authenticated
-- write path). Impersonation via request.jwt.claims. Run via test-shims/run-pgtap-local.sh.

begin;
select plan(6);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- FORCE RLS pin
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.site_enquiries'::regclass),
  true, 'site_enquiries: FORCE RLS is on');

-- seed one enquiry (superuser direct insert — bypasses the client-write revoke + RLS)
insert into public.site_enquiries (org_id, name, message)
  values (:'org', 'Test Importer', 'Need 20 tons of Barhi');

-- OWNER can read
select pg_temp.as_user(current_setting('test.owner'));
select is(
  (select count(*)::int from public.site_enquiries where org_id = :'org'),
  1, 'owner (site.write) reads the org enquiries');
reset role;

-- a non-owner org member reads NOTHING (owner-only gate)
select pg_temp.as_user(current_setting('test.manager'));
select is(
  (select count(*)::int from public.site_enquiries where org_id = :'org'),
  0, 'farm_manager cannot read enquiries (owner-only)');
-- and cannot INSERT via the client (writes are server-action/service-role only)
select throws_ok(
  format($$ insert into public.site_enquiries (org_id, name, message) values (%L, 'x', 'y') $$, :'org'),
  '42501', null, 'client INSERT on site_enquiries is revoked (no authenticated write path)');
reset role;

-- owner also has no client INSERT path (RPC/service-role only)
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ insert into public.site_enquiries (org_id, name, message) values (%L, 'x', 'y') $$, :'org'),
  '42501', null, 'even the owner has no direct client INSERT (server-action only)');
reset role;

-- deliberately NOT audited (owner-restricted PII + org-scoped audit_read would leak; tests/56 class)
select is(
  (select count(*)::int from public.audit_log where entity_type = 'site_enquiries'),
  0, 'site_enquiries is intentionally unaudited (no buyer-PII leak via org-scoped audit_read)');

select * from finish();
rollback;

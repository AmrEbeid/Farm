-- 118 — SPEC public-website: enquiry inbox status management (migration 20260701450000).
-- Verifies fn_set_enquiry_status: owner can set read/archived; a non-owner is FORBIDDEN; an invalid
-- status is rejected; client UPDATE stays revoked. Impersonation via request.jwt.claims.

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

-- seed one enquiry (superuser direct insert bypasses the client-write revoke)
insert into public.site_enquiries (id, org_id, name, message)
  values ('11111111-1111-1111-1111-111111111111', :'org', 'Buyer', 'need dates');

-- owner marks it read, then archived
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  $$ select public.fn_set_enquiry_status('11111111-1111-1111-1111-111111111111', 'read') $$,
  'owner can mark an enquiry read');
select is(
  (select status from public.site_enquiries where id = '11111111-1111-1111-1111-111111111111'),
  'read', 'status persisted as read');
select lives_ok(
  $$ select public.fn_set_enquiry_status('11111111-1111-1111-1111-111111111111', 'archived') $$,
  'owner can archive an enquiry');
-- invalid status rejected
select throws_ok(
  $$ select public.fn_set_enquiry_status('11111111-1111-1111-1111-111111111111', 'bogus') $$,
  '22023', null, 'an invalid status is rejected');
reset role;

-- a non-owner cannot change status (RPC gate) nor UPDATE directly (client revoke)
select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(
  $$ select public.fn_set_enquiry_status('11111111-1111-1111-1111-111111111111', 'new') $$,
  '42501', null, 'a farm_manager cannot change enquiry status (owner-only)');
select throws_ok(
  $$ update public.site_enquiries set status = 'new' where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'client UPDATE on site_enquiries stays revoked');
reset role;

select * from finish();
rollback;

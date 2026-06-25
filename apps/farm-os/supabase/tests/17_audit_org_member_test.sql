-- 17 — AUDIT-1: organization_member changes write an immutable audit_log row (migration 0019).
--
-- Membership = privilege; a join/leave/role-change must be auditable. The generic audit trigger
-- skipped organization_member (composite PK, no `id`), so this pins that the dedicated
-- fn_audit_org_member trigger records it (keyed on the member's user_id, full before/after image),
-- and that audit_log stays append-only for it too (AP-4). Run via `supabase test db`.

begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
select set_config('t.user',
  (select user_id::text from public.organization_member
     where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- A membership change (the trigger fires for any writer; client writes are revoked per HIGH-1, so
-- this runs in the default/superuser context — the same path the server-side invite/relink flow uses).
-- `set role = role` is a no-op value-wise but still fires the AFTER UPDATE row trigger.
update public.organization_member set role = role
  where org_id = :'orgA' and user_id = current_setting('t.user')::uuid;

select isnt(
  (select count(*) from public.audit_log
     where entity_type = 'organization_member'
       and entity_id = current_setting('t.user')
       and action = 'UPDATE'),
  0::bigint,
  'AUDIT-1: an organization_member UPDATE writes an audit_log row');

select is(
  (select before->>'role' from public.audit_log
     where entity_type = 'organization_member'
       and entity_id = current_setting('t.user')
       and action = 'UPDATE'
     order by id desc limit 1),
  'storekeeper',
  'AUDIT-1: the audit before-image captured the membership row');

-- AP-4: audit_log remains append-only — even the superuser path goes through the trigger only;
-- a direct DELETE of the new audit row by an authenticated client is denied at the privilege layer.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.user'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ delete from public.audit_log where entity_type = 'organization_member' $$,
  '42501', null,
  'AP-4: an authenticated client cannot delete organization_member audit rows');
reset role;

select * from finish();
rollback;

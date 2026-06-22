-- AP-4: audit_log is append-only. An approve writes exactly one audit row; the table
-- has no UPDATE/DELETE policy so an authenticated user cannot mutate it.

begin;
select plan(5);

\set orgA '00000000-0000-0000-0000-000000000001'
select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('test.managerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='farm_manager'), false);

-- A PR authored by the manager (so the owner can approve it).
insert into public.purchase_requests (id, org_id, code, requested_by, status)
  values ('eeeeeeee-1111-1111-1111-eeeeeeeeeeee', :'orgA', 'PR-AUDIT-1',
          (select current_setting('test.managerA')::uuid), 'submitted');

-- Impersonate the owner and approve -> AFTER UPDATE trigger writes audit_log.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

select lives_ok($$
  update public.purchase_requests set status='approved'
  where id='eeeeeeee-1111-1111-1111-eeeeeeeeeeee'
$$, 'owner approves the PR (fires audit trigger)');

-- The approve wrote at least one audit row for this PR.
select isnt((select count(*) from public.audit_log
  where entity_type='purchase_request'
    and entity_id='eeeeeeee-1111-1111-1111-eeeeeeeeeeee'
    and action='UPDATE'), 0::bigint, 'an UPDATE audit row exists for the approved PR');

-- The audit row captured the org and is readable by the member.
select is((select before->>'status' from public.audit_log
  where entity_id='eeeeeeee-1111-1111-1111-eeeeeeeeeeee' and action='UPDATE'
  order by id desc limit 1), 'submitted',
  'audit before-image captured the prior status');

-- AP-4: audit_log cannot be mutated by an authenticated user (no UPDATE/DELETE policy).
select throws_ok($$delete from public.audit_log$$, '42501', null,
  'audit_log DELETE denied (immutable by omission)');
select throws_ok($$update public.audit_log set action='TAMPER'$$, '42501', null,
  'audit_log UPDATE denied (immutable by omission)');

reset role;
select * from finish();
rollback;

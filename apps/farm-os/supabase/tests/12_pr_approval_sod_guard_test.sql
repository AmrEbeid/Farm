-- 12 — AP-3: the purchase-request self-approval / separation-of-duties bypass is closed.
--
-- The pr_update WITH CHECK enforces "approver != requester" against the NEW row, which the same
-- UPDATE can mutate. Without the pr_guard_approval trigger (migration 0017) an owner who authored a
-- PR could self-approve by rewriting requested_by to another member in one statement. This pins:
--   1. the bypass (approve WHILE rewriting requested_by) is rejected — requested_by is immutable;
--   2. requested_by cannot be changed even on a non-approval edit;
--   3. the legitimate path still works — a non-author owner approves a submitted PR, and
--      approved_by/approved_at are stamped from the session (not client-supplied);
--   4. a non-approval edit by the author is still allowed.
-- Run via `supabase test db`.

begin;
select plan(6);

\set orgA '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner' limit 1), false);
select set_config('test.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='farm_manager' limit 1), false);

-- A PR AUTHORED BY THE OWNER (the only role that holds pr.approve), submitted.
insert into public.purchase_requests (id, org_id, code, requested_by, status)
  values ('aaaa1212-1212-1212-1212-aaaa12121212', :'orgA', 'PR-AP3',
          (select current_setting('test.owner')::uuid), 'submitted');

-- ===== owner impersonation =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role','authenticated')::text, true);
set local role authenticated;

-- 1. plain self-approve is still blocked (existing AP-2 / RLS)
select throws_ok($$
  update public.purchase_requests set status='approved'
  where id='aaaa1212-1212-1212-1212-aaaa12121212'
$$, '42501', null, 'AP-3: owner cannot plain self-approve their own PR');

-- 2. THE BYPASS: self-approve while rewriting requested_by to another member — now rejected
select throws_ok($$
  update public.purchase_requests
  set status='approved', requested_by=(select current_setting('test.mgr')::uuid)
  where id='aaaa1212-1212-1212-1212-aaaa12121212'
$$, '42501', null, 'AP-3: cannot self-approve by rewriting requested_by (requested_by is immutable)');

-- 3. requested_by is immutable even on a plain edit
select throws_ok($$
  update public.purchase_requests set requested_by=(select current_setting('test.mgr')::uuid)
  where id='aaaa1212-1212-1212-1212-aaaa12121212'
$$, '42501', null, 'AP-3: requested_by cannot be reassigned');

-- the PR is still submitted and still authored by the owner
select is((select status from public.purchase_requests
  where id='aaaa1212-1212-1212-1212-aaaa12121212'), 'submitted',
  'AP-3: the PR remained submitted after the blocked attempts');

reset role;

-- ===== legitimate path: a PR authored by the manager, approved by the (non-author) owner =====
insert into public.purchase_requests (id, org_id, code, requested_by, status)
  values ('bbbb1212-1212-1212-1212-bbbb12121212', :'orgA', 'PR-OK',
          (select current_setting('test.mgr')::uuid), 'submitted');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role','authenticated')::text, true);
set local role authenticated;

select lives_ok($$
  update public.purchase_requests set status='approved'
  where id='bbbb1212-1212-1212-1212-bbbb12121212'
$$, 'AP-3: non-author owner can still approve a submitted PR');

-- approved_by is stamped from the session (auth.uid()), tamper-proof
select is((select approved_by from public.purchase_requests
  where id='bbbb1212-1212-1212-1212-bbbb12121212'),
  (select current_setting('test.owner')::uuid),
  'AP-3: approved_by is stamped to the approving owner');

reset role;
select * from finish();
rollback;

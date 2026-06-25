-- 21 — AP-5 follow-up (migration 0023, issue #76 item 2): a purchase request cannot be born approved.
--
-- pr_guard_approval was BEFORE UPDATE only, so a member could INSERT a born-approved PR and skip the
-- gated approval transition (where requester≠approver is enforced and approved_by/at are session
-- stamped). Migration 0023 extends the guard to BEFORE INSERT. This pins:
--   1. INSERT with status='approved' is rejected;
--   2. INSERT with approved_by pre-stamped is rejected;
--   3. the legitimate path — creating a normal unapproved PR — still works.
-- Run via `supabase test db`.

begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
select set_config('test.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='farm_manager' limit 1), false);

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.mgr'), 'role','authenticated')::text, true);
set local role authenticated;

-- 1. born-approved is rejected
select throws_ok($$
  insert into public.purchase_requests (id, org_id, code, requested_by, status)
  values ('cccc2121-2121-2121-2121-cccc21212121',
          '00000000-0000-0000-0000-000000000001', 'PR-BORN',
          (select current_setting('test.mgr')::uuid), 'approved')
$$, '42501', null, '#76.2: cannot INSERT a born-approved purchase request');

-- 2. pre-stamped approver is rejected (even if status is not yet 'approved')
select throws_ok($$
  insert into public.purchase_requests (id, org_id, code, requested_by, status, approved_by)
  values ('dddd2121-2121-2121-2121-dddd21212121',
          '00000000-0000-0000-0000-000000000001', 'PR-STAMP',
          (select current_setting('test.mgr')::uuid), 'submitted',
          (select current_setting('test.mgr')::uuid))
$$, '42501', null, '#76.2: cannot INSERT a PR with approved_by pre-set');

-- 3. the legitimate path — a normal unapproved PR — still works
select lives_ok($$
  insert into public.purchase_requests (id, org_id, code, requested_by, status)
  values ('eeee2121-2121-2121-2121-eeee21212121',
          '00000000-0000-0000-0000-000000000001', 'PR-OK2',
          (select current_setting('test.mgr')::uuid), 'submitted')
$$, '#76.2: a normal submitted PR can still be created');

reset role;
select * from finish();
rollback;

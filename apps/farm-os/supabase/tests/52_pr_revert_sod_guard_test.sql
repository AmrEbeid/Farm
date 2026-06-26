-- 52 — #270 H4: reverting a DECIDED purchase request to an editable/cancelled state is gated on
-- pr.approve and clears stale approval provenance. Before migration 0052, pr_guard_approval gated only
-- the into-approved transition, so a member (no pr.approve) could PATCH an approved PR back to draft —
-- releasing the 0050 line-lock — edit the lines, and resubmit, laundering content past approval; the
-- row also kept its stale approved_by/approved_at. 0052 blocks the non-approver revert, clears
-- provenance on any revert, and an approver may still revert. The forward receipt path
-- (approved→partially_received, fn_post_receipt) is not a revert and stays green in the oracle (test 45).
-- Impersonation via request.jwt.claims (tests 25/36/42/45/48/51). Decided PRs are seeded as superuser
-- (null-uid: exempt from the guard, a normal service/migration write).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set orgA '00000000-0000-0000-0000-000000000001'
\set pr1  'dddd0052-0000-0000-0000-0000000000a1'
\set pr2  'dddd0052-0000-0000-0000-0000000000a2'

select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

-- two APPROVED PRs (with provenance stamped), seeded as superuser
insert into public.purchase_requests (id, org_id, code, status, requested_by, approved_by, approved_at)
  values
  (:'pr1', :'orgA', 'PR-H4-A1', 'approved', current_setting('test.skA')::uuid,
     current_setting('test.owner')::uuid, now()),
  (:'pr2', :'orgA', 'PR-H4-A2', 'approved', current_setting('test.skA')::uuid,
     current_setting('test.owner')::uuid, now());

-- ===== member (storekeeper, no pr.approve): the revert is an SoD bypass — blocked =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ update public.purchase_requests set status = 'draft' where id = %L $$, :'pr1'),
  '42501', null,
  '#270 H4: a member (no pr.approve) cannot revert an approved PR to draft (SoD-bypass blocked)');

-- born-partially_received insert by a member is rejected (receipt status is never a birth state)
select throws_ok(
  format($$ insert into public.purchase_requests (org_id, code, status)
            values (%L, 'PR-H4-BORN', 'partially_received') $$, :'orgA'),
  '42501', null,
  '#270 H4: a member cannot INSERT a born-partially_received PR');

reset role;

-- ===== approver (owner, has pr.approve): may revert, AND provenance is cleared =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  format($$ update public.purchase_requests set status = 'draft' where id = %L $$, :'pr2'),
  '#270 H4: an approver CAN revert an approved PR');

reset role;

select is(
  (select approved_by from public.purchase_requests where id = :'pr2'),
  null::uuid,
  '#270 H4: reverting a decided PR clears the stale approved_by provenance');

-- structural invariant: the revert SoD predicate is present in the guard
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'pr_guard_approval'
       and regexp_replace(pg_get_functiondef(p.oid), '--.*$', '', 'ng') like '%only an approver can revert a decided purchase request%'),
  1,
  '#270 H4: pr_guard_approval gates the decided→editable revert on pr.approve');

select * from finish();
rollback;

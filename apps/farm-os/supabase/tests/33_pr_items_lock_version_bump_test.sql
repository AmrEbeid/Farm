-- 33 — #160 regression: an approved PR's lines are immutable, draft lines stay editable, and the AP-3
-- optimistic lock works (version bumps). Migration 0032.
--
-- Pre-fix (probe): an accountant (non-approver) could `update purchase_request_items set qty=…` on an
-- APPROVED PR (100 → 10099), and version never incremented (AP-3 guard inert). Run via `supabase test db`.

begin;
select plan(6);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set pot   '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set prD   'ccab1d00-1d00-1d00-1d00-ccab1d001d00'
\set prA   'ccab1a00-1a00-1a00-1a00-ccab1a001a00'
\set prB   'ccab1b00-1b00-1b00-1b00-ccab1b001b00'

-- fixtures (superuser): a DRAFT PR and two APPROVED PRs, each with one line.
insert into public.purchase_requests (id, org_id, code, needed_by, status, version) values
  (:'prD', :'orgA', 'PR-160D', '2025-07-08', 'draft',    1),
  (:'prA', :'orgA', 'PR-160A', '2025-07-08', 'approved', 1),
  (:'prB', :'orgA', 'PR-160B', '2025-07-08', 'approved', 1);
insert into public.purchase_request_items (org_id, pr_id, item_id, qty, unit) values
  (:'orgA', :'prD', :'pot', 10, 'kg'),
  (:'orgA', :'prA', :'pot', 20, 'kg'),
  (:'orgA', :'prB', :'pot', 30, 'kg');

-- ===== accountant (ordinary member, NOT the approver) =====
select set_config('p.acct', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='accountant'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('p.acct'), 'role','authenticated')::text, true);
set local role authenticated;

-- draft line is still editable (not over-restrictive)
select lives_ok($$ update public.purchase_request_items set qty = 11
                   where pr_id = 'ccab1d00-1d00-1d00-1d00-ccab1d001d00' $$,
  '#160: a DRAFT PR line is still editable by a member');

-- approved line cannot be mutated (the confirmed gap)
select throws_ok($$ update public.purchase_request_items set qty = 9999
                    where pr_id = 'ccab1a00-1a00-1a00-1a00-ccab1a001a00' $$,
  '42501', null, '#160: an APPROVED PR line cannot be UPDATEd by a member');

-- ...nor detached/reparented OFF the approved PR onto a draft (reviewer-found bypass: the trigger now
-- checks old.pr_id, so moving a line OFF an approved PR is rejected too)
select throws_ok($$ update public.purchase_request_items set pr_id = 'ccab1d00-1d00-1d00-1d00-ccab1d001d00'
                    where pr_id = 'ccab1a00-1a00-1a00-1a00-ccab1a001a00' $$,
  '42501', null, '#160: an APPROVED PR line cannot be DETACHED (pr_id-rewrite) off the approved PR');

-- ...nor deleted (enforced by the 0027 DELETE revoke AND the trigger as defense-in-depth)
select throws_ok($$ delete from public.purchase_request_items
                    where pr_id = 'ccab1a00-1a00-1a00-1a00-ccab1a001a00' $$,
  '42501', null, '#160: an APPROVED PR line cannot be DELETEd by a member (revoke + trigger)');

reset role;

-- ===== AP-3: version bumps on every PR update (was inert) =====
update public.purchase_requests set status = 'submitted' where id = :'prD';
select is((select version from public.purchase_requests where id = :'prD'),
  2, '#160: purchase_requests.version increments on update (AP-3 optimistic lock is now real)');

-- ===== the legit receipt path is unaffected (reads items, flips status; lock never fires) =====
select set_config('p.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='storekeeper'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('p.store'), 'role','authenticated')::text, true);
set local role authenticated;
select is((public.fn_post_receipt(:'prB') ->> 'status'), 'received',
  '#160: fn_post_receipt still works on an approved PR (lock does not block the receipt path)');
reset role;

select * from finish();
rollback;

-- 15 — RCP-1: the purchase-request receipt path is idempotent at the claim boundary.
--
-- recordReceipt (app/(app)/purchase-requests/[prId]/actions.ts) is a server action = a POST
-- endpoint. Before the fix it posted a `receipt` movement per line item and THEN flipped the PR
-- to `received` with no precondition — so a double-submit / retry / concurrent call re-posted
-- every receipt → phantom stock IN (inventory_bin.on_hand inflated, the ledger corrupted). It is
-- the inverse-direction twin of EXE-1.
--
-- The fix is "claim-first": flip approved→received as the FIRST write, guarded by
-- `status='approved'`, and abort if no row — exactly the predicate asserted here. A second claim
-- of the same PR affects zero rows, so the action returns before posting any receipt. Run via
-- `supabase test db`.

begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
\set pr   'ccab1515-1515-1515-1515-ccab15151515'

select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);

-- an APPROVED PR (requested by the manager, approved by the owner), created as superuser so
-- the claim predicate is what's under test (RLS/policy paths are covered by 01/05/12).
insert into public.purchase_requests (id, org_id, code, requested_by, approved_by, status)
  values (:'pr', :'orgA', 'PR-RCP1',
          current_setting('t.mgr')::uuid, current_setting('t.owner')::uuid, 'approved');

select is((select status from public.purchase_requests where id = :'pr'), 'approved',
  'RCP-1: the PR starts approved (claimable for receipt)');

-- 1st claim: approved -> received, exactly one row (this caller "wins" and posts the receipts)
with c as (
  update public.purchase_requests set status = 'received'
  where id = :'pr' and status = 'approved'
  returning 1)
select set_config('t.c1', (select count(*) from c)::text, false);
select is(current_setting('t.c1')::int, 1,
  'RCP-1: the first receipt claim wins (1 row) — receipts are posted once');

-- 2nd claim (double-submit / retry): NO row, so the action aborts BEFORE re-posting any
-- receipt movement → no phantom stock IN
with c as (
  update public.purchase_requests set status = 'received'
  where id = :'pr' and status = 'approved'
  returning 1)
select set_config('t.c2', (select count(*) from c)::text, false);
select is(current_setting('t.c2')::int, 0,
  'RCP-1: a second claim is rejected (0 rows) — receipts are not re-posted');

select * from finish();
rollback;

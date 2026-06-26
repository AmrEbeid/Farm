-- 51 — #280 F2: a member cannot forge a PR into a receipt status (partially_received/received) to
-- inject phantom on-order supply. Before migration 0051 the pr_update WITH CHECK only gated the
-- into-approved transition, so a member could PATCH a draft PR's status to partially_received and the
-- engine (which projects qty-received_qty for that status) would count it as future supply →
-- shortage=false on a real shortage. 0051 requires the trusted receipt path (fn_post_receipt's GUC
-- marker, or null-uid) for those statuses. The legitimate fn_post_receipt flow is exercised + still
-- green in the partial-receipt oracle (test 45) under this migration. Impersonation via
-- request.jwt.claims (tests 25/36/42/45/48). The draft PR is seeded as superuser (null-uid: exempt
-- from pr_guard_approval's into-approved checks — a normal draft creation).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set pr   'dddd0051-0000-0000-0000-0000000000a1'

select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- seed a DRAFT PR (the editable state a member legitimately owns)
insert into public.purchase_requests (id, org_id, code, status)
  values (:'pr', :'orgA', 'PR-F2-0051', 'draft');

-- ===== a member (storekeeper, no pr.approve) — the forged receipt transition is blocked =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ update public.purchase_requests set status = 'partially_received' where id = %L $$, :'pr'),
  '42501', null,
  '#280 F2: a member cannot PATCH a PR to partially_received (forged phantom-supply blocked)');

select throws_ok(
  format($$ update public.purchase_requests set status = 'received' where id = %L $$, :'pr'),
  '42501', null,
  '#280 F2: a member cannot PATCH a PR to received either');

-- regression: a normal editable transition (draft → submitted) still works for the member
select lives_ok(
  format($$ update public.purchase_requests set status = 'submitted' where id = %L $$, :'pr'),
  '#280 F2: a member CAN still submit a draft PR (normal editable transition unaffected)');

reset role;

-- structural invariant: the receipt-state gate is present
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'purchase_requests' and policyname = 'pr_update'
       and with_check like '%posting_receipt%'),
  1,
  '#280 F2: pr_update WITH CHECK gates partially_received/received on the trusted receipt path');

select * from finish();
rollback;

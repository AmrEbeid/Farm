-- 48 — #270 C3: a `partially_received` PR's lines are write-frozen (no qty inflation → no shortage-mask),
-- while the trusted received_qty receipt path still works. Before migration 0048 the lock trigger only
-- guarded ('approved','received'), so a member could PATCH purchase_request_items SET qty=qty+N on a
-- partially_received line and the engine (which projects qty-received_qty for partially_received) would
-- count phantom future supply → shortage=false. 0048 adds 'partially_received' to both guard sets.
-- Impersonation via request.jwt.claims (tests 25/36/42/45). Seed rows are inserted as the harness
-- superuser (auth.uid() null → lock-exempt), exactly how a real partial receipt reaches this state.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set pr    'cccc0048-0000-0000-0000-0000000000a1'
\set line  'cccc0048-0000-0000-0000-0000000000b1'

select set_config('test.item', (select id::text from public.inventory_items
  where org_id = :'orgA' order by id limit 1), false);
select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- seed a partially_received PR + line (as superuser: auth.uid() null ⇒ lock/SoD-exempt — the real
-- state fn_post_receipt produces after a partial receive: qty 500, received 200).
insert into public.purchase_requests (id, org_id, code, status)
  values (:'pr', :'orgA', 'PR-C3-0048', 'partially_received');
insert into public.purchase_request_items (id, org_id, pr_id, item_id, qty, received_qty, unit)
  values (:'line', :'orgA', :'pr', current_setting('test.item')::uuid, 500, 200, 'kg');

-- ===== a member (storekeeper) cannot inflate qty on the partially_received line (the fix) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ update public.purchase_request_items set qty = qty + 100000 where id = %L $$, :'line'),
  '42501', null,
  '#270 C3: a member cannot inflate qty on a partially_received PR line (shortage-mask closed)');

-- a member also cannot touch received_qty (column UPDATE is revoked from authenticated in 0045, and the
-- lock would block it without the GUC anyway) — the line is FULLY frozen to members. The legitimate
-- received-advance path is the SECURITY DEFINER fn_post_receipt (runs as owner + sets the GUC), which is
-- exercised + still green in the partial-receipt oracle (test 45) under this same migration.
select throws_ok(
  format($$ update public.purchase_request_items set received_qty = received_qty + 100 where id = %L $$, :'line'),
  '42501', null,
  '#270 C3: a member cannot change received_qty on a partially_received line either (fully frozen)');

reset role;

-- ===== structural invariant: the guard now covers partially_received =====
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fn_pr_items_lock_when_decided'
       and pg_get_functiondef(p.oid) like '%partially_received%'),
  1,
  '#270 C3: fn_pr_items_lock_when_decided guards partially_received');

select * from finish();
rollback;

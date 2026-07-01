-- 111 — #216 Finding-2 (masked shortage via the supply funnel, migration 20260701210000). fn_post_receipt
-- used to pass the PR-line unit (coalesce(pri.unit,'kg')); for a non-kg item with a null/mismatched line unit
-- the supply funnel (#216) rejected the receipt → the PR stuck 'approved' → the engine projected phantom
-- forward supply that never arrives → masked shortage. The fix passes null so the funnel defaults to the
-- item's canonical unit. Run via `supabase test db` / test-shims/run-pgtap-local.sh.
begin;
select plan(3);
\set orgA  '00000000-0000-0000-0000-000000000001'
\set itemL 'c0000000-0000-0000-0000-000000000216'
\set prL   'ccab4242-4242-4242-4242-ccab42160001'
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

-- a non-kg (litre) item, on_hand 0
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'itemL', :'orgA', 'صنف لتر استلام', 'L', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'itemL', 'main', 0, 0, 0, 0);

-- an approved PR (inserted as superuser, before any JWT — the pr_guard_approval SoD guard blocks a
-- born-approved PR for a real authenticated caller) with a line whose unit is NULL: the masking case.
insert into public.purchase_requests (id, org_id, code, needed_by, requested_by, approved_by, status)
  values (:'prL', :'orgA', 'PR-216-L', current_date,
          current_setting('t.mgr')::uuid, current_setting('t.owner')::uuid, 'approved');
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values (:'prL', :'orgA', :'itemL', 10, null);

-- receive it as the storekeeper (has inventory.write)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_post_receipt(:'prL')::text, false);
reset role;

select is((select on_hand from public.inventory_bin where item_id = :'itemL' and location='main'), 10::numeric,
  '#216 Finding-2: a receipt on a non-kg PR line with a null unit POSTS (no funnel reject → no stuck PR)');
select is((select status from public.purchase_requests where id = :'prL'), 'received',
  '#216 Finding-2: the PR flips to received (not stuck approved → no phantom supply → no masked shortage)');
select is(
  (select unit from public.inventory_movements where item_id = :'itemL' and type='receipt' order by ctid desc limit 1),
  'L', '#216 Finding-2: the receipt movement is labelled the item unit (L), not the hardcoded kg fallback');

select * from finish();
rollback;

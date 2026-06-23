-- 05 — regression tests for the 2026-06-23 security remediation (migration 0010).
-- Run via `supabase test db`. Each assertion pins one finding so a regression fails CI.
--   GRANT-C1 / ENGINE-guard : anon (unauthenticated) has no table/function access.
--   ENGINE-C1               : expiry is netted into available exactly once, not twice.
--   ENGINE-H1               : ample stock + zero demand -> no phantom purchase.
--   RLS-H1                  : a child row cannot reference a foreign-org parent.

begin;
select plan(8);

\set orgA '00000000-0000-0000-0000-000000000001'

-- ===== GRANT-C1 / ENGINE-guard: the public anon role has no access =====
select is(
  has_function_privilege('anon', 'public.fn_stock_coverage(uuid,text,int)', 'execute'),
  false, 'GRANT-C1: anon cannot EXECUTE fn_stock_coverage (no unauthenticated RPC)');
select is(
  has_table_privilege('anon', 'public.inventory_items', 'select'),
  false, 'GRANT-C1: anon cannot SELECT inventory_items');
select is(
  has_table_privilege('anon', 'public.inventory_movements', 'insert'),
  false, 'GRANT-C1: anon cannot INSERT inventory_movements');
-- authenticated keeps its grant — RLS, not the privilege layer, is its tenant boundary.
select is(
  has_function_privilege('authenticated', 'public.fn_stock_coverage(uuid,text,int)', 'execute'),
  true, 'authenticated retains EXECUTE on fn_stock_coverage');

-- ===== fixtures (created as the superuser test role, RLS-bypassing) =====
-- ENGINE-C1 item: on_hand 250 already nets a 50kg expiry (receipt 300 − expiry 50),
-- so SC-6 (Σ signed movements == on_hand) holds: 300 − 50 = 250.
\set expitem 'aaaa0001-0000-0000-0000-0000000000ee'
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'expitem', :'orgA', 'صنف اختبار انتهاء الصلاحية', 'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'expitem', 'main', 250, 0, 0, 250);
insert into public.inventory_movements (org_id, item_id, type, qty, location, occurred_at) values
  (:'orgA', :'expitem', 'receipt', 300, 'main', '2025-06-01'),
  (:'orgA', :'expitem', 'expiry',   50, 'main', '2025-06-15');

-- RLS-H1: the seed has no farm_event rows; create an org-A event and an org-B event.
insert into public.organization (id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','مزرعة أخرى');
insert into public.farm_event (id, org_id, type, occurred_at) values
  ('a0000000-0000-0000-0000-0000000000a1', :'orgA', 'note', '2025-07-15'),
  ('b0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'note', '2025-07-15');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);

-- ===== impersonate the org-A owner (authenticated); RLS + the engine guard apply =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- ENGINE-C1: available = on_hand 250 − reserved 0 = 250 (expiry netted ONCE).
-- The pre-fix bug double-subtracted the 50kg expiry and returned 200.
select is(
  (public.fn_stock_coverage(:'expitem', 'main', 8)::jsonb ->> 'available')::numeric,
  250::numeric, 'ENGINE-C1: expiry netted exactly once (available 250, not 200)');

-- ENGINE-H1: يوريا — on_hand 140, SS 60, zero planned demand → no shortage, no order.
-- The pre-fix bug recommended ordering up to safety stock (100kg) despite ample stock.
select is(
  (public.fn_stock_coverage('761c43f2-011b-598b-80cf-96abc48881cb', 'main', 8)::jsonb ->> 'recommend_qty')::numeric,
  0::numeric, 'ENGINE-H1: ample stock + zero demand → recommend_qty 0 (no phantom order)');

-- RLS-H1: org A cannot attach a child (quantities) to org B's event, even when the
-- child row is tagged with org A's own org_id. WITH CHECK now validates the parent's org.
select throws_ok($$
  insert into public.quantities (org_id, event_id, measure, value_num)
  values ('00000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-0000000000b1', 'weight', 99)
$$, '42501', null, 'RLS-H1: child row referencing a foreign-org parent is denied');

-- Legit case unaffected: an org-A child on an org-A parent is still allowed.
select lives_ok($$
  insert into public.quantities (org_id, event_id, measure, value_num)
  values ('00000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000a1', 'weight', 99)
$$, 'RLS-H1: child row on a same-org parent is allowed');

reset role;
select * from finish();
rollback;

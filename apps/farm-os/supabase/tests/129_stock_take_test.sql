-- 129 — fn_record_stock_take (جرد reconciliation, migration 20260705160000, SPEC-0030 Phase 4).
-- Pins: reconciling on_hand to a physical COUNT — a higher count posts an 'adjustment' inflow, a lower count
-- posts a 'loss' outflow, a matching count posts nothing; the gate (inventory.write only, anon locked); and
-- the honest/floor behavior (a lower count can never drive on_hand negative). Impersonation via
-- request.jwt.claims WITHOUT `set role` (test 07's pattern — superuser calls the SECURITY DEFINER fn directly;
-- the authorize()/org guard still reads the JWT GUC).
--
-- The starting on_hand MUST be ledger-backed (a real receipt), not a bare inventory_bin insert: fn_post_movement
-- calls fn_bin_rebuild, which recomputes on_hand as the SUM of movements — a directly-seeded on_hand with no
-- backing movement would be discarded on the first reconciling post. In production on_hand is always this sum.
-- Run via test-shims/run-pgtap-local.sh.
begin;
select plan(14);

\set org '00000000-0000-0000-0000-000000000001'
\set ti  'c1290000-0000-0000-0000-0000000000a1'
\set ti2 'c1290000-0000-0000-0000-0000000000a2'

insert into public.inventory_items (id, org_id, name, unit) values (:'ti', :'org', 'سماد اختبار الجرد', 'كجم');
-- a second item with NO movements and NO bin, to exercise the missing-bin path (the FOR UPDATE must serialize).
insert into public.inventory_items (id, org_id, name, unit) values (:'ti2', :'org', 'صنف بلا حركة', 'كجم');

select set_config('test.owner',
  (select user_id::text from public.organization_member where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant',
  (select user_id::text from public.organization_member where org_id = :'org' and role = 'accountant' limit 1), false);

-- ── act as the OWNER (has inventory.write) ──
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);

-- Ledger-backed starting stock: a receipt of 10 → on_hand 10 (bin auto-created from the ledger).
select public.fn_post_movement(:'ti', 'receipt', 10, 'main');

-- 1) count MATCHES the system (10 = 10) → returns 10, posts NO reconciling movement.
select is(public.fn_record_stock_take(:'ti', 10, 'main'), 10::numeric, 'matching count returns 10');
select is((select on_hand from public.inventory_bin where item_id = :'ti'), 10::numeric, 'matching count leaves on_hand 10');
select is((select count(*)::int from public.inventory_movements where item_id = :'ti' and type in ('adjustment', 'loss')), 0,
  'matching count posts NO reconciling movement (nothing to reconcile)');

-- 2) count HIGHER than the system (15 > 10) → 'adjustment' inflow of +5 → on_hand 15.
select is(public.fn_record_stock_take(:'ti', 15, 'main'), 15::numeric, 'higher count returns 15');
select is((select on_hand from public.inventory_bin where item_id = :'ti'), 15::numeric, 'higher count raises on_hand to 15');
select ok(exists(select 1 from public.inventory_movements where item_id = :'ti' and type = 'adjustment' and qty = 5),
  'higher count posts an adjustment inflow of the +5 variance');

-- 3) count LOWER than the system (6 < 15) → 'loss' outflow of |−9| → on_hand 6 (reveals shrinkage; floors ok).
select is(public.fn_record_stock_take(:'ti', 6, 'main'), 6::numeric, 'lower count returns 6');
select is((select on_hand from public.inventory_bin where item_id = :'ti'), 6::numeric, 'lower count lowers on_hand to 6');
select ok(exists(select 1 from public.inventory_movements where item_id = :'ti' and type = 'loss' and qty = 9),
  'lower count posts a loss outflow of the 9 variance');

-- 3b) MISSING-BIN path: an item with no prior movements → the RPC creates the bin (insert-on-conflict before
-- the FOR UPDATE) and reconciles it to the count. A higher count on on_hand 0 posts an 'adjustment' of +7.
select is(public.fn_record_stock_take(:'ti2', 7, 'main'), 7::numeric, 'stock-take on a bin-less item returns 7');
select is((select on_hand from public.inventory_bin where item_id = :'ti2'), 7::numeric,
  'stock-take on a bin-less item creates the bin at on_hand 7');

-- 4) a negative count is rejected.
select throws_ok(format($$ select public.fn_record_stock_take(%L, -1, 'main') $$, :'ti'),
  '22023', null, 'reject a negative counted qty');

-- ── act as the ACCOUNTANT (no inventory.write) → rejected ──
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.accountant'), 'role', 'authenticated')::text, true);
select throws_ok(format($$ select public.fn_record_stock_take(%L, 20, 'main') $$, :'ti'),
  '42501', null, 'a role without inventory.write cannot record a stock-take');

-- 5) anon EXECUTE lockdown.
select ok(not has_function_privilege('anon', 'public.fn_record_stock_take(uuid, numeric, text)', 'EXECUTE'),
  'anon cannot EXECUTE fn_record_stock_take');

select * from finish();

-- 109 — #216 unit reconciliation, supply side (migration 20260701180000). The fn_post_movement funnel now
-- DEFAULTS a null unit to the item's canonical unit and REJECTS a non-null mismatch, so on_hand is always
-- accumulated in one unit. fn_reserve_stock passes null → inherits the item unit (was a hardcoded 'kg').
-- Run via test-shims/run-pgtap-local.sh.
-- NOTE: no inline comment on \set lines — psql appends the rest of the line into the value.
-- K = سلفات بوتاسيوم (kg); L = مبيد فطري (L).
\set K '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set L '21f793b6-58f8-5607-9b0b-49581ae52b27'

begin;
select plan(4);

-- 1) a movement whose unit differs from the item's canonical unit is REJECTED (never silently miscounted)
select throws_ok(
  format($$ select public.fn_post_movement(%L, 'receipt', 100, 'main', 'g') $$, :'K'),
  '22023', null, '#216: a g receipt on a kg item is rejected');

-- 2) a null unit inherits the item's canonical unit (default, not a hardcoded constant)
select public.fn_post_movement(:'L', 'receipt', 5, 'main', null);
select is(
  (select unit from public.inventory_movements where item_id = :'L' order by occurred_at desc, ctid desc limit 1),
  'L', '#216: a null-unit movement inherits the item unit (L)');

-- 3) a matching unit is accepted
select lives_ok(
  format($$ select public.fn_post_movement(%L, 'receipt', 10, 'main', 'kg') $$, :'K'),
  '#216: a matching kg receipt is accepted');

-- 4) the funnel default that fn_reserve_stock now relies on: a null-unit 'reserve' movement on an L item is
--    labelled L, not 'kg'. (fn_reserve_stock passes null → this exact funnel path; the wrapper's authz gate is
--    covered separately in tests/37. The 'kg'→null swap is a trivial constant verified by that delegation.)
select public.fn_post_movement(:'L', 'reserve', 3, 'main', null);
select is(
  (select unit from public.inventory_movements where item_id = :'L' and type = 'reserve' order by occurred_at desc, ctid desc limit 1),
  'L', '#216: a null-unit reserve on an L item is labelled L via the funnel default (was hardcoded kg)');

select * from finish();
rollback;

-- 14 — ENGINE-DC: a RECEIVED receipt must not be double-counted (regression for migration 0018).
--
-- Before the fix, fn_stock_coverage projected `receipt` movements dated >= period_start forward while
-- fn_bin_rebuild had already summed them into on_hand → counted twice → PAB optimistic, could HIDE a
-- real shortage (SPEC-0001 #1 risk). Migration 0018 sources scheduled receipts from approved purchase
-- requests (open POs) instead of the actual-movement ledger, so a `receipt` movement is ONLY in
-- on_hand and never re-projected. Full finding: SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md.
--
-- This pins it: a received +100 (a receipt movement, with no matching open PR) raises the forward PAB
-- by exactly 100 via on_hand — once, not twice — and the real period-1 shortage is not masked.

begin;
select plan(2);

\set orgA '00000000-0000-0000-0000-000000000001'
select set_config('t.item',
  (select id::text from public.inventory_items where org_id = :'orgA' and name ilike '%بوتاس%' limit 1), false);

-- baseline forward PAB at period 2 (pristine seed: on_hand 300, period-1 demand 500 → -200)
select set_config('t.pab2_base',
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->'pab'->>1), false);

-- receive 100 kg dated AFTER period_start (2025-07-08) → it lands in on_hand via the rebuild
insert into public.inventory_movements (org_id, item_id, type, qty, location, occurred_at)
  values (:'orgA', current_setting('t.item')::uuid, 'receipt', 100, 'main', '2025-07-10T00:00:00+00:00');
select public.fn_bin_rebuild(current_setting('t.item')::uuid, 'main');

select set_config('t.pab2_new',
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->'pab'->>1), false);

-- a received +100 must raise forward PAB by its qty ONCE (100), not twice (200)
select is(
  current_setting('t.pab2_new')::numeric - current_setting('t.pab2_base')::numeric,
  100::numeric,
  'ENGINE-DC: a received receipt raises forward PAB by its qty once, not twice');

-- and with 400 on-hand vs 500 demand, the real shortage must NOT be masked
select is(
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->>'shortage')::boolean,
  true,
  'ENGINE-DC: the receipt does not mask the real period-1 shortage');

select * from finish();
rollback;

-- 14 — ENGINE-DC (KNOWN BUG, wrapped in TODO until fixed): scheduled receipts are double-counted.
--
-- fn_bin_rebuild sums ALL receipt movements into on_hand (no date filter), while fn_stock_coverage
-- ALSO projects receipts dated >= period_start forward in the PAB recurrence. So a receipt on/after
-- period_start (already physically in on_hand) is counted TWICE — once in `available`, once forward —
-- making PAB optimistic and able to HIDE a real shortage (the core wedge's whole purpose; SPEC-0001
-- #1 risk). Full finding + fix directions: SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md.
--
-- This pins the correct behaviour: a received +100 must raise the forward PAB by exactly 100 (counted
-- once), not 200, and must not erase the period's real shortage. It currently FAILS (the bug), so it
-- is wrapped in todo_start/todo_end — pgTAP reports the failures as expected (TODO) and the suite
-- stays green. When ENGINE-DC is fixed the asserts pass; remove the TODO wrapper then. Run via
-- `supabase test db` (or the shim harness, which now honors the TODO directive).

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

select todo_start('ENGINE-DC: scheduled-receipt double-count not yet fixed');

-- a received +100 must raise forward PAB by its qty ONCE (100), not twice (200)
select is(
  current_setting('t.pab2_new')::numeric - current_setting('t.pab2_base')::numeric,
  100::numeric,
  'ENGINE-DC: a received receipt raises forward PAB by its qty once, not twice');

-- and with 400 on-hand vs 500 demand, the real shortage must NOT be masked
select is(
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->>'shortage')::boolean,
  true,
  'ENGINE-DC: the double-counted receipt does not mask the real period-1 shortage');

select todo_end();

select * from finish();
rollback;

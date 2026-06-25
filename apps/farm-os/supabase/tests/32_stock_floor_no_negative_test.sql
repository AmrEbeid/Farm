-- 32 — #159 regression: on_hand has a floor at 0. fn_post_movement rejects an OUTFLOW that exceeds
-- current physical stock (migration 0031), so an issue/loss/expiry/transfer can no longer drive
-- on_hand negative — which the coverage engine would otherwise trust (probe: issue 999999 against
-- on_hand 100 → on_hand −999899 → fn_stock_coverage recommended buying 999899). Run via `supabase test db`.

begin;
select plan(6);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set item  'c0000000-0000-0000-0000-000000000159'

-- fixtures (superuser): item seeded to on_hand 100 via a legit receipt through the ledger.
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'صنف 159', 'kg', 1, 0, 5);
select is(public.fn_post_movement(:'item', 'receipt', 100), 100::numeric,
  '#159: receipt of 100 sets on_hand to 100 (inflows unaffected)');

-- ── over-issue is REJECTED (was silently negative pre-0031) ───────────────────────────────────────
select throws_ok(
  $$ select public.fn_post_movement('c0000000-0000-0000-0000-000000000159', 'issue', 999999) $$,
  '23514', null,
  '#159: an issue exceeding on_hand is rejected (insufficient stock) — no negative on_hand');
-- and the rejected over-issue left the balance intact
select is((select on_hand from public.inventory_bin where item_id = :'item' and location='main'),
  100::numeric, '#159: the rejected over-issue posted nothing (on_hand still 100)');

-- ── a legitimate issue WITHIN stock still works (no false block) ──────────────────────────────────
select is(public.fn_post_movement(:'item', 'issue', 40), 60::numeric,
  '#159: a legit issue within stock works (on_hand 100 → 60)');
-- issuing exactly the remaining balance is allowed (boundary: on_hand → 0, not negative)
select is(public.fn_post_movement(:'item', 'issue', 60), 0::numeric,
  '#159: issuing the exact remaining balance is allowed (on_hand → 0)');

-- ── other outflow types are floored too (loss beyond 0 rejected) ──────────────────────────────────
select throws_ok(
  $$ select public.fn_post_movement('c0000000-0000-0000-0000-000000000159', 'loss', 1) $$,
  '23514', null,
  '#159: a loss against on_hand 0 is rejected (floor applies to all outflow types)');

select * from finish();
rollback;

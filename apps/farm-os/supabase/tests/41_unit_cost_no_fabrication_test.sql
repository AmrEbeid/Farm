-- #89 (Option C): inventory_items.unit_cost is the honest standard-cost source for PR est_cost.
-- Schema + data invariants proving we DON'T fabricate financial data (non-negotiable #1):
--   (a) potassium sulfate carries its real, known price (84) after seed;
--   (b) at least one OTHER item has unit_cost NULL — an unknown price stays unknown, not invented;
--   (c) the column exists and is numeric.
-- Style mirrors 03_seed_invariants: superuser, run against the applied migrations + seed.

begin;
select plan(4);

-- (c) the column exists and is numeric (so qty * unit_cost is real arithmetic, not a cast hack).
select has_column('public', 'inventory_items', 'unit_cost', 'inventory_items.unit_cost exists');
select col_type_is('public', 'inventory_items', 'unit_cost', 'numeric',
  'inventory_items.unit_cost is numeric');

-- (a) potassium sulfate has its KNOWN real price (Ebeid ~84 ج.م/kg) — keeps the wedge est_cost real.
select is(
  (select unit_cost from public.inventory_items where id = '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'),
  84::numeric,
  'potassium sulfate unit_cost == 84 (its real known price)');

-- (b) at least one OTHER item has unit_cost NULL — proves unknown prices stay NULL, never fabricated.
select cmp_ok(
  (select count(*) from public.inventory_items
     where unit_cost is null
       and id <> '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'),
  '>=', 1::bigint,
  'at least one item has unit_cost NULL (unknown price is honest, not fabricated)');

select * from finish();
rollback;

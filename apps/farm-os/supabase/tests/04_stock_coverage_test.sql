-- Phase C — stock-coverage engine parity + reconciliation (SPEC-0001 oracle).
-- Run via `supabase test db`. Asserts fn_stock_coverage reproduces the SPEC-0001
-- worked Ebeid example, that it matches the TS pure-calc core for the same inputs
-- (so SQL and TS cannot drift), and the inventory_bin reconciliation invariant
-- Σ(movements per item×location) == inventory_bin.on_hand (SC-6).
--
-- The engine is security-definer + org-scoped, so we impersonate the Ebeid owner
-- (request.jwt.claims + `set role authenticated`) exactly like the RLS test.

begin;
select plan(11);

\set orgA '00000000-0000-0000-0000-000000000001'
\set potassium '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);

-- ---- SC-6 reconciliation (run as superuser, before impersonating) ----
-- inventory_bin.on_hand must equal the signed sum of movements for every item×location.
select is(
  (select count(*) from public.inventory_bin b
   where b.on_hand <> (
     select coalesce(sum(case
       when m.type in ('receipt','return','adjustment') then m.qty
       when m.type in ('issue','loss','expiry','transfer') then -m.qty
       else 0 end), 0)
     from public.inventory_movements m
     where m.item_id = b.item_id and m.location = b.location)),
  0::bigint,
  'SC-6: every inventory_bin.on_hand == Σ(signed movements)');

-- fn_bin_rebuild reproduces the seeded on_hand for potassium from the ledger.
select is(
  public.fn_bin_rebuild(:'potassium', 'main'),
  300::numeric,
  'fn_bin_rebuild(potassium,main) recomputes on_hand 300 from movements');

-- ===================================================================
-- Impersonate the Ebeid owner (authenticated) — the engine org-check passes.
-- ===================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- The engine output for the potassium scenario.
select set_config('test.cov',
  public.fn_stock_coverage(:'potassium', 'main', 8)::text, true);

-- available = on_hand 300 − reserved 0 − expired 0 = 300
select is(
  (current_setting('test.cov')::jsonb ->> 'available')::numeric,
  300::numeric, 'available == 300 (oracle)');

-- PAB(1) = 300 − 500 = −200 (period 1; the planned 500kg fert op next week)
select is(
  (current_setting('test.cov')::jsonb -> 'pab' ->> 1)::numeric,
  -200::numeric, 'PAB(1) == -200 (oracle)');

-- first shortage flagged in period 1
select is(
  (current_setting('test.cov')::jsonb ->> 'first_shortage_period')::int,
  1, 'first shortage period == 1 (oracle)');

-- shortage flag is true
select is(
  (current_setting('test.cov')::jsonb ->> 'shortage')::boolean,
  true, 'shortage flagged true');

-- coverage days ≈ 4.2 (< 5-day lead)
select cmp_ok(
  (current_setting('test.cov')::jsonb ->> 'coverage_days')::numeric,
  '<', 5::numeric, 'coverage days < 5-day lead');
select cmp_ok(
  round((current_setting('test.cov')::jsonb ->> 'coverage_days')::numeric, 1),
  '=', 4.2::numeric, 'coverage days ≈ 4.2 (oracle)');

-- recommended purchase: shortfall 200 + SS 74 = 274 → round up to pack 50 → 300
select is(
  (current_setting('test.cov')::jsonb ->> 'recommend_qty')::numeric,
  300::numeric, 'recommend_qty == 300 kg (oracle)');

-- Arabic-first message contains the shortage phrase
select ok(
  (current_setting('test.cov')::jsonb ->> 'message_ar') like '%نقص متوقع%',
  'message_ar contains «نقص متوقع» (Arabic-first output)');

-- Parity with lib/stock-calc.ts: reorderPoint(500/7, 5, 74) rounds to 431 — the same
-- value the TS oracle asserts. Binds the SQL fn to the pure core so they cannot drift.
select is(
  round((current_setting('test.cov')::jsonb ->> 'reorder_point')::numeric),
  431::numeric, 'reorder_point ≈ 431 — parity with TS stock-calc core');

reset role;
select * from finish();
rollback;

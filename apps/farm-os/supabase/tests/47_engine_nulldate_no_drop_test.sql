-- 47 — #198 (ENGINE-NULLDATE-1) regression: a planned op with a NULL planned_at must NOT have its
-- material demand silently dropped from fn_stock_coverage. plan_operations.planned_at is nullable; with
-- raw po.planned_at the demand bucket and the `<= p_horizon_weeks` filter both go NULL for a null-dated
-- op, EXCLUDING the row and masking a real shortage. Migration 0047 conservatively treats a null date as
-- IMMEDIATE (coalesce(po.planned_at, v_period_start) → period 1), so the demand is counted, never lost.
-- Test-only, self-contained fixture in org A, created as the superuser then read as the authenticated
-- owner (the engine is org-scoped). begin/rollback — no committed state. Run via `supabase test db`.
--
-- WITHOUT THE FIX this fixture would report shortage=false / recommend_qty=0 (the null-dated 300kg demand
-- is dropped, the projection never falls below 0). The assertions below prove the demand IS counted.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'

-- one active plan to hang the (undated) demand op on — counted by the engine.
insert into public.plans (id, org_id, type, period_start, status)
  values ('eeee0000-0000-0000-0000-00000000e198', :'orgA', 'weekly', '2025-07-08', 'active');

-- one item: on_hand 100, pack_size 50, safety_stock 0 — well below the 300kg requirement.
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values ('eeee0000-0000-0000-0000-0000000001a0', :'orgA', 'صنف بلا تاريخ', 'kg', 50, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', 'eeee0000-0000-0000-0000-0000000001a0', 'main', 100, 0, 0, 100);

-- the bug fixture: a PLANNED op with planned_at = NULL that requires 300kg of the item. With v_period_start
-- defaulting to current_date (no dated op exists for this item), the demand must land in period 1.
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values ('eeee0000-0000-0000-0000-0000000a0198', :'orgA', 'eeee0000-0000-0000-0000-00000000e198',
          'fertilization', null, 'planned');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', 'eeee0000-0000-0000-0000-0000000a0198', 'eeee0000-0000-0000-0000-0000000001a0', 300, 'kg');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- t1: the null-dated demand is NOT dropped → a real shortage is reported.
select is(
  (public.fn_stock_coverage('eeee0000-0000-0000-0000-0000000001a0', 'main', 8) ->> 'shortage')::boolean,
  true,
  '#198 fix: a null-dated op (300kg vs 100 on hand) is counted → shortage=true (not silently dropped)');

-- t2: the demand lands in PERIOD 1 (treated as immediate via coalesce(planned_at, v_period_start)).
select is(
  (public.fn_stock_coverage('eeee0000-0000-0000-0000-0000000001a0', 'main', 8) ->> 'first_shortage_period')::int,
  1,
  '#198 fix: null date → demand bucketed into period 1 (immediate)');

-- t3: a purchase is recommended for the gap (shortfall 200 + SS 0, rounded up to pack 50 → 200).
select is(
  (public.fn_stock_coverage('eeee0000-0000-0000-0000-0000000001a0', 'main', 8) ->> 'recommend_qty')::numeric,
  200::numeric,
  '#198 fix: recommend_qty > 0 (200) covers the otherwise-masked shortage');

-- t4: the period-1 PAB reflects the counted demand: 100 on hand - 300 demand = -200.
select is(
  (public.fn_stock_coverage('eeee0000-0000-0000-0000-0000000001a0', 'main', 8) -> 'pab' ->> 1)::numeric,
  -200::numeric,
  '#198 fix: PAB after period 1 = 100 - 300 = -200 (the null-dated demand is applied)');

reset role;
select * from finish();
rollback;

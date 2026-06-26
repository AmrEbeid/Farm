-- 38 — CREATE-3 (#196): fn_add_plan_operation authors a plan operation + its material requirement
-- atomically (migration 0038).
--
-- addPlanOperation used to do TWO non-atomic client writes: insert plan_operations, THEN insert
-- plan_material_requirements. A 2nd-write failure left an ORPHAN op (no requirement) that the CREATE-2
-- dedup (it only matches ops already carrying a requirement for the item) missed on retry → a duplicate
-- op whose est_cost over-counts the budget while contributing no demand. fn_add_plan_operation runs both
-- inserts in ONE transaction, so a requirement failure rolls the op back — no orphan.
--
-- Asserts: (a) a valid add inserts op + requirement (deduped=false); (b) ATOMICITY — a forced
-- requirement-insert failure (a non-existent item_id → 23503 FK violation on
-- plan_material_requirements.item_id → inventory_items, raised AFTER the op insert in-transaction)
-- leaves NO orphan plan_operations row; (c) dedup — a second identical call returns deduped without a
-- 2nd op; (d) authz — a non-plan.write role (storekeeper / accountant) is refused with 42501.
-- Run via `supabase test db`.

begin;
select plan(11);

-- ===== grants (migration 0038 lockdown): anon must NOT execute; authenticated MUST =====
select ok(not has_function_privilege('anon',
  'public.fn_add_plan_operation(uuid,text,date,numeric,uuid,numeric,text)', 'EXECUTE'),
  '0038: anon cannot EXECUTE fn_add_plan_operation');
select ok(has_function_privilege('authenticated',
  'public.fn_add_plan_operation(uuid,text,date,numeric,uuid,numeric,text)', 'EXECUTE'),
  '0038: authenticated CAN EXECUTE fn_add_plan_operation (the legitimate plan.write gate)');

\set orgA    '00000000-0000-0000-0000-000000000001'
\set item    'c0000000-0000-0000-0000-000000000038'
\set plan    'c0000000-0000-0000-0000-000000000138'
\set baditem 'deadbeef-0000-0000-0000-000000000038'

-- GUCs the throws_ok format() strings reach
select set_config('t.plan', :'plan', false);
select set_config('t.baditem', :'baditem', false);

-- actors: farm_manager HAS plan.write; storekeeper + accountant do NOT (negative authz cases).
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.acc', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);

-- a clean item and a sector-scoped plan to author operations against.
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'صنف خطة', 'kg', 1, 0, 5);
insert into public.plans (id, org_id, type, scope_type, scope_id, status)
  values (:'plan', :'orgA', 'monthly', 'sector', null, 'active');

-- ===== (a) a farm_manager authors the operation + requirement atomically =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_add_plan_operation(
  :'plan', 'fertilization', '2026-07-01'::date, 1000, :'item', 50, 'kg')::text, false);
reset role;

select is((current_setting('t.res')::jsonb)->>'deduped', 'false',
  'CREATE-3: a valid add inserts (deduped=false)');
select is((select count(*) from public.plan_operations
  where plan_id = :'plan' and subtype = 'fertilization' and planned_at = '2026-07-01'),
  1::bigint, 'CREATE-3: exactly one plan_operations row was created');
select is((select count(*) from public.plan_material_requirements
  where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid and item_id = :'item'),
  1::bigint, 'CREATE-3: its material requirement was created (the planned demand)');

-- ===== (b) atomicity: a non-existent item_id makes the requirement insert FK-fail (23503) AFTER the
-- op insert in-transaction; the whole RPC rolls back, leaving NO orphan op for that natural key. =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation('%s'::uuid, 'irrigation', '2026-07-02'::date, 500, '%s'::uuid, 30, 'kg') $$,
    current_setting('t.plan', true), current_setting('t.baditem', true)),
  '23503', null,
  'CREATE-3: a bad item_id raises 23503 (FK violation) on the requirement insert');
reset role;
select is((select count(*) from public.plan_operations
  where plan_id = :'plan' and subtype = 'irrigation'),
  0::bigint, 'CREATE-3 ATOMICITY: the failed requirement rolled the op back — NO orphan operation');

-- ===== (c) dedup: a second identical call returns the same op as deduped, with no 2nd op =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res2', public.fn_add_plan_operation(
  :'plan', 'fertilization', '2026-07-01'::date, 1000, :'item', 50, 'kg')::text, false);
reset role;

select is((current_setting('t.res2')::jsonb)->>'deduped', 'true',
  'CREATE-2 dedup: a second identical call is deduped');
select is((current_setting('t.res2')::jsonb)->>'operationId', (current_setting('t.res')::jsonb)->>'operationId',
  'CREATE-2 dedup: it returns the SAME operationId');
select is((select count(*) from public.plan_operations
  where plan_id = :'plan' and subtype = 'fertilization' and planned_at = '2026-07-01'),
  1::bigint, 'CREATE-2 dedup: still exactly one op (no duplicate inserted)');

-- ===== (d) authz: a non-plan.write role (storekeeper / accountant) is refused with 42501 =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation('%s'::uuid, 'pruning', '2026-07-03'::date, 100, null, 10, 'kg') $$,
    current_setting('t.plan', true)),
  '42501', null,
  'PLAN-AUTHZ: a storekeeper (no plan.write) is refused by fn_add_plan_operation');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.acc'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation('%s'::uuid, 'pruning', '2026-07-03'::date, 100, null, 10, 'kg') $$,
    current_setting('t.plan', true)),
  '42501', null,
  'PLAN-AUTHZ: an accountant (no plan.write) is refused by fn_add_plan_operation');
reset role;

select * from finish();
rollback;

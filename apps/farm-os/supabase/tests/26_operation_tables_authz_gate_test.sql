-- 26 — AUTHZ-1 Option B: direct REST writes to the operation tables are role-gated. A no-permission
-- role (accountant) is refused on direct INSERT to farm_event / quantities / plan_operations (42501);
-- a permitted role succeeds (supervisor has op.execute; farm_manager has plan.write); reads stay open
-- to every org member; and the bypassrls execution RPC (fn_execute_operation) is unaffected.
-- Run via `supabase test db`.

begin;
select plan(8);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'c0000000-0000-0000-0000-000000000026'
\set plan 'c0000000-0000-0000-0000-000000000126'
\set op   'c0000000-0000-0000-0000-000000000226'

-- actors (captured as superuser; client writes below run RLS-scoped as authenticated)
select set_config('t.acc', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);

-- a self-contained scenario: stock 600, 500 reserved, and a reserved op needing 500 @ est_cost 42000.
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'صنف بوابة', 'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'item', 'main', 0, 0, 0, 0);
select public.fn_post_movement(:'item', 'receipt', 600, 'main', 'kg');
select public.fn_post_movement(:'item', 'reserve', 500, 'main', 'kg');
insert into public.plans (id, org_id, status) values (:'plan', :'orgA', 'active');
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op', :'orgA', :'plan', 'fertilization', null, 42000, false, 'reserved');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 500, 'kg');

-- ===== accountant (no op.execute, no plan.write): direct writes are refused =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.acc'), 'role','authenticated')::text, true);
set local role authenticated;

select throws_ok($$
  insert into public.farm_event (org_id, type, subtype, status, occurred_at)
  values ('00000000-0000-0000-0000-000000000001','operation','fertilization','done', now())
$$, '42501', null,
  'Option B: accountant (no op.execute) cannot direct-insert farm_event');

select throws_ok($$
  insert into public.quantities (org_id, event_id, measure, value_num)
  values ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'weight', 1)
$$, '42501', null,
  'Option B: accountant (no op.execute) cannot direct-insert quantities');

select throws_ok($$
  insert into public.plan_operations (org_id, plan_id, subtype, est_cost, status)
  values ('00000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000126','irrigation', 1, 'planned')
$$, '42501', null,
  'Option B: accountant (no plan.write) cannot direct-insert plan_operations');

-- but reads stay open to the org for the accountant (dashboards / PvA / sector pages)
select isnt((select count(*) from public.plan_operations where org_id = :'orgA'), 0::bigint,
  'Option B: accountant can still read plan_operations (reads stay org-only)');

reset role;

-- ===== farm_manager (plan.write): can direct-insert plan_operations =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role','authenticated')::text, true);
set local role authenticated;
select lives_ok($$
  insert into public.plan_operations (org_id, plan_id, subtype, est_cost, status)
  values ('00000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000126','irrigation', 1, 'planned')
$$, 'Option B: farm_manager (plan.write) can direct-insert plan_operations');
reset role;

-- ===== supervisor (op.execute): can direct-insert farm_event =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select lives_ok($$
  insert into public.farm_event (org_id, type, subtype, status, occurred_at)
  values ('00000000-0000-0000-0000-000000000001','note','manual','done', now())
$$, 'Option B: supervisor (op.execute) can direct-insert farm_event');
reset role;

-- ===== the bypassrls RPC path is unaffected: supervisor executes the reserved op atomically =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select isnt(public.fn_execute_operation(:'op', 480, 5, 'تم التنفيذ'), null,
  'Option B: fn_execute_operation (SECURITY DEFINER) still executes — RPC path unaffected by the gate');
reset role;

select is((select status from public.plan_operations where id = :'op'), 'done',
  'Option B: the RPC marked the operation done (writes farm_event/quantities via the definer)');

select * from finish();
rollback;

-- 18 — AUTHZ-1 / SPEC-0002 Option A: fn_execute_operation enforces op.execute, executes atomically,
-- and is idempotent. Validates the same outcomes the Playwright wedge-loop checks, at the DB layer.
-- Run via `supabase test db`.

begin;
select plan(9);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'c0000000-0000-0000-0000-000000000018'
\set plan 'c0000000-0000-0000-0000-000000000118'
\set op   'c0000000-0000-0000-0000-000000000218'

-- capture the op id as a GUC so the throws_ok format() strings can reach it
select set_config('t.op', :'op', false);
-- actors (captured as superuser; client reads are RLS-scoped)
select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
select set_config('t.acc', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);

-- a self-contained scenario: stock 600 (via a receipt), 500 reserved (via a reserve), and a reserved
-- operation needing 500 of the item at est_cost 42000 (→ unit 84/kg).
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'صنف تنفيذ', 'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'item', 'main', 0, 0, 0, 0);
select public.fn_post_movement(:'item', 'receipt', 600, 'main', 'kg');
select public.fn_post_movement(:'item', 'reserve', 500, 'main', 'kg');
insert into public.plans (id, org_id, status) values (:'plan', :'orgA', 'active');
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op', :'orgA', :'plan', 'fertilization', null, 42000, false, 'reserved');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 500, 'kg');

-- ===== accountant (no op.execute): must be refused, with NO side effect =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.acc'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_execute_operation('%s'::uuid, 480, 5, 'x') $$, current_setting('t.op', true)),
  '42501', null,
  'AUTHZ-1: an accountant (no op.execute) is refused by fn_execute_operation');
reset role;
select is((select status from public.plan_operations where id = :'op'), 'reserved',
  'AUTHZ-1: the refused attempt left the operation untouched (no partial execution)');

-- ===== supervisor (op.execute): executes atomically =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res',
  public.fn_execute_operation(:'op', 480, 5, 'تم التنفيذ')::text, false);
reset role;

select is(((current_setting('t.res')::jsonb)->>'actual_cost')::numeric, 40320::numeric,
  'Option A: actual_cost = 480 × (42000/500) = 40320 (matches the wedge loop)');
select is((select status from public.plan_operations where id = :'op'), 'done',
  'Option A: the operation is marked done');
select is((select on_hand from public.inventory_bin where item_id = :'item' and location='main'), 120::numeric,
  'Option A: stock issued — on_hand 600 → 120 (−480)');
-- #512 (migration 20260701190000): execute no longer posts a blind release (it owned no per-op reservation),
-- so the pre-existing earmark SURVIVES — reserved stays 500. (A blind release here wiped unrelated earmarks →
-- masked shortage; the earmark is freed by an attributed release-on-receipt, not by execute.)
select is((select reserved from public.inventory_bin where item_id = :'item' and location='main'), 500::numeric,
  '#512: reserved 500 survives execute (no blind release); freed by release-on-receipt, not execute');
select isnt((select count(*) from public.farm_event
  where plan_id = :'plan' and status='done' and subtype='fertilization'), 0::bigint,
  'Option A: a done farm_event was recorded');
select isnt((select count(*) from public.quantities q
  join public.farm_event e on e.id = q.event_id
  where e.plan_id = :'plan' and q.inventory_adjustment = -480), 0::bigint,
  'Option A: the consumption quantities row was recorded (atomic with the issue)');

-- ===== idempotency: a second execute is refused (claim-first) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_execute_operation('%s'::uuid, 480, 5, 'again') $$, current_setting('t.op', true)),
  '23505', null,
  'EXE-1: a second fn_execute_operation on the same op is refused (already executed)');
reset role;

select * from finish();
rollback;

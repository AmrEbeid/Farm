-- 133 - D10 semantics pin: a `blocked` operation is intentionally paused demand.
-- The stock-coverage engine's LIVE_OP set includes planned/approved/reserved/ready/in_progress,
-- and excludes blocked/done/abandoned/skipped. This test makes that design executable:
-- the same 500kg requirement is ignored while the op is blocked, then counted immediately once
-- the op returns to a live status. Run via test-shims/run-pgtap-local.sh.
begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'e1e20001-0000-0000-0000-0000000000e2'
\set plan 'e1e20002-0000-0000-0000-0000000000e2'
\set op   'e1e20003-0000-0000-0000-0000000000e2'

insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'blocked demand semantics item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 300, 0);
insert into public.plans (id, org_id, type, status)
  values (:'plan', :'orgA', 'monthly', 'active');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', current_date, 'blocked');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 500, 'kg');

select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean,
  false,
  'ENGINE-BLOCKED: blocked op demand is paused, not projected as shortage'
);
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'recommend_qty')::numeric,
  0::numeric,
  'ENGINE-BLOCKED: blocked op demand does not recommend a purchase'
);

update public.plan_operations set status = 'planned' where id = :'op';

select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean,
  true,
  'ENGINE-BLOCKED: the exact same requirement counts again when the op returns to a live status'
);

select * from finish();
rollback;

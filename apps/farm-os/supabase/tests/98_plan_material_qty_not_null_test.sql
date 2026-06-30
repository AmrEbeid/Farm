-- 98 — NULL-qty masked-shortage guard (HARD gate; migration 0099 fixes it).
-- A public.plan_material_requirements row with qty = NULL silently drops that operation's demand in
-- fn_stock_coverage: sum(qty) over an all-NULL bucket returns NULL, which the PAB recurrence
-- coalesces to 0 — UNDER-counting demand and MASKING a real shortage (the engine's cardinal sin,
-- SPEC-0001 #1). It is the NULL sibling of the negative-qty gap that migration 0054 already closed:
-- CHECK (qty >= 0) PASSES on NULL, because `NULL >= 0` is NULL and a CHECK is satisfied when NULL.
-- Migration 0099 makes qty NOT NULL so the masking condition cannot exist.
-- Run via test-shims/run-pgtap-local.sh.
begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'a9990001-0000-0000-0000-0000000000a9'
\set plan 'a9990002-0000-0000-0000-0000000000a9'
\set op   'a9990003-0000-0000-0000-0000000000a9'

insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'NULL-qty guard item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 300, 0);
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'approved');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', current_date, 'planned');

-- THE GUARD: a NULL qty must be rejected at the DB level (not_null_violation 23502) so it can never
-- silently drop demand. Pre-0099 this INSERT SUCCEEDS and the row masks shortages downstream.
select throws_ok(
  $i$insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
     values ('00000000-0000-0000-0000-000000000001',
             'a9990003-0000-0000-0000-0000000000a9',
             'a9990001-0000-0000-0000-0000000000a9', NULL, 'kg')$i$,
  '23502',
  null,
  'plan_material_requirements.qty = NULL is rejected (no silent demand drop -> no masked shortage)'
);

-- Positive control: a real (non-null) quantity is still accepted.
select lives_ok(
  $i$insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
     values ('00000000-0000-0000-0000-000000000001',
             'a9990003-0000-0000-0000-0000000000a9',
             'a9990001-0000-0000-0000-0000000000a9', 500, 'kg')$i$,
  'a non-null qty is still accepted'
);

-- And with that real 500 demand vs 300 on hand, the engine correctly reports the shortage
-- (proving the guarded path projects demand instead of dropping it).
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  'with the demand specified (not NULL), 300 on hand vs 500 need -> shortage=true');

select * from finish();
rollback;

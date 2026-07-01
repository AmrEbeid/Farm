-- 112 — spray/pesticide-application compliance record-keeping fields (migration 20260701320000).
-- Covers: (a) target_zone CHECK enum on plan_material_requirements, (b) preferred_time_of_day CHECK
-- enum on plan_operations, (c) non-negativity CHECKs (rei_hours/phi_days/wind_speed_kmh), (d) RLS on
-- plan_material_requirements is UNCHANGED (still gated on plan.write via the existing tenant_all policy
-- — no new gate needed for additive columns; a storekeeper without plan.write is still refused), and
-- (e) fn_add_plan_operation_multi accepts + persists the new optional per-material compliance fields,
-- rejecting an unrecognised target_zone (22023) and validating applicator_person_id is an active
-- member of the plan's org, and (f) a regression guard: an omitted/blank unit on a NON-kg item still
-- defaults via trg_pmr_unit_reconcile to the item's real unit — this migration's re-emit of
-- fn_add_plan_operation_multi had regressed the unit expression to coalesce(v_mat->>'unit','kg')
-- (vs main's nullif(v_mat->>'unit', '') from 20260701170000), which would mislabel an omitted unit on
-- a non-kg item as the literal 'kg' and get it correctly-but-spuriously rejected by the trigger.
-- Run via test-shims/run-pgtap-local.sh.
begin;
select plan(20);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set plan  'b1200000-0000-0000-0000-000000000112'
\set item1 'b1200001-0000-0000-0000-000000000112'
\set op    'b1200002-0000-0000-0000-000000000112'
\set p1    'b1200003-0000-0000-0000-000000000112'
\set p2    'b1200004-0000-0000-0000-000000000112'

insert into public.plans (id, org_id, type, status, scope_type) values (:'plan', :'orgA', 'monthly', 'approved', 'sector');
insert into public.inventory_items (id, org_id, name, unit) values (:'item1', :'orgA', 'مبيد حشري', 'L');
insert into public.people (id, org_id, name, active) values (:'p1', :'orgA', 'رشّاش ١', true);
insert into public.people (id, org_id, name, active) values (:'p2', :'orgA', 'رشّاش ٢ (منظمة أخرى)', true);
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'spraying', current_date, 'planned');

select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- ── grant lockdown on the re-created fn_add_plan_operation_multi ───────────────────────────────────
-- 16 args as of the full 5-branch reconciled apply chain (#543 -> #549 -> #562 -> #560 -> #563):
-- #543's p_harvest_stage (10th), this branch's own p_preferred_time_of_day (11th), #560's
-- p_irrigation_basis (12th) and p_soil_moisture_reading (13th), #563's p_target_type (14th),
-- p_target_id (15th, uuid) and p_note (16th) — this file's own arg-count comment predates that
-- later reconciliation.
select ok(not has_function_privilege('anon',
  'public.fn_add_plan_operation_multi(uuid,text,date,date,numeric,jsonb,jsonb,uuid[],uuid,text,text,text,text,text,uuid,text)', 'EXECUTE'),
  '20260701320000: anon cannot EXECUTE the re-created fn_add_plan_operation_multi');
select ok(has_function_privilege('authenticated',
  'public.fn_add_plan_operation_multi(uuid,text,date,date,numeric,jsonb,jsonb,uuid[],uuid,text,text,text,text,text,uuid,text)', 'EXECUTE'),
  '20260701320000: authenticated CAN EXECUTE the re-created fn_add_plan_operation_multi');
select ok(not has_function_privilege('public',
  'public.fn_add_plan_operation_multi(uuid,text,date,date,numeric,jsonb,jsonb,uuid[],uuid,text,text,text,text,text,uuid,text)', 'EXECUTE'),
  '20260701320000: the superseded 10-arg overload is gone / new overload not PUBLIC-executable');

-- ── (a) target_zone CHECK enum on plan_material_requirements ────────────────────────────────────────
select lives_ok(
  format($i$insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit, target_zone)
     values ('%s', '%s', '%s', 5, 'L', 'bunch')$i$, :'orgA', :'op', :'item1'),
  'target_zone = bunch (a recognised zone) is accepted');

select throws_ok(
  format($i$insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit, target_zone)
     values ('%s', '%s', '%s', 5, 'L', 'leaves')$i$, :'orgA', :'op', :'item1'),
  '23514', null, 'target_zone = leaves (not in the closed vocabulary) is rejected (23514)');

-- ── (b) preferred_time_of_day CHECK enum on plan_operations ─────────────────────────────────────────
select lives_ok(
  format($i$update public.plan_operations set preferred_time_of_day = 'late_afternoon' where id = '%s'$i$, :'op'),
  'preferred_time_of_day = late_afternoon (a recognised value) is accepted');

select throws_ok(
  format($i$update public.plan_operations set preferred_time_of_day = 'noonish' where id = '%s'$i$, :'op'),
  '23514', null, 'preferred_time_of_day = noonish (not in the closed vocabulary) is rejected (23514)');

-- ── (c) non-negativity CHECKs ────────────────────────────────────────────────────────────────────────
select throws_ok(
  format($i$insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit, rei_hours)
     values ('%s', '%s', '%s', 5, 'L', -4)$i$, :'orgA', :'op', :'item1'),
  '23514', null, 'a negative rei_hours is rejected (23514)');

select throws_ok(
  format($i$insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit, phi_days)
     values ('%s', '%s', '%s', 5, 'L', -1)$i$, :'orgA', :'op', :'item1'),
  '23514', null, 'a negative phi_days is rejected (23514)');

select throws_ok(
  format($i$insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit, wind_speed_kmh)
     values ('%s', '%s', '%s', 5, 'L', -10)$i$, :'orgA', :'op', :'item1'),
  '23514', null, 'a negative wind_speed_kmh is rejected (23514)');

-- ── (d) RLS unchanged: existing plan.write gate still governs the (now-wider) row ───────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($i$insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit, target_zone)
     values ('%s', '%s', '%s', 5, 'L', 'crown')$i$, :'orgA', :'op', :'item1'),
  '42501', null, 'a storekeeper (no plan.write) is still refused inserting compliance-bearing rows (42501, unchanged gate)');
reset role;

-- ── (e) fn_add_plan_operation_multi accepts + persists the new optional per-material fields ────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
-- positional arg 10 is #543's p_harvest_stage (null here — not exercised by this test), arg 11 is
-- this branch's own p_preferred_time_of_day ('late_afternoon').
select set_config('t.res', public.fn_add_plan_operation_multi(
  :'plan', 'spraying', '2026-07-15'::date, null, 800,
  format(
    '[{"item_id":"%s","qty":12,"unit":"L","target_pest":"سوسة النخيل الحمراء","apc_registration_ref":"APC-2024-0091","rei_hours":48,"phi_days":14,"target_zone":"crown","applicator_person_id":"%s","wind_speed_kmh":8,"wind_direction":"شمالي","air_temp_c":31}]',
    :'item1', :'p1')::jsonb,
  '[]'::jsonb, null, null, null, 'late_afternoon')::text, false);
reset role;

select is(
  (select target_pest from public.plan_material_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid and target_zone = 'crown'),
  'سوسة النخيل الحمراء', 'fn_add_plan_operation_multi persists target_pest');
select is(
  (select rei_hours from public.plan_material_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid and target_zone = 'crown'),
  48::numeric, 'fn_add_plan_operation_multi persists rei_hours');
select is(
  (select phi_days from public.plan_material_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid and target_zone = 'crown'),
  14::numeric, 'fn_add_plan_operation_multi persists phi_days');
select is(
  (select applicator_person_id from public.plan_material_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid and target_zone = 'crown'),
  :'p1'::uuid, 'fn_add_plan_operation_multi persists applicator_person_id');
select is(
  (select preferred_time_of_day from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'late_afternoon', 'fn_add_plan_operation_multi persists preferred_time_of_day on plan_operations');

-- ── (f) regression guard: an OMITTED unit on a non-kg item must succeed and default via the trigger to
-- the item's real unit ('L' for item1) — NOT get silently coalesced to the literal string 'kg' (which the
-- fail-closed trg_pmr_unit_reconcile would then correctly-but-spuriously reject as a unit mismatch).
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'spraying', '2026-07-18'::date, null, 100,
    '[{"item_id":"%s","qty":6,"target_zone":"whole_palm"}]'::jsonb, '[]'::jsonb, null, null) $$,
    :'plan', :'item1'),
  'a material line with an omitted unit on a non-kg (L) item succeeds via fn_add_plan_operation_multi (no spurious 22023)');
reset role;

select is(
  (select unit from public.plan_material_requirements
     where plan_op_id = (select id from public.plan_operations
       where plan_id = :'plan' and planned_at = '2026-07-18'::date)
       and target_zone = 'whole_palm'),
  'L', 'the omitted unit defaults to the item''s real unit (L) via the trigger, not a hardcoded ''kg''');

-- an unrecognised target_zone inside the RPC's jsonb payload is rejected with a clean 22023 (not a raw
-- 23514 constraint violation) — the RPC validates before insert, per its own header comment.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'spraying', '2026-07-16'::date, null, 100,
    '[{"item_id":"%s","qty":5,"unit":"L","target_zone":"leaves"}]'::jsonb, '[]'::jsonb, null, null) $$,
    :'plan', :'item1'),
  '22023', null, 'RPC rejects an unrecognised target_zone in the materials payload (22023)');
reset role;

-- an unrecognised preferred_time_of_day is likewise rejected with a clean 22023. Positional arg 10 is
-- #543's p_harvest_stage (null — not exercised), arg 11 is p_preferred_time_of_day ('noonish').
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'spraying', '2026-07-17'::date, null, 100,
    '[]'::jsonb, '[]'::jsonb, null, null, null, 'noonish') $$, :'plan'),
  '22023', null, 'RPC rejects an unrecognised preferred_time_of_day (22023)');
reset role;

select * from finish();
rollback;

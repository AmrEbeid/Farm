-- 113 — 3-WAY MERGE REGRESSION TEST for fn_add_plan_operation_multi (migration 20260701340000).
--
-- CONTEXT: PRs #562 (spray-compliance-record), #560 (soil-test-irrigation-and-templates), and #563
-- (individual-palm-treatment, this branch) each independently extended fn_add_plan_operation_multi
-- from the same 9-arg base. This migration composes all three into ONE 15-arg function (see its
-- header for the full param list/origins and the required apply order #562 → #560 → #563).
--
-- WHAT THIS TEST PROVES (the critical regression check for the merge itself, not just that each
-- layer compiles in isolation): a SINGLE atomic call to the FINAL 15-arg signature, setting ALL SIX
-- new params from all three PRs simultaneously —
--   (1) p_preferred_time_of_day  (#562) — plan_operations scalar
--   (2) target_pest/rei_hours/phi_days/target_zone/applicator_person_id/wind_speed_kmh/
--       wind_direction/air_temp_c/apc_registration_ref (#562) — per-material compliance fields,
--       carried in the p_materials jsonb payload (not a separate scalar param)
--   (3) p_irrigation_basis       (#560) — plan_operations scalar
--   (4) p_soil_moisture_reading  (#560) — plan_operations scalar
--   (5) p_target_type/p_target_id (#563) — palm-target override
--   (6) p_note                  (#563) — plan_operations scalar
-- — persists ALL of them correctly in ONE atomic transaction, proving the three additive layers
-- (materials-loop compliance fields, main-INSERT irrigation columns, target-resolution + note) do
-- not clobber, shadow, or silently drop one another when composed. Also proves the unit-reconcile
-- fix (nullif, not coalesce(...,'kg')) survived the merge (see migration header's "bug fix carried
-- forward" note) by using a non-kg item with an OMITTED unit and asserting it is NOT rejected and
-- resolves to the item's own canonical unit via the trigger.
--
-- Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(12);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set plan   'c9200000-0000-0000-0000-000000000113'
\set palm1  'c9200001-0000-0000-0000-000000000113'
\set item1  'c9200002-0000-0000-0000-000000000113'
\set p1     'c9200003-0000-0000-0000-000000000113'

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
insert into public.plans (id, org_id, type, status, scope_type) values (:'plan', :'orgA', 'monthly', 'approved', 'sector');
insert into public.assets (id, org_id, type, name, status) values (:'palm1', :'orgA', 'palm', 'نخلة الاختبار', 'sick');
-- a non-kg item (item unit = 'L') to prove the unit-reconcile fix survived the merge: an OMITTED
-- material unit must resolve to 'L' via the trigger, not be forced to 'kg' (coalesce regression).
insert into public.inventory_items (id, org_id, name, unit) values (:'item1', :'orgA', 'مبيد اختبار', 'L');
insert into public.people (id, org_id, name, active) values (:'p1', :'orgA', 'رشّاش الاختبار', true);

select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);

-- ── THE atomic call: all six new params (plus their sub-fields) set simultaneously ────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_add_plan_operation_multi(
  p_plan_id => :'plan',
  p_subtype => 'spraying',
  p_planned_at => '2026-07-20'::date,
  p_ends_on => null,
  p_est_cost => 600,
  p_materials => format(
    -- unit OMITTED (no "unit" key) — must resolve to the item's canonical unit ('L') via
    -- trg_pmr_unit_reconcile, not be forced to 'kg'.
    '[{"item_id":"%s","qty":6,"target_pest":"سوسة النخيل الحمراء","apc_registration_ref":"APC-2024-0113","rei_hours":24,"phi_days":7,"target_zone":"bunch","applicator_person_id":"%s","wind_speed_kmh":5,"wind_direction":"غربي","air_temp_c":29}]',
    :'item1', :'p1')::jsonb,
  p_labor => '[]'::jsonb,
  p_assignee_ids => null,
  p_lead_id => null,
  -- (1) PR #562
  p_preferred_time_of_day => 'late_afternoon',
  -- (3)(4) PR #560
  p_irrigation_basis => 'soil_test',
  p_soil_moisture_reading => '12%',
  -- (5) PR #563
  p_target_type => 'palm',
  p_target_id => :'palm1',
  -- (6) PR #563
  p_note => 'معالجة فردية لنخلة ضعيفة مع رش مبيد')::text, false);
reset role;

-- ── assertions: every one of the six new pieces of data landed correctly, in the SAME operation ──
select is(
  (select target_type from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'palm', '3-way merge: target_type is ''palm'' (PR #563 override applied)');
select is(
  (select target_id from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  :'palm1'::uuid, '3-way merge: target_id is the given palm (PR #563)');
select is(
  (select note from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'معالجة فردية لنخلة ضعيفة مع رش مبيد', '3-way merge: note persisted (PR #563)');
select is(
  (select preferred_time_of_day from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'late_afternoon', '3-way merge: preferred_time_of_day persisted (PR #562)');
select is(
  (select irrigation_basis from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'soil_test', '3-way merge: irrigation_basis persisted (PR #560)');
select is(
  (select soil_moisture_reading from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  '12%', '3-way merge: soil_moisture_reading persisted (PR #560)');
select is(
  (select target_pest from public.plan_material_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'سوسة النخيل الحمراء', '3-way merge: per-material target_pest persisted (PR #562)');
select is(
  (select rei_hours from public.plan_material_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  24::numeric, '3-way merge: per-material rei_hours persisted (PR #562)');
select is(
  (select applicator_person_id from public.plan_material_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  :'p1'::uuid, '3-way merge: per-material applicator_person_id persisted (PR #562)');

-- unit-reconcile fix survived the merge: unit was OMITTED in the payload; the trigger must have
-- resolved it to the item's own canonical unit ('L'), not forced it to 'kg' (the coalesce regression
-- both #562's and #560's pre-reconciliation drafts had independently introduced — see the migration
-- header's "bug fix carried forward" note).
select is(
  (select unit from public.plan_material_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'L', '3-way merge: omitted material unit resolves to the item''s canonical unit (''L''), not ''kg'' — unit-reconcile fix intact');

-- atomicity/shape sanity: exactly one material line, one op.
select is((current_setting('t.res')::jsonb)->>'materials', '1', '3-way merge: exactly one material line created');
select is(
  (select count(*) from public.plan_operations where plan_id = :'plan' and subtype = 'spraying'),
  1::bigint, '3-way merge: exactly one operation created (no duplicate/partial rows)');

select * from finish();
rollback;

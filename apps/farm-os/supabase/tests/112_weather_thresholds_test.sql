-- 112 — fn_update_weather_thresholds (SPEC-0007 §3, migration 20260701270000): owner/farm_manager
-- (authorize('plan.write')) may save a per-org weather-gate threshold override into
-- organization.settings->'weather_thresholds'; every other role is rejected, every field is
-- range-checked, and the write is audited.

begin;
select plan(13);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB '00000000-0000-0000-0000-000000000002'

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('test.managerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='farm_manager'), false);
select set_config('test.accountantA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='accountant'), false);

\set good_thresholds '{"sprayMaxWindKph":12,"pollinateMaxRainMm":2,"pollinateMaxWindKph":18,"harvestMaxRainMm":3,"heatStressC":42,"frostBelowC":4}'

-- ===== as the OWNER =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

select lives_ok(
  format($$ select public.fn_update_weather_thresholds('%s', '%s'::jsonb) $$, :'orgA', :'good_thresholds'),
  'owner can save weather thresholds');

select is(
  (select (settings -> 'weather_thresholds' ->> 'frostBelowC')::numeric from public.organization where id = :'orgA'),
  4::numeric,
  'frostBelowC was persisted under organization.settings.weather_thresholds');
select is(
  (select (settings -> 'weather_thresholds' ->> 'heatStressC')::numeric from public.organization where id = :'orgA'),
  42::numeric,
  'heatStressC was persisted alongside frostBelowC (full object saved)');

select is(
  (select count(*)::int from public.audit_log
     where entity_type = 'organization_weather_thresholds' and entity_id = :'orgA' and action = 'UPDATE'
       and actor_user_id::text = current_setting('test.ownerA')
       and (after -> 'weather_thresholds' ->> 'frostBelowC')::numeric = 4),
  1,
  'the owner save wrote an audit_log row (org scope, owner actor, after.frostBelowC)');

select throws_ok(
  format($$ select public.fn_update_weather_thresholds('%s', '{"sprayMaxWindKph":12}'::jsonb) $$, :'orgA'),
  '22023', NULL, 'a payload missing a required key is rejected');

select throws_ok(
  format($$ select public.fn_update_weather_thresholds('%s',
    '{"sprayMaxWindKph":"fast","pollinateMaxRainMm":2,"pollinateMaxWindKph":18,"harvestMaxRainMm":3,"heatStressC":42,"frostBelowC":4}'::jsonb) $$, :'orgA'),
  '22023', NULL, 'a non-numeric field value is rejected');

select throws_ok(
  format($$ select public.fn_update_weather_thresholds('%s',
    '{"sprayMaxWindKph":9999,"pollinateMaxRainMm":2,"pollinateMaxWindKph":18,"harvestMaxRainMm":3,"heatStressC":42,"frostBelowC":4}'::jsonb) $$, :'orgA'),
  '22023', NULL, 'an out-of-range field value is rejected');

select throws_ok(
  format($$ select public.fn_update_weather_thresholds('%s',
    '{"sprayMaxWindKph":12,"pollinateMaxRainMm":2,"pollinateMaxWindKph":18,"harvestMaxRainMm":3,"heatStressC":10,"frostBelowC":10}'::jsonb) $$, :'orgA'),
  '22023', NULL, 'frostBelowC >= heatStressC is rejected (sanity ordering)');

-- ===== as the FARM MANAGER (also plan.write) =====
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.managerA'), 'role','authenticated')::text, true);
set role authenticated;

select lives_ok(
  format($$ select public.fn_update_weather_thresholds('%s', '%s'::jsonb) $$, :'orgA', :'good_thresholds'),
  'farm_manager can also save weather thresholds (plan.write)');

-- ===== as a NON plan.write role (accountant) =====
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.accountantA'), 'role','authenticated')::text, true);
set role authenticated;

select throws_ok(
  format($$ select public.fn_update_weather_thresholds('%s', '%s'::jsonb) $$, :'orgA', :'good_thresholds'),
  '42501', NULL, 'an accountant (no plan.write) cannot save weather thresholds');

-- ===== cross-org isolation: an org-A manager (has plan.write in A only) cannot save for org B =====
reset role;
insert into public.organization (id, name) values (:'orgB', 'مزرعة ب') on conflict (id) do nothing;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.managerA'), 'role','authenticated')::text, true);
set role authenticated;

select throws_ok(
  format($$ select public.fn_update_weather_thresholds('%s', '%s'::jsonb) $$, :'orgB', :'good_thresholds'),
  '42501', NULL, 'an org-A manager cannot save thresholds for org B (cross-org guard)');

reset role; -- ground truth read (bypasses RLS) — org B is invisible to managerA, so verify as superuser
select is(
  (select settings -> 'weather_thresholds' from public.organization where id = :'orgB'),
  null::jsonb,
  'org B thresholds remain unset after the blocked cross-org attempt');

select is(
  has_function_privilege('anon', 'public.fn_update_weather_thresholds(uuid, jsonb)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE fn_update_weather_thresholds');

select * from finish();
rollback;

-- Stage 1 — org settings setter (migration 0086): only the org owner may edit org settings.

begin;
select plan(5);

\set orgA '00000000-0000-0000-0000-000000000001'

-- owner + a non-owner (manager) of org A from the seed.
select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('test.managerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='farm_manager'), false);

-- ===== as the OWNER =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

select lives_ok(
  $$ select public.fn_update_org_settings('00000000-0000-0000-0000-000000000001',
       'مزرعة عبيد', 'ar', 'EGP', 'feddan', '2025-01-01') $$,
  'owner can update org settings');

select is((select name from public.organization where id = :'orgA'), 'مزرعة عبيد',
  'org name was updated');
select is((select fiscal_year_start from public.organization where id = :'orgA'), '2025-01-01'::date,
  'fiscal_year_start was updated');

select throws_ok(
  $$ select public.fn_update_org_settings('00000000-0000-0000-0000-000000000001', '   ') $$,
  '23514', NULL, 'empty name is rejected');

-- ===== as a NON-owner (manager) =====
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.managerA'), 'role','authenticated')::text, true);
set role authenticated;

select throws_ok(
  $$ select public.fn_update_org_settings('00000000-0000-0000-0000-000000000001', 'تلاعب') $$,
  '42501', NULL, 'a non-owner cannot edit org settings');

select * from finish();
rollback;

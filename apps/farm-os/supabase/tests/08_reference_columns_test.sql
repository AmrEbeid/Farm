-- 08 — D3: RLS reference-column hardening (migration 0012). A row cannot reference a
-- foreign-org row via a nullable FK column, even when its own org_id is correct. Run via
-- `supabase test db`. NULL references and same-org references are still allowed.

begin;
select plan(5);

\set orgA '00000000-0000-0000-0000-000000000001'

-- fixtures (superuser): org B + a B sector; reuse org-A's seeded sector for the legit case.
insert into public.organization (id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','مزرعة ب');
insert into public.farms (id, org_id, name, code) values
  ('b0000000-0000-0000-0000-00000000fa01','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','مزرعة ب','BF');
insert into public.sectors (id, org_id, farm_id, name, code) values
  ('b0000000-0000-0000-0000-00000000fe01','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','b0000000-0000-0000-0000-00000000fa01','قطاع ب','BS');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- a real org-A sector id (seeded) for the legit case
select set_config('test.aSector', (select id::text from public.sectors where org_id = :'orgA' limit 1), false);

-- 1. assets: org-A asset referencing an ORG-B sector is denied
select throws_ok($$
  insert into public.assets (org_id, type, sector_id)
  values ('00000000-0000-0000-0000-000000000001','palm','b0000000-0000-0000-0000-00000000fe01')
$$, '42501', null, 'D3: asset referencing a foreign-org sector is denied');

-- 2. assets: org-A asset referencing an org-A sector is allowed
select lives_ok(
  format($$insert into public.assets (org_id, type, sector_id) values ('%s','palm','%s')$$,
         :'orgA', current_setting('test.aSector')),
  'D3: asset referencing a same-org sector is allowed');

-- 3. assets: a NULL reference is still allowed (columns are advisory/nullable)
select lives_ok($$
  insert into public.assets (org_id, type, sector_id) values ('00000000-0000-0000-0000-000000000001','palm',null)
$$, 'D3: null reference is allowed');

-- 4. expenses: org-A expense referencing an ORG-B farm is denied
select throws_ok($$
  insert into public.expenses (org_id, date, farm_id, total)
  values ('00000000-0000-0000-0000-000000000001', current_date, 'b0000000-0000-0000-0000-00000000fa01', 100)
$$, '42501', null, 'D3: expense referencing a foreign-org farm is denied');

-- 5. expenses: no reference (NULL) is allowed
select lives_ok($$
  insert into public.expenses (org_id, date, total) values ('00000000-0000-0000-0000-000000000001', current_date, 100)
$$, 'D3: expense with no farm reference is allowed');

reset role;
select * from finish();
rollback;

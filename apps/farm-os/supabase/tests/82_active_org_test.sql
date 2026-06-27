-- Stage 1 — active-org / multi-org switching (migration 0085).
--
-- A consultant who belongs to TWO orgs must see only the ACTIVE org's tenant rows, be able to
-- flip the active org, fall back to the full set when no active_org_id claim is present
-- (backward-compatible with the single-org pilot + every pre-existing test), and a forged claim
-- for a non-member org must FAIL CLOSED (empty set). The org switcher must still enumerate all
-- the user's orgs (member-set read), and fn_set_active_org must reject a non-member org.

begin;
select plan(10);

-- ---- fixtures (as the test superuser, RLS-bypassing) ----
\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set guessed 'f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0'

-- a CONSULTANT user who is a member of BOTH org A (seed Ebeid) and a new org B.
insert into public.organization (id, name) values (:'orgB', 'مزرعة الاستشاري');
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(), now());
insert into public.organization_member (org_id, user_id, role) values
  (:'orgA','cccccccc-cccc-cccc-cccc-cccccccccccc','agri_engineer'),
  (:'orgB','cccccccc-cccc-cccc-cccc-cccccccccccc','owner');
-- exactly one inventory row in org B (org A already has seed inventory).
insert into public.inventory_items (id, org_id, name) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', :'orgB', 'صنف خاص بـ B');

select set_config('test.consultant', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);

-- helper to (re)impersonate the consultant with a given active_org_id (or none)
-- is inlined below via set_config on request.jwt.claims.

-- ===================================================================
-- ACTIVE = org A
-- ===================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.consultant'), 'role','authenticated',
                    'active_org_id', :'orgA')::text, true);
set role authenticated;

select isnt((select count(*) from public.inventory_items where org_id = :'orgA'), 0::bigint,
  'active=A: consultant sees org A inventory');
select is((select count(*) from public.inventory_items where org_id = :'orgB'), 0::bigint,
  'active=A: org B inventory is hidden (narrowed)');
-- switcher: the member-set read still shows org B''s organization row even while active=A
select is((select count(*) from public.organization where id = :'orgB'), 1::bigint,
  'active=A: switcher still sees org B (user_member_org_ids full set)');

-- ===================================================================
-- ACTIVE = org B  (flip)
-- ===================================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.consultant'), 'role','authenticated',
                    'active_org_id', :'orgB')::text, true);
set role authenticated;

select is((select count(*) from public.inventory_items where org_id = :'orgB'), 1::bigint,
  'active=B: consultant sees org B inventory');
select is((select count(*) from public.inventory_items where org_id = :'orgA'), 0::bigint,
  'active=B: org A inventory is hidden (narrow flipped)');

-- ===================================================================
-- NO active_org_id claim  (backward-compatible full set)
-- ===================================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.consultant'), 'role','authenticated')::text, true);
set role authenticated;

select isnt((select count(*) from public.inventory_items where org_id = :'orgA'), 0::bigint,
  'no claim: consultant sees org A (full set, backward compat)');
select is((select count(*) from public.inventory_items where org_id = :'orgB'), 1::bigint,
  'no claim: consultant sees org B (full set, backward compat)');

-- ===================================================================
-- FORGED active_org_id for a NON-member org  → fail closed
-- ===================================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.consultant'), 'role','authenticated',
                    'active_org_id', :'guessed')::text, true);
set role authenticated;

select is((select count(*) from public.inventory_items), 0::bigint,
  'forged active_org_id (non-member): user_org_ids empty → sees nothing (fails closed)');

-- ===================================================================
-- fn_set_active_org membership validation
-- ===================================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.consultant'), 'role','authenticated')::text, true);
set role authenticated;

select lives_ok($$ select public.fn_set_active_org('00000000-0000-0000-0000-000000000001') $$,
  'fn_set_active_org accepts an org the user is a member of');
select throws_ok($$ select public.fn_set_active_org('f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0') $$,
  '42501', NULL,
  'fn_set_active_org rejects an org the user is NOT a member of');

select * from finish();
rollback;

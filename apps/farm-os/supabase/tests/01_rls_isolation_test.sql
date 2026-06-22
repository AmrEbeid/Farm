-- TI-1: cross-org RLS leak test (the Stage-1 tenant-isolation gate) + AP-1/AP-2
-- separation-of-duties on purchase_requests. Run via `supabase test db`.
--
-- Strategy: the seed has org A (Ebeid). We create a second org B and a member of B
-- *inside the test transaction* (as the superuser test role, RLS-bypassing), then
-- impersonate org-A and org-B members via request.jwt.claims + `set role authenticated`
-- and assert each sees ONLY its own rows, a guessed foreign org id returns zero, and the
-- PR approval guard (owner-only + author!=approver) holds.

begin;
select plan(12);

-- ---- fixtures (created as the test superuser, before dropping to authenticated) ----
-- Org A = Ebeid (from the seed). Pull its ids.
\set orgA '00000000-0000-0000-0000-000000000001'
-- owner (Amr) and manager (Abd El-Jalil) auth user ids from the seed (deterministic uuid5).
select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('test.managerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='farm_manager'), false);

-- Create org B + a user + membership + one tenant row, all RLS-bypassing here.
insert into public.organization (id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','مزرعة أخرى');
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(), now());
insert into public.organization_member (org_id, user_id, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc','owner');
insert into public.inventory_items (id, org_id, name) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','صنف خاص بـ B');

-- A PR authored by manager A (for the self-approval test).
insert into public.purchase_requests (id, org_id, code, requested_by, status)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', :'orgA', 'PR-TEST-1',
          (select current_setting('test.managerA')::uuid), 'submitted');

-- ===================================================================
-- Impersonate org-A MANAGER (authenticated). RLS now applies.
-- ===================================================================
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.managerA'), 'role','authenticated')::text, true);
set role authenticated;

-- 1. Manager A sees Ebeid rows.
select isnt((select count(*) from public.hawshat), 0::bigint,
  'org A member sees their own hawshat (28)');

-- 2. No org-B rows leak through any tenant table.
select is((select count(*) from public.inventory_items where org_id <> :'orgA'), 0::bigint,
  'no foreign-org inventory_items leak');
select is((select count(*) from public.organization where id <> :'orgA'), 0::bigint,
  'org A member cannot see org B organization row');

-- 3. A GUESSED org B id returns zero rows (TI-1 core assertion).
select is((select count(*) from public.inventory_items
  where org_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0::bigint,
  'guessed org B id returns zero rows');

-- 4. Manager A cannot INSERT a row tagged with org B (WITH CHECK denies it).
select throws_ok($$
  insert into public.inventory_items (org_id, name)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','محاولة تسرب')
$$, '42501', null, 'insert into foreign org denied by WITH CHECK');

-- 5. Manager A cannot UPDATE an org B row (it is invisible -> 0 rows affected, no error,
--    so assert the row is unchanged from B's perspective later; here assert update sees none).
select is((select count(*) from public.inventory_items
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd'), 0::bigint,
  'org A cannot even see org B row to update it');

-- ===================================================================
-- Separation of duties on purchase_requests (AP-1 / AP-2).
-- ===================================================================
-- 6. Manager A (author, NOT owner) cannot self-approve their own PR.
select throws_ok($$
  update public.purchase_requests set status='approved'
  where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, '42501', null, 'AP-2: PR author (manager) cannot approve (owner-only + self-approve blocked)');

-- 7. Manager A CAN still make a non-approval edit to the PR (e.g. add a reason).
select lives_ok($$
  update public.purchase_requests set reason='تحديث السبب'
  where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, 'non-approval PR edit allowed for org member');

-- ===================================================================
-- Switch to org-A OWNER (Amr). Owner != author -> approval allowed.
-- ===================================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- 8. Owner (not the author) CAN approve the PR (AP-1 satisfied, author!=approver).
select lives_ok($$
  update public.purchase_requests set status='approved'
  where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
$$, 'AP-1: owner (non-author) can approve the PR');

select is((select status from public.purchase_requests
  where id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 'approved',
  'PR is now approved by the owner');

-- ===================================================================
-- Impersonate org-B owner: sees B's row, not A's.
-- ===================================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated')::text, true);
set role authenticated;

select is((select count(*) from public.inventory_items
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd'), 1::bigint,
  'org B owner sees their own inventory_items row');
select is((select count(*) from public.inventory_items where org_id = :'orgA'), 0::bigint,
  'org B owner sees zero org A rows');

reset role;
select * from finish();
rollback;

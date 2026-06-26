-- 24 — cross-org child-table isolation oracle (RLS-H1).
--
-- Generalizes the parent-org WITH CHECK that migration 0010 (security remediation)
-- added to every child table. Test 05 pins this for ONE child table (quantities);
-- this file pins it for EVERY child table 0010 hardened, so a regression on any one
-- of them fails CI:
--   event children (-> farm_event.event_id):
--     event_assets, event_locations, quantities,
--     event_status_history, event_followups, event_attachments
--   plan requirement children (-> plan_operations.plan_op_id):
--     plan_material_requirements, plan_labor_requirements
--   budget_lines           (-> budgets.budget_id)
--   purchase_request_items (-> purchase_requests.pr_id)
--
-- The attack each assertion pins (RLS-H1): an authenticated member of org A inserts a
-- child row TAGGED WITH ORG A's OWN org_id (so the row-level `org_id in user_org_ids()`
-- check passes) but whose PARENT belongs to org B. Pre-0010 the policy only checked the
-- child's own org_id, so this cross-tenant write succeeded. 0010's WITH CHECK adds an
-- EXISTS that the referenced parent is in the SAME org as the child row, so the parent
-- lookup (e.org_id = child.org_id = orgA) finds nothing -> WITH CHECK false -> 42501.
--
-- Strategy mirrors test 05: seed org-B parents as the RLS-bypassing superuser inside the
-- txn, then `set role authenticated` as the org-A owner via request.jwt.claims and assert
-- each cross-org child insert throws 42501. A matching same-org insert proves the policy
-- is not a blanket deny (the legit path still works).

begin;
select plan(20);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

-- ===== fixtures (created as the superuser test role, RLS-bypassing) =====
-- Org B + its parent rows. The org-A owner (authenticated) below must NOT be able to
-- attach any child to these even when the child carries org A's own org_id.
insert into public.organization (id, name) values (:'orgB', 'مزرعة أخرى');

-- An org-A event (legit-path parent) and an org-B event (the cross-org target).
insert into public.farm_event (id, org_id, type, occurred_at) values
  ('a0000000-0000-0000-0000-0000000000a1', :'orgA', 'note', '2025-07-15'),
  ('b0000000-0000-0000-0000-0000000000b1', :'orgB', 'note', '2025-07-15');

-- An org-B asset for the event_assets child (asset_id is an FK to assets; the FK only
-- needs the row to EXIST — the parent-org check that matters is on farm_event, not assets).
insert into public.assets (id, org_id, type, name) values
  ('b0000000-0000-0000-0000-00000000a55e', :'orgB', 'palm', 'نخلة B');
-- An org-A asset so the same-org event_assets legit-path insert has a valid asset too.
insert into public.assets (id, org_id, type, name) values
  ('a0000000-0000-0000-0000-00000000a55e', :'orgA', 'palm', 'نخلة A');

-- Org-B plan -> plan_operation (parent for the plan requirement children).
insert into public.plans (id, org_id, type, period_start, status) values
  ('b0000000-0000-0000-0000-0000000000d1', :'orgB', 'weekly', '2025-07-08', 'active');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status) values
  ('b0000000-0000-0000-0000-0000000000c1', :'orgB',
   'b0000000-0000-0000-0000-0000000000d1', 'fertilization', '2025-07-08', 'planned');
-- Matching org-A plan_operation for the legit-path inserts.
insert into public.plans (id, org_id, type, period_start, status) values
  ('a0000000-0000-0000-0000-0000000000d1', :'orgA', 'weekly', '2025-07-08', 'active');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status) values
  ('a0000000-0000-0000-0000-0000000000c1', :'orgA',
   'a0000000-0000-0000-0000-0000000000d1', 'fertilization', '2025-07-08', 'planned');

-- plan_material_requirements / purchase_request_items carry an item_id FK. Since migration 0061 the
-- WITH CHECK requires that item to be SAME-ORG, so the child inserts below use a same-org item (the
-- seeded POTASSIUM 39e2…) to isolate the RLS-H1 PARENT-org check being tested here; the cross-org ITEM
-- refusal is covered by test 62. (Previously these used an org-B item, which 0061 now correctly blocks.)

-- Org-B budget -> the parent for budget_lines.
insert into public.budgets (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000000e1', :'orgB', 'ميزانية B');
insert into public.budgets (id, org_id, name) values
  ('a0000000-0000-0000-0000-0000000000e1', :'orgA', 'ميزانية A');

-- Org-B purchase_request -> the parent for purchase_request_items.
insert into public.purchase_requests (id, org_id, code, status) values
  ('b0000000-0000-0000-0000-0000000000f1', :'orgB', 'PR-B-1', 'draft');
insert into public.purchase_requests (id, org_id, code, status) values
  ('a0000000-0000-0000-0000-0000000000f1', :'orgA', 'PR-A-1', 'draft');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);

-- ===== impersonate the org-A owner (authenticated); RLS now applies =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- ---------------------------------------------------------------------------
-- event children -> farm_event. Each: cross-org insert (org A tag, org B parent)
-- is denied; same-org insert (org A tag, org A parent) is allowed.
-- ---------------------------------------------------------------------------

-- event_assets
select throws_ok($$
  insert into public.event_assets (event_id, asset_id, org_id)
  values ('b0000000-0000-0000-0000-0000000000b1',
          'b0000000-0000-0000-0000-00000000a55e',
          '00000000-0000-0000-0000-000000000001')
$$, '42501', null, 'RLS-H1 event_assets: child on a foreign-org event is denied');
select lives_ok($$
  insert into public.event_assets (event_id, asset_id, org_id)
  values ('a0000000-0000-0000-0000-0000000000a1',
          'a0000000-0000-0000-0000-00000000a55e',
          '00000000-0000-0000-0000-000000000001')
$$, 'RLS-H1 event_assets: child on a same-org event is allowed');

-- event_locations
select throws_ok($$
  insert into public.event_locations (event_id, org_id)
  values ('b0000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-000000000001')
$$, '42501', null, 'RLS-H1 event_locations: child on a foreign-org event is denied');
select lives_ok($$
  insert into public.event_locations (event_id, org_id)
  values ('a0000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-000000000001')
$$, 'RLS-H1 event_locations: child on a same-org event is allowed');

-- quantities (also pinned in test 05; kept here for completeness of the matrix)
select throws_ok($$
  insert into public.quantities (org_id, event_id, measure, value_num)
  values ('00000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-0000000000b1', 'weight', 99)
$$, '42501', null, 'RLS-H1 quantities: child on a foreign-org event is denied');
select lives_ok($$
  insert into public.quantities (org_id, event_id, measure, value_num)
  values ('00000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000a1', 'weight', 99)
$$, 'RLS-H1 quantities: child on a same-org event is allowed');

-- event_status_history
select throws_ok($$
  insert into public.event_status_history (org_id, event_id, status)
  values ('00000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-0000000000b1', 'done')
$$, '42501', null, 'RLS-H1 event_status_history: child on a foreign-org event is denied');
select lives_ok($$
  insert into public.event_status_history (org_id, event_id, status)
  values ('00000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000a1', 'done')
$$, 'RLS-H1 event_status_history: child on a same-org event is allowed');

-- event_followups
select throws_ok($$
  insert into public.event_followups (org_id, event_id, status, note)
  values ('00000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-0000000000b1', 'open', 'متابعة')
$$, '42501', null, 'RLS-H1 event_followups: child on a foreign-org event is denied');
select lives_ok($$
  insert into public.event_followups (org_id, event_id, status, note)
  values ('00000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000a1', 'open', 'متابعة')
$$, 'RLS-H1 event_followups: child on a same-org event is allowed');

-- event_attachments
select throws_ok($$
  insert into public.event_attachments (org_id, event_id, storage_path, kind)
  values ('00000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-0000000000b1', 'x/y.jpg', 'photo')
$$, '42501', null, 'RLS-H1 event_attachments: child on a foreign-org event is denied');
select lives_ok($$
  insert into public.event_attachments (org_id, event_id, storage_path, kind)
  values ('00000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000a1', 'x/y.jpg', 'photo')
$$, 'RLS-H1 event_attachments: child on a same-org event is allowed');

-- ---------------------------------------------------------------------------
-- plan requirement children -> plan_operations (plan_op_id).
-- ---------------------------------------------------------------------------

-- plan_material_requirements
select throws_ok($$
  insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values ('00000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-0000000000c1',
          '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4', 10, 'kg')
$$, '42501', null, 'RLS-H1 plan_material_requirements: child on a foreign-org op is denied');
select lives_ok($$
  insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values ('00000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000c1',
          '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4', 10, 'kg')
$$, 'RLS-H1 plan_material_requirements: child on a same-org op is allowed');

-- plan_labor_requirements
select throws_ok($$
  insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
  values ('00000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-0000000000c1', 'فريق', 2, 1)
$$, '42501', null, 'RLS-H1 plan_labor_requirements: child on a foreign-org op is denied');
select lives_ok($$
  insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
  values ('00000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000c1', 'فريق', 2, 1)
$$, 'RLS-H1 plan_labor_requirements: child on a same-org op is allowed');

-- ---------------------------------------------------------------------------
-- budget_lines -> budgets (budget_id).
-- ---------------------------------------------------------------------------
select throws_ok($$
  insert into public.budget_lines (org_id, budget_id, category, planned)
  values ('00000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-0000000000e1', 'inputs', 100)
$$, '42501', null, 'RLS-H1 budget_lines: child on a foreign-org budget is denied');
select lives_ok($$
  insert into public.budget_lines (org_id, budget_id, category, planned)
  values ('00000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000e1', 'inputs', 100)
$$, 'RLS-H1 budget_lines: child on a same-org budget is allowed');

-- ---------------------------------------------------------------------------
-- purchase_request_items -> purchase_requests (pr_id).
-- ---------------------------------------------------------------------------
select throws_ok($$
  insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values ('b0000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-000000000001',
          '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4', 5, 'kg')
$$, '42501', null, 'RLS-H1 purchase_request_items: child on a foreign-org PR is denied');
select lives_ok($$
  insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values ('a0000000-0000-0000-0000-0000000000f1',
          '00000000-0000-0000-0000-000000000001',
          '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4', 5, 'kg')
$$, 'RLS-H1 purchase_request_items: child on a same-org PR is allowed');

reset role;
select * from finish();
rollback;

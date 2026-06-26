-- 62 — #235: a PR line / plan material requirement may only reference an item from its own org. Before
-- 0061 the tenant_all WITH CHECK gated org + the parent row's org, but not item_id's org — so a member
-- who knows a foreign item's UUID could insert a cross-org item line (the FK only checks existence). 0061
-- adds an item-org EXISTS. A second org (orgB) + its item are seeded as superuser; the orgA member's
-- cross-org insert must be refused, the same-org insert must succeed. Impersonation via request.jwt.claims.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set orgB  '0b000000-0000-0000-0000-0000000000b0'
\set itemA '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set itemB '0b000000-0000-0000-0000-0000000000b1'
\set pr    '0c000000-0000-0000-0000-0000000000c1'
\set plan  '0c000000-0000-0000-0000-0000000000c2'
\set op    '0c000000-0000-0000-0000-0000000000c3'

select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

-- a FOREIGN org + its item (the cross-org bait), and orgA parents — all as superuser
insert into public.organization (id, name) values (:'orgB', 'مزرعة أخرى');
insert into public.inventory_items (id, org_id, name) values (:'itemB', :'orgB', 'صنف مزرعة أخرى');
insert into public.purchase_requests (id, org_id, code, status) values (:'pr', :'orgA', 'PR-XORG-62', 'draft');
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');
insert into public.plan_operations (id, org_id, plan_id, subtype, status)
  values (:'op', :'orgA', :'plan', 'fertilization', 'planned');

-- ===== purchase_request_items: a member (storekeeper) cannot reference orgB's item =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
            values (%L, %L, %L, 10, 'kg') $$, :'pr', :'orgA', :'itemB'),
  '42501', null,
  '#235: a PR line cannot reference a CROSS-ORG item (orgB item refused)');

select lives_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
            values (%L, %L, %L, 10, 'kg') $$, :'pr', :'orgA', :'itemA'),
  '#235: a PR line CAN reference a same-org item (orgA item)');

reset role;

-- ===== plan_material_requirements: an owner (plan.write) cannot reference orgB's item =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values (%L, %L, %L, 5, 'kg') $$, :'orgA', :'op', :'itemB'),
  '42501', null,
  '#235: a plan material requirement cannot reference a CROSS-ORG item');

select lives_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values (%L, %L, %L, 5, 'kg') $$, :'orgA', :'op', :'itemA'),
  '#235: a plan material requirement CAN reference a same-org item');

reset role;

-- structural: both policies carry the item-org EXISTS
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename in ('purchase_request_items','plan_material_requirements')
       and policyname='tenant_all' and with_check ilike '%inventory_items it%'),
  2,
  '#235: both tenant_all policies gate item_id to the same org');

select * from finish();
rollback;

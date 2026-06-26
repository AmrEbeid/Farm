-- 64 — #306: the remaining member-writable tables reject a CROSS-ORG FK reference, matching the
-- expenses model. supplier_id (PR items, inventory items), plan_id (plan_checks), person_id
-- (responsibility_assignments) must all point at a SAME-ORG row. A foreign org (orgB) + its supplier /
-- plan / person are seeded as superuser; the orgA member's cross-org reference is refused. Impersonation
-- via request.jwt.claims (these tables are org-only, so any member writes them).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(6);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set orgB   '06400000-0000-0000-0000-0000000000b0'
\set itemA  '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set supB   '06400000-0000-0000-0000-0000000000b1'
\set planB  '06400000-0000-0000-0000-0000000000b2'
\set persB  '06400000-0000-0000-0000-0000000000b3'
\set supA   '06400000-0000-0000-0000-0000000000a1'
\set pr     '06400000-0000-0000-0000-0000000000c1'

select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- foreign org + its rows (the cross-org bait), an orgA supplier + PR for the same-org control
insert into public.organization (id, name) values (:'orgB', 'مزرعة رابعة');
insert into public.suppliers (id, org_id, name) values (:'supB', :'orgB', 'مورد بعيد'), (:'supA', :'orgA', 'مورد محلي');
insert into public.plans (id, org_id, type, status) values (:'planB', :'orgB', 'monthly', 'draft');
insert into public.people (id, org_id, name) values (:'persB', :'orgB', 'شخص بعيد');
insert into public.purchase_requests (id, org_id, code, status) values (:'pr', :'orgA', 'PR-FKSWEEP', 'draft');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1) PR line cannot reference a cross-org supplier
select throws_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit, supplier_id)
            values (%L, %L, %L, 10, 'kg', %L) $$, :'pr', :'orgA', :'itemA', :'supB'),
  '42501', null, '#306: a PR line cannot reference a CROSS-ORG supplier');

-- ...but a same-org supplier is fine (no over-block)
select lives_ok(
  format($$ insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit, supplier_id)
            values (%L, %L, %L, 10, 'kg', %L) $$, :'pr', :'orgA', :'itemA', :'supA'),
  '#306: a PR line CAN reference a same-org supplier');

-- 2) inventory item cannot set a cross-org preferred supplier
select throws_ok(
  format($$ insert into public.inventory_items (org_id, name, preferred_supplier_id)
            values (%L, 'صنف', %L) $$, :'orgA', :'supB'),
  '42501', null, '#306: an inventory item cannot set a CROSS-ORG preferred supplier');

-- 3) plan_check cannot attach to a cross-org plan
select throws_ok(
  format($$ insert into public.plan_checks (org_id, plan_id, kind, result)
            values (%L, %L, 'stock', 'ok') $$, :'orgA', :'planB'),
  '42501', null, '#306: a plan_check cannot attach to a CROSS-ORG plan');

-- 4) responsibility cannot be assigned to a cross-org person
select throws_ok(
  format($$ insert into public.responsibility_assignments (org_id, person_id, scope_type, responsibility_type)
            values (%L, %L, 'farm', 'accountable_manager') $$, :'orgA', :'persB'),
  '42501', null, '#306: a responsibility cannot be assigned to a CROSS-ORG person');

reset role;

-- structural: all four policies now carry their FK-org clause
select is(
  (select count(*)::int from pg_policies p where p.schemaname='public' and p.policyname='tenant_all' and (
       (p.tablename='purchase_request_items'     and p.with_check ilike '%suppliers sup%') or
       (p.tablename='inventory_items'            and p.with_check ilike '%suppliers sup%') or
       (p.tablename='plan_checks'                and p.with_check ilike '%plans p%')        or
       (p.tablename='responsibility_assignments' and p.with_check ilike '%people pe%'))),
  4, '#306: all four tables gate their FK reference to the same org');

select * from finish();
rollback;

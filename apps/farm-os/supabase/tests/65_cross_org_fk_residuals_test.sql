-- 65 — #306 (residual tail): the remaining member-writable tables reject a CROSS-ORG nullable FK —
-- quantities.material_id, event_followups.assigned_to_person_id, plan_operations.responsible_person_id,
-- farm_event.assigned_to_person_id (+ event_locations' location FKs, pinned structurally). A foreign org
-- (orgB) + its person/item are seeded as superuser; the orgA owner (op.execute + plan.write) is refused
-- when referencing them. Impersonation via request.jwt.claims.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set orgB  '06500000-0000-0000-0000-0000000000b0'
\set persB '06500000-0000-0000-0000-0000000000b3'
\set itemB '06500000-0000-0000-0000-0000000000b1'
\set evt   '06500000-0000-0000-0000-0000000000c1'
\set plan  '06500000-0000-0000-0000-0000000000c2'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

-- foreign org + its person/item; orgA parents (an event + a plan)
insert into public.organization (id, name) values (:'orgB', 'مزرعة خامسة');
insert into public.people (id, org_id, name) values (:'persB', :'orgB', 'شخص بعيد');
insert into public.inventory_items (id, org_id, name) values (:'itemB', :'orgB', 'مادة بعيدة');
insert into public.farm_event (id, org_id, type, occurred_at) values (:'evt', :'orgA', 'note', '2025-07-15');
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1) quantities cannot tag a cross-org material
select throws_ok(
  format($$ insert into public.quantities (org_id, event_id, material_id)
            values (%L, %L, %L) $$, :'orgA', :'evt', :'itemB'),
  '42501', null, '#306: quantities cannot reference a CROSS-ORG material');

-- 2) event_followups cannot assign a cross-org person
select throws_ok(
  format($$ insert into public.event_followups (org_id, event_id, assigned_to_person_id, status, note)
            values (%L, %L, %L, 'open', 'متابعة') $$, :'orgA', :'evt', :'persB'),
  '42501', null, '#306: event_followups cannot assign a CROSS-ORG person');

-- 3) plan_operations cannot set a cross-org responsible person
select throws_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status, responsible_person_id)
            values (%L, %L, 'fertilization', 'planned', %L) $$, :'orgA', :'plan', :'persB'),
  '42501', null, '#306: plan_operations cannot set a CROSS-ORG responsible person');

-- 4) farm_event (partitioned) cannot assign a cross-org person
select throws_ok(
  format($$ insert into public.farm_event (org_id, type, occurred_at, assigned_to_person_id)
            values (%L, 'note', '2025-07-16', %L) $$, :'orgA', :'persB'),
  '42501', null, '#306: farm_event cannot assign a CROSS-ORG person');

reset role;

-- structural: all five policies now carry their FK-org clause(s)
select is(
  (select count(*)::int from pg_policies p where p.schemaname='public' and p.policyname='tenant_all' and (
       (p.tablename='quantities'        and p.with_check ilike '%inventory_items it%') or
       (p.tablename='event_followups'   and p.with_check ilike '%people pe%')          or
       (p.tablename='event_locations'   and p.with_check ilike '%farms f%')            or
       (p.tablename='plan_operations'   and p.with_check ilike '%people pe%')          or
       (p.tablename='farm_event'        and p.with_check ilike '%people pe%'))),
  5, '#306: all five residual tables gate their FK reference(s) to the same org');

select * from finish();
rollback;

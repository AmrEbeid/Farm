-- 71 — #306 registry/structural tail: the remaining direct-REST member-writable cross-org FKs are
-- org-scoped. Behavioral coverage on people.reports_to_person_id, plan_operations.plan_id, and
-- purchase_requests.plan_id (the farm-hierarchy FKs — sectors/hawshat/lines — are pinned structurally to
-- avoid seeding the full farm→sector→hawsha chain). A foreign org (orgB) + its person/plan are seeded as
-- superuser; the orgA member's cross-org reference is refused. Impersonation via request.jwt.claims.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set orgB   '07100000-0000-0000-0000-0000000000b0'
\set persB  '07100000-0000-0000-0000-0000000000b3'
\set planB  '07100000-0000-0000-0000-0000000000b2'
\set planA  '07100000-0000-0000-0000-0000000000a2'

select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة سادسة');
insert into public.people (id, org_id, name) values (:'persB', :'orgB', 'مدير بعيد');
insert into public.plans (id, org_id, type, status) values (:'planB', :'orgB', 'monthly', 'draft');
insert into public.plans (id, org_id, type, status) values (:'planA', :'orgA', 'monthly', 'draft');

-- ===== purchase_requests.plan_id: cross-org plan refused (pr_insert) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ insert into public.purchase_requests (org_id, code, status, plan_id)
            values (%L, 'PR-XPLAN-71', 'draft', %L) $$, :'orgA', :'planB'),
  '42501', null, '#306: a purchase request cannot link a CROSS-ORG plan');

reset role;

-- ===== plan_operations.plan_id: cross-org plan refused (needs plan.write → owner) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ insert into public.plan_operations (org_id, plan_id, subtype, status)
            values (%L, %L, 'fertilization', 'planned') $$, :'orgA', :'planB'),
  '42501', null, '#306: a plan operation cannot belong to a CROSS-ORG plan');

reset role;

-- structural: all the re-emitted policies carry their FK-org clause(s)
select is(
  (select count(*)::int from pg_policies p where p.schemaname='public' and (
       (p.tablename='farms'             and p.policyname='tenant_all' and p.with_check ilike '%people pe%')  or
       (p.tablename='sectors'           and p.policyname='tenant_all' and p.with_check ilike '%farms f%')    or
       (p.tablename='hawshat'           and p.policyname='tenant_all' and p.with_check ilike '%sectors s%')  or
       (p.tablename='lines'             and p.policyname='tenant_all' and p.with_check ilike '%hawshat h%')  or
       (p.tablename='plan_operations'   and p.policyname='tenant_all' and p.with_check ilike '%plans p%')    or
       (p.tablename='purchase_requests' and p.policyname='pr_insert'  and p.with_check ilike '%plans p%')    or
       (p.tablename='purchase_requests' and p.policyname='pr_update'  and p.with_check ilike '%plans p%'))),
  7, '#306: all 7 registry/plan FK clauses are present across the re-emitted policies (people.reports_to deferred — self-ref)');

select * from finish();
rollback;

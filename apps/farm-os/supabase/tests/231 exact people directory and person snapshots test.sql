-- SPEC-0033 R4c: the PEOPLE DIRECTORY and PERSON 360 snapshots are exact, bounded, active-
-- organisation only, gated in PostgreSQL to the exact role set the routes already use, and carry no
-- contact PII, no auth identity, no wage and no money key.
--
-- The four facts this file exists to pin:
--   1. OPEN means NONTERMINAL — the surface it replaces counted the literal status `planned`, so an
--      operation already `in_progress` read as no workload at all;
--   2. a person is linked to an operation through the assignee table OR the legacy
--      `responsible_person_id`, the two are UNIONed and DE-DUPLICATED in SQL, and a person who is
--      both counts exactly once;
--   3. every exact total is published SEPARATELY from its bounded page/sample — a sample length is
--      never the total, and the manager option list is published in full or fails loudly;
--   4. a person outside the active organisation reads exactly like a person who does not exist.
begin;
select no_plan();

\set org '23100000-0000-0000-0000-0000000000a0'
\set org_b '23100000-0000-0000-0000-0000000000b0'
\set p_manager '23100000-0000-0000-0000-000000000001'
\set p_lead '23100000-0000-0000-0000-000000000002'
\set p_worker '23100000-0000-0000-0000-000000000003'
\set p_idle '23100000-0000-0000-0000-000000000004'
\set p_inactive '23100000-0000-0000-0000-000000000005'
\set b_person '23100000-0000-0000-0000-0000000000f1'
\set plan_a '23100000-0000-0000-0000-000000000011'
\set plan_b '23100000-0000-0000-0000-0000000000f2'
\set op_planned '23100000-0000-0000-0000-000000000021'
\set op_progress '23100000-0000-0000-0000-000000000022'
\set op_done '23100000-0000-0000-0000-000000000023'
\set op_both '23100000-0000-0000-0000-000000000024'
\set op_skipped '23100000-0000-0000-0000-000000000025'
\set op_b '23100000-0000-0000-0000-0000000000f3'
\set missing '23100000-0000-0000-0000-0000000000ff'

select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.agronomist', (select user_id::text from public.organization_member where role = 'agri_engineer' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where role = 'supervisor' limit 1), false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact people directory org'),
  (:'org_b', 'Exact people foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.agronomist')::uuid, 'agri_engineer'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.supervisor')::uuid, 'supervisor'),
  (:'org', current_setting('test.storekeeper')::uuid, 'storekeeper'),
  (:'org_b', current_setting('test.owner')::uuid, 'owner'),
  (:'org_b', current_setting('test.manager')::uuid, 'farm_manager');
-- Deliberately PARTIAL: an incomplete source must NOT blank an exact recorded count.
insert into public.data_authority_status(org_id, domain, status, source_label, record_count, notes) values
  (:'org', 'operations', 'partial', 'fixture', 5, 'partial test fixture');

-- ── the roster. phone/email are populated on purpose: the payload must never carry them ────────
insert into public.people(id, org_id, name, position, employment_type, active, reports_to_person_id, phone, email) values
  (:'p_manager', :'org', 'مدير الفريق', 'مدير المزرعة', 'permanent', true, null, '01000000001', 'manager@example.test'),
  (:'p_lead', :'org', 'قائد الوردية', 'مشرف', 'daily', true, :'p_manager', '01000000002', 'lead@example.test'),
  (:'p_worker', :'org', 'عامل مسند', 'عامل حقل', 'seasonal', true, :'p_manager', '01000000003', 'worker@example.test'),
  (:'p_idle', :'org', 'عامل بلا تكليف', 'عامل حقل', null, true, :'p_manager', null, null),
  (:'p_inactive', :'org', 'عامل غير نشط', null, 'contractor', false, :'p_manager', null, null),
  (:'b_person', :'org_b', 'شخص أجنبي', 'عامل', 'daily', true, null, '01999999999', 'foreign@example.test');

insert into public.plans(id, org_id, type, period_start, period_end, status) values
  (:'plan_a', :'org', 'weekly', '2026-08-01', '2026-08-31', 'active'),
  (:'plan_b', :'org_b', 'weekly', '2026-08-01', '2026-08-31', 'active');

-- est_cost is populated on purpose: planned money must never reach either payload.
insert into public.plan_operations(id, org_id, plan_id, subtype, planned_at, ends_on, status, responsible_person_id, est_cost) values
  (:'op_planned', :'org', :'plan_a', 'irrigation',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date + 1, null, 'planned', :'p_lead', 1500),
  -- Already started. The surface this replaces counted only the literal `planned`, so this one read
  -- as no workload at all.
  (:'op_progress', :'org', :'plan_a', 'pruning_dethorning',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date - 1,
    (pg_catalog.now() at time zone 'Africa/Cairo')::date + 2, 'in_progress', null, 900),
  (:'op_done', :'org', :'plan_a', 'harvest',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date - 5, null, 'done', :'p_worker', 700),
  -- Responsible person AND assignee: the de-duplicating union must count it exactly once.
  (:'op_both', :'org', :'plan_a', 'pollination', null, null, 'ready', :'p_lead', 250),
  (:'op_skipped', :'org', :'plan_a', 'thinning',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date - 2, null, 'skipped', :'p_lead', 100),
  (:'op_b', :'org_b', :'plan_b', 'irrigation',
    (pg_catalog.now() at time zone 'Africa/Cairo')::date, null, 'planned', :'b_person', 999);

insert into public.plan_operation_assignees(org_id, plan_op_id, person_id, is_lead) values
  (:'org', :'op_progress', :'p_worker', true),
  (:'org', :'op_done', :'p_worker', false),
  (:'org', :'op_both', :'p_lead', true),
  (:'org_b', :'op_b', :'b_person', true);

insert into public.farm_event(id, org_id, type, subtype, status, occurred_at, performed_by_person_id, assigned_to_person_id, notes, created_by) values
  ('23100000-0000-0000-0000-000000000031', :'org', 'operation', 'irrigation', 'done',
    pg_catalog.now() - interval '1 day', :'p_worker', null, 'رية كاملة', current_setting('test.owner')::uuid),
  ('23100000-0000-0000-0000-000000000032', :'org', 'operation', 'fertilization', 'done',
    pg_catalog.now() - interval '2 day', :'p_worker', null, null, current_setting('test.owner')::uuid),
  ('23100000-0000-0000-0000-000000000033', :'org', 'inspection', null, 'done',
    pg_catalog.now() - interval '3 day', :'p_worker', null, 'فحص دوري', current_setting('test.owner')::uuid),
  ('23100000-0000-0000-0000-000000000034', :'org', 'operation', 'spraying', 'in_progress',
    pg_catalog.now(), null, :'p_worker', 'مكافحة جارية', current_setting('test.owner')::uuid),
  ('23100000-0000-0000-0000-000000000035', :'org', 'operation', 'bagging', 'done',
    pg_catalog.now() - interval '4 day', null, :'p_worker', null, current_setting('test.owner')::uuid),
  ('23100000-0000-0000-0000-0000000000f4', :'org_b', 'operation', 'irrigation', 'planned',
    pg_catalog.now(), :'b_person', :'b_person', 'أجنبي', current_setting('test.owner')::uuid);

-- ── grants and metadata ────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('public', 'public.fn_people_directory_snapshot(uuid,text,text,integer,integer)', 'EXECUTE'), 'PUBLIC cannot execute the people directory snapshot');
select ok(not has_function_privilege('anon', 'public.fn_people_directory_snapshot(uuid,text,text,integer,integer)', 'EXECUTE'), 'anon cannot execute the people directory snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_people_directory_snapshot(uuid,text,text,integer,integer)', 'EXECUTE'), 'authenticated reaches the people directory gate');
select ok(not has_function_privilege('public', 'public.fn_person_snapshot(uuid,uuid,integer,integer,integer,integer)', 'EXECUTE'), 'PUBLIC cannot execute the person snapshot');
select ok(not has_function_privilege('anon', 'public.fn_person_snapshot(uuid,uuid,integer,integer,integer,integer)', 'EXECUTE'), 'anon cannot execute the person snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_person_snapshot(uuid,uuid,integer,integer,integer,integer)', 'EXECUTE'), 'authenticated reaches the person snapshot gate');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_people_directory_snapshot(uuid,text,text,integer,integer)'::regprocedure), 'directory snapshot is SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_person_snapshot(uuid,uuid,integer,integer,integer,integer)'::regprocedure), 'person snapshot is SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'public.fn_people_directory_snapshot(uuid,text,text,integer,integer)'::regprocedure), 's', 'directory snapshot is stable');
select is((select provolatile::text from pg_proc where oid = 'public.fn_person_snapshot(uuid,uuid,integer,integer,integer,integer)'::regprocedure), 's', 'person snapshot is stable');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_people_directory_snapshot(uuid,text,text,integer,integer)'::regprocedure), 'search_path=""', 'directory snapshot has an empty search_path');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_person_snapshot(uuid,uuid,integer,integer,integer,integer)'::regprocedure), 'search_path=""', 'person snapshot has an empty search_path');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when active_org is null
    then json_build_object('sub', uid, 'role', 'authenticated')
    else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text, true);
  execute 'set local role authenticated';
end $$;

-- ── the directory: exact totals, open == nonterminal, de-duplicated links ──────────────────────
select pg_temp.as_user(current_setting('test.owner'), :'org');
select set_config('test.dir', public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)::text, false);

select is(current_setting('test.dir')::jsonb->>'version', 'farm-os.people-directory.v1', 'directory version is pinned');
select is(current_setting('test.dir')::jsonb->>'org_id', :'org', 'the directory is bound to the active organization');
select is(current_setting('test.dir')::jsonb->'authority'->>'operations', 'partial', 'operations authority is reported as partial');
select ok(current_setting('test.dir')::jsonb->'query' = 'null'::jsonb, 'an absent search is published as null, not an empty string');
select is(current_setting('test.dir')::jsonb->>'filter', 'all', 'the filter the page was built for is published back');

select is((current_setting('test.dir')::jsonb->'counts'->>'total_people')::integer, 5, 'every recorded person in the organization is counted');
select is((current_setting('test.dir')::jsonb->'counts'->>'query_total')::integer, 5, 'with no search the searched total is the whole roster');
select is((current_setting('test.dir')::jsonb->'counts'->>'matching')::integer, 5, 'with no filter the page denominator is the searched total');
select is((current_setting('test.dir')::jsonb->'counts'->>'active')::integer, 4, 'the exact active count is published');
select is((current_setting('test.dir')::jsonb->'counts'->>'inactive')::integer, 1, 'the exact inactive count is published');
select is((current_setting('test.dir')::jsonb->'counts'->>'active')::bigint
        + (current_setting('test.dir')::jsonb->'counts'->>'inactive')::bigint,
          (current_setting('test.dir')::jsonb->'counts'->>'query_total')::bigint,
  'active and inactive partition the searched people exactly');
select is((current_setting('test.dir')::jsonb->'counts'->>'assigned')::integer, 2,
  'assigned counts people with at least one NONTERMINAL operation, through either link');
select ok(jsonb_typeof(current_setting('test.dir')::jsonb->'counts'->'total_people') = 'string',
  'counts leave PostgreSQL as exact text');
select ok(jsonb_typeof(current_setting('test.dir')::jsonb->'rows'->0->'active') = 'boolean',
  'the active flag leaves PostgreSQL as a real boolean, never text');

-- The workload figure is the whole point of the rebuild: an in_progress operation IS open work, a
-- done or skipped one is not, and being both responsible AND an assignee counts once.
select is((select r->>'open_operations' from jsonb_array_elements(current_setting('test.dir')::jsonb->'rows') r
            where r->>'name' = 'عامل مسند'), '1',
  'an in_progress operation counts as open work — the literal planned test used to miss it');
select is((select r->>'open_operations' from jsonb_array_elements(current_setting('test.dir')::jsonb->'rows') r
            where r->>'name' = 'قائد الوردية'), '2',
  'responsible-person and assignee links are de-duplicated: two open operations, not three');
select is((select r->>'open_operations' from jsonb_array_elements(current_setting('test.dir')::jsonb->'rows') r
            where r->>'name' = 'عامل بلا تكليف'), '0',
  'a person with no open operation is published as an exact zero');
select is((select r->>'manager_name' from jsonb_array_elements(current_setting('test.dir')::jsonb->'rows') r
            where r->>'name' = 'قائد الوردية'), 'مدير الفريق',
  'the manager name is resolved in SQL, not from the rows of the page');
select ok((select r->'manager_id' = 'null'::jsonb and r->'manager_name' = 'null'::jsonb
             from jsonb_array_elements(current_setting('test.dir')::jsonb->'rows') r
            where r->>'name' = 'مدير الفريق'),
  'a person with no manager carries JSON null on both halves of the reference');
select ok((select r->'position' = 'null'::jsonb
             from jsonb_array_elements(current_setting('test.dir')::jsonb->'rows') r
            where r->>'name' = 'عامل غير نشط'),
  'an unrecorded position is null, never an invented dash');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.dir')::jsonb->'rows') r
     where r->>'name' = 'شخص أجنبي'),
  'another organization''s person never appears');

-- ── no contact PII, no auth id, no wage, no money ──────────────────────────────────────────────
select ok(current_setting('test.dir') not like '%phone%'
      and current_setting('test.dir') not like '%email%'
      and current_setting('test.dir') not like '%01000000%'
      and current_setting('test.dir') not like '%example.test%',
  'the directory carries no contact PII at all');
select ok(current_setting('test.dir') not like '%user_id%'
      and current_setting('test.dir') not like '%created_by%'
      and current_setting('test.dir') not like '%signed_off%',
  'the directory names no auth or audit identity');
select ok(current_setting('test.dir') not like '%est_cost%'
      and current_setting('test.dir') not like '%rate%'
      and current_setting('test.dir') not like '%wage%'
      and current_setting('test.dir') not like '%gross%'
      and current_setting('test.dir') not like '%amount%'
      and current_setting('test.dir') not like '%1500%',
  'the directory carries no wage and no money key');

-- ── deterministic order and real paging ────────────────────────────────────────────────────────
select is(jsonb_array_length(current_setting('test.dir')::jsonb->'rows'), 5, 'the page holds every matching person when it fits');
select ok((select bool_and((r->>'active')::boolean)
             from jsonb_array_elements(current_setting('test.dir')::jsonb->'rows') with ordinality t(r, n)
            where n <= 4),
  'active people lead the deterministic order');
select is(current_setting('test.dir')::jsonb->'rows'->4->>'name', 'عامل غير نشط', 'and the inactive one is last');
select is(jsonb_array_length(public.fn_people_directory_snapshot(:'org', null, 'all', 2, 0)->'rows'), 2, 'the page obeys its limit');
select is(jsonb_array_length(public.fn_people_directory_snapshot(:'org', null, 'all', 2, 4)->'rows'), 1, 'the last page holds only what is left');
select is(jsonb_array_length(public.fn_people_directory_snapshot(:'org', null, 'all', 2, 6)->'rows'), 0, 'a page past the end is empty, not an error');
select is((public.fn_people_directory_snapshot(:'org', null, 'all', 2, 0)->'counts'->>'matching')::integer, 5,
  'the exact total is published SEPARATELY from the bounded page');
select is(public.fn_people_directory_snapshot(:'org', null, 'all', 2, 4)->'rows'->0->>'name', 'عامل غير نشط',
  'the offset lands on the row the deterministic order puts there');
select is((select pg_catalog.count(distinct r->>'person_id')::integer
             from (select jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'all', 2, 0)->'rows') r
                   union all
                   select jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'all', 2, 2)->'rows')
                   union all
                   select jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'all', 2, 4)->'rows')) pages),
  5, 'three consecutive pages cover every person exactly once — the order is a total order');
-- A manager who is NOT on the current page must still be named on it.
select is(public.fn_people_directory_snapshot(:'org', 'قائد', 'all', 1, 0)->'rows'->0->>'manager_name', 'مدير الفريق',
  'a manager off the page is still named truthfully on it');

-- ── search: matches name and position, and escapes its own metacharacters ──────────────────────
select is((public.fn_people_directory_snapshot(:'org', 'قائد', 'all', 20, 0)->'counts'->>'query_total')::integer, 1,
  'a search matches the person name');
select is((public.fn_people_directory_snapshot(:'org', 'مشرف', 'all', 20, 0)->'counts'->>'query_total')::integer, 1,
  'a search matches the recorded position too');
select is((public.fn_people_directory_snapshot(:'org', 'عامل', 'all', 20, 0)->'counts'->>'query_total')::integer, 3,
  'a broader search matches every person it should');
select is((public.fn_people_directory_snapshot(:'org', 'قائد', 'all', 20, 0)->'counts'->>'total_people')::integer, 5,
  'a search narrows the searched total but never the organization total');
select is(public.fn_people_directory_snapshot(:'org', '  مشرف  ', 'all', 20, 0)->>'query', 'مشرف',
  'the published search is the trimmed value the query actually used');
select is((public.fn_people_directory_snapshot(:'org', '%', 'all', 20, 0)->'counts'->>'query_total')::integer, 0,
  'a typed per-cent sign is escaped and matches nothing');
select is((public.fn_people_directory_snapshot(:'org', '_', 'all', 20, 0)->'counts'->>'query_total')::integer, 0,
  'a typed underscore is escaped and matches nothing');
select is((public.fn_people_directory_snapshot(:'org', '\', 'all', 20, 0)->'counts'->>'query_total')::integer, 0,
  'a typed backslash is escaped and matches nothing');
select is((public.fn_people_directory_snapshot(:'org', 'عامل', 'active', 20, 0)->'counts'->>'matching')::integer, 2,
  'search and filter compose: the page denominator is the intersection');

-- ── filters reconcile with the chip that selected them ─────────────────────────────────────────
select is((public.fn_people_directory_snapshot(:'org', null, 'active', 20, 0)->'counts'->>'matching')::integer, 4,
  'the active filter matches exactly its own count');
select ok(not exists (
    select 1 from jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'active', 20, 0)->'rows') r
     where not (r->>'active')::boolean),
  'an active-only page contains nobody inactive');
select is((public.fn_people_directory_snapshot(:'org', null, 'assigned', 20, 0)->'counts'->>'matching')::integer, 2,
  'the assigned filter matches exactly its own count');
select ok(not exists (
    select 1 from jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'assigned', 20, 0)->'rows') r
     where r->>'open_operations' = '0'),
  'an assigned-only page contains nobody without open work');

-- ── the manager option list is published in full, and only to a writer ─────────────────────────
select ok((current_setting('test.dir')::jsonb->>'can_write')::boolean, 'the owner can onboard, and the payload says so');
select is(jsonb_array_length(current_setting('test.dir')::jsonb->'manager_options'), 4,
  'every ACTIVE person is offered as a manager, whatever page the caller is on');
select ok(exists (
    select 1 from jsonb_array_elements(current_setting('test.dir')::jsonb->'manager_options') o
     where o->>'name' = 'مدير الفريق'),
  'and the list names them');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.dir')::jsonb->'manager_options') o
     where o->>'name' = 'عامل غير نشط'),
  'an inactive person is not offered as a new hire''s manager');
select is(jsonb_array_length(public.fn_people_directory_snapshot(:'org', null, 'all', 1, 0)->'manager_options'), 4,
  'the option list is independent of the page bound — a one-row page still offers every manager');
reset role;

-- ── the exact role set the routes use is re-decided in PostgreSQL ──────────────────────────────
select pg_temp.as_user(current_setting('test.manager'), :'org');
select ok((public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->>'can_write')::boolean,
  'the farm manager can onboard too');
reset role;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select is((public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->'counts'->>'total_people')::integer, 5,
  'the agronomist keeps exactly the directory read it has today');
select ok(not (public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->>'can_write')::boolean,
  'but cannot onboard');
select ok(not (public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0) ? 'manager_options'),
  'so the manager option list is not even built for that caller');
reset role;
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select is((public.fn_person_snapshot(:'org', :'p_lead', 10, 8, 8, 10)->'person'->>'name'), 'قائد الوردية',
  'the accountant keeps exactly the person read it has today');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  '42501', null, 'a supervisor is refused the directory, in PostgreSQL and not only in React');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 10)$$, :'org', :'p_lead'),
  '42501', null, 'and is refused a person file too');
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  '42501', null, 'a storekeeper is refused the directory');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 10)$$, :'org', :'p_lead'),
  '42501', null, 'and is refused a person file');
reset role;

-- ── the person 360: exact totals beside four independently bounded samples ─────────────────────
select pg_temp.as_user(current_setting('test.owner'), :'org');
select set_config('test.person', public.fn_person_snapshot(:'org', :'p_lead', 10, 8, 8, 10)::text, false);

select is(current_setting('test.person')::jsonb->>'version', 'farm-os.person-360.v1', 'person version is pinned');
select is(current_setting('test.person')::jsonb->>'person_id', :'p_lead', 'the snapshot is bound to its person');
select is(current_setting('test.person')::jsonb->'person'->>'name', 'قائد الوردية', 'the person is identified by name');
select is(current_setting('test.person')::jsonb->'person'->>'position', 'مشرف', 'the recorded position is published');
select is(current_setting('test.person')::jsonb->'person'->>'employment_type', 'daily', 'the recorded employment type is published');
select is(current_setting('test.person')::jsonb->'person'->>'manager_name', 'مدير الفريق', 'the manager is named from the same organization');
select ok((current_setting('test.person')::jsonb->'person'->>'active')::boolean, 'the recorded status is published');

select is(current_setting('test.person')::jsonb->'operations'->>'total', '3',
  'every operation the person is linked to is counted, terminal ones included');
select is(current_setting('test.person')::jsonb->'operations'->>'open_total', '2',
  'and the open subset is counted separately — de-duplicated across both link kinds');
select is(jsonb_array_length(current_setting('test.person')::jsonb->'operations'->'rows'), 2,
  'the sample holds the open operations, not the terminal ones');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.person')::jsonb->'operations'->'rows') o
     where o->>'status' in ('done', 'blocked', 'abandoned', 'skipped')),
  'no terminal operation appears in the open workload sample');
select is(current_setting('test.person')::jsonb->'operations'->'rows'->0->>'plan_op_id', :'op_planned',
  'the earliest scheduled open operation leads the sample');
select ok(current_setting('test.person')::jsonb->'operations'->'rows'->1->'planned_at' = 'null'::jsonb,
  'and an unscheduled operation sorts last rather than being dropped');
select ok((select (o->>'is_responsible')::boolean and (o->>'is_lead')::boolean
             from jsonb_array_elements(current_setting('test.person')::jsonb->'operations'->'rows') o
            where o->>'plan_op_id' = :'op_both'),
  'an operation linked BOTH ways is one row that states both links');
select ok((select (o->>'is_responsible')::boolean and not (o->>'is_lead')::boolean
             from jsonb_array_elements(current_setting('test.person')::jsonb->'operations'->'rows') o
            where o->>'plan_op_id' = :'op_planned'),
  'a legacy responsible-person link is published as exactly that');
select is(current_setting('test.person')::jsonb->'operations'->'rows'->0->>'plan_id', :'plan_a',
  'each operation carries the plan its record lives in');
-- The sample is bounded INDEPENDENTLY of the total it is published beside.
select is(jsonb_array_length(public.fn_person_snapshot(:'org', :'p_lead', 1, 8, 8, 10)->'operations'->'rows'), 1,
  'a tighter operation bound returns fewer rows');
select is(public.fn_person_snapshot(:'org', :'p_lead', 1, 8, 8, 10)->'operations'->>'open_total', '2',
  'while the exact open total behind that sample is unchanged — a sample length is never a total');

-- A person linked to the same operation twice is still one operation.
select is(public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'operations'->>'total', '2',
  'an operation a person is BOTH responsible for and assigned to is counted once');
select is(public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'operations'->>'open_total', '1',
  'and only its nonterminal operations are open');
-- A plain assignee on an operation with NO recorded responsible person: both link flags must be real
-- booleans. `responsible_person_id = p_person` is NULL there, not false, so an uncoalesced comparison
-- would publish a JSON null and the strict reader would blank the whole page.
select is(public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'operations'->'rows'->0->>'plan_op_id',
  :'op_progress', 'the open operation of a plain assignee is the one published');
select is(jsonb_typeof(public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'operations'->'rows'->0->'is_responsible'),
  'boolean', 'is_responsible is a real boolean even with no responsible person recorded');
select ok(not (public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'operations'->'rows'->0->>'is_responsible')::boolean,
  'and it says false rather than unknown');
select ok((public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'operations'->'rows'->0->>'is_lead')::boolean,
  'while the assignee lead flag is published as true');
select is(public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'operations'->'rows'->0->>'ends_on',
  ((pg_catalog.now() at time zone 'Africa/Cairo')::date + 2)::text,
  'a multi-day operation publishes its recorded end date as a calendar date');
select ok(public.fn_person_snapshot(:'org', :'p_lead', 10, 8, 8, 10)->'operations'->'rows'->0->'ends_on' = 'null'::jsonb,
  'and a single-day operation publishes an explicit null, never an invented end');

-- The two surfaces must never disagree about the same person's workload: the directory's per-row
-- figure and the person file's own open total are the SAME de-duplicated union, counted once.
select is(
  (select r->>'open_operations' from jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->'rows') r
    where r->>'person_id' = :'p_lead'),
  public.fn_person_snapshot(:'org', :'p_lead', 10, 8, 8, 10)->'operations'->>'open_total',
  'the directory row and the person file agree on the same open workload');
select is(
  (select r->>'open_operations' from jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->'rows') r
    where r->>'person_id' = :'p_worker'),
  public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'operations'->>'open_total',
  'including for a person linked to the same operation both ways');

-- ── recorded activity: exact totals beside their own independently bounded samples ─────────────
select set_config('test.worker', public.fn_person_snapshot(:'org', :'p_worker', 10, 2, 8, 10)::text, false);
select is(current_setting('test.worker')::jsonb->'performed_events'->>'total', '3',
  'the exact performed-event total is published');
select is(jsonb_array_length(current_setting('test.worker')::jsonb->'performed_events'->'rows'), 2,
  'while the sample obeys its own independent bound');
select is(current_setting('test.worker')::jsonb->'performed_events'->'rows'->0->>'event_id',
  '23100000-0000-0000-0000-000000000031',
  'the most recent recorded activity leads the sample');
select is(current_setting('test.worker')::jsonb->'assigned_events'->>'total', '2',
  'the exact assigned-event total is published separately');
select is(current_setting('test.worker')::jsonb->'assigned_events'->>'open_total', '1',
  'and how many of them are still open, on the same nonterminal rule');
select is(jsonb_array_length(current_setting('test.worker')::jsonb->'assigned_events'->'rows'), 2,
  'the assigned sample keeps its own bound, not the performed one');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.worker')::jsonb->'assigned_events'->'rows') e
     where e->>'notes' = 'أجنبي'),
  'another organization''s event never appears on a person file');

-- ── the direct team ────────────────────────────────────────────────────────────────────────────
select set_config('test.boss', public.fn_person_snapshot(:'org', :'p_manager', 10, 8, 8, 2)::text, false);
select is(current_setting('test.boss')::jsonb->'direct_reports'->>'total', '4', 'every direct report is counted');
select is(current_setting('test.boss')::jsonb->'direct_reports'->>'active_total', '3', 'and how many of them are active');
select is(jsonb_array_length(current_setting('test.boss')::jsonb->'direct_reports'->'rows'), 2,
  'while the sample obeys its own independent bound');
select ok((select bool_and((r->>'active')::boolean)
             from jsonb_array_elements(current_setting('test.boss')::jsonb->'direct_reports'->'rows') r),
  'active reports lead the sample');
select is(public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'direct_reports'->>'total', '0',
  'a person with no reports publishes an exact zero, not an absence');
select is(jsonb_array_length(public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'direct_reports'->'rows'), 0,
  'with an empty sample beside it');

-- ── the person payload carries no PII, no auth id, no wage and no money either ─────────────────
select ok(current_setting('test.person') not like '%phone%'
      and current_setting('test.person') not like '%email%'
      and current_setting('test.person') not like '%01000000%'
      and current_setting('test.person') not like '%example.test%',
  'the person file carries no contact PII at all');
select ok(current_setting('test.person') not like '%user_id%'
      and current_setting('test.person') not like '%created_by%'
      and current_setting('test.person') not like '%signed_off%',
  'the person file names no auth or audit identity');
select ok(current_setting('test.person') not like '%est_cost%'
      and current_setting('test.person') not like '%wage%'
      and current_setting('test.person') not like '%gross%'
      and current_setting('test.person') not like '%1500%'
      and current_setting('test.person') not like '%250%',
  'the person file carries no wage and no money key');

-- ── missing and foreign are the same answer ────────────────────────────────────────────────────
select ok(public.fn_person_snapshot(:'org', :'b_person', 10, 8, 8, 10) is null,
  'another organization''s person reads as not found');
select ok(public.fn_person_snapshot(:'org', :'missing', 10, 8, 8, 10) is null,
  'and an id that exists nowhere reads exactly the same');
reset role;

-- ── tenant, claim and argument gates ───────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'), '42501', null, 'a missing active org fails closed on the directory');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 10)$$, :'org', :'p_lead'), '42501', null, 'a missing active org fails closed on the person file');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org_b');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'), '42501', null, 'an active-org mismatch fails closed on the directory');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 10)$$, :'org', :'p_lead'), '42501', null, 'an active-org mismatch fails closed on the person file');
reset role;
select pg_temp.as_user(current_setting('test.agronomist'), :'org_b');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org_b'), '42501', null, 'a non-member of the active org is refused');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'nonsense', 20, 0)$$, :'org'), '22023', null, 'an unknown filter is refused');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 0, 0)$$, :'org'), '22023', null, 'a zero limit is refused');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 51, 0)$$, :'org'), '22023', null, 'a limit above fifty is refused');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, -1)$$, :'org'), '22023', null, 'a negative offset is refused');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 1000001)$$, :'org'), '22023', null, 'an offset past the published ceiling is refused');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, %L, 'all', 20, 0)$$, :'org', pg_catalog.repeat('س', 61)), '22023', null, 'a search longer than a search box is refused');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, %L, 'all', 20, 0)$$, :'org', pg_catalog.repeat('س', 400)), '22023', null, 'an unbounded search value is refused before it is even trimmed');
select throws_ok(format($$select public.fn_people_directory_snapshot(null, null, 'all', 20, 0)$$), '23502', null, 'a null organization is refused');
select throws_ok(format($$select public.fn_person_snapshot(%L, null, 10, 8, 8, 10)$$, :'org'), '23502', null, 'a null person is refused');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 0, 8, 8, 10)$$, :'org', :'p_lead'), '22023', null, 'a zero operation bound is refused');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 51, 8, 10)$$, :'org', :'p_lead'), '22023', null, 'a performed-event bound above fifty is refused');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 0, 10)$$, :'org', :'p_lead'), '22023', null, 'a zero assigned-event bound is refused');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 51)$$, :'org', :'p_lead'), '22023', null, 'a direct-report bound above fifty is refused');
reset role;

-- ── active-org child corruption fails closed on every join these contracts make ────────────────
-- A cross-org manager: the people_reports_to_same_org trigger forbids writing one, so the fixture is
-- written with triggers off to prove the READ refuses corruption it can never itself create.
set local session_replication_role = replica;
update public.people set reports_to_person_id = :'b_person' where id = :'p_idle';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  '23514', null, 'a manager in another organization fails the directory closed');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 10)$$, :'org', :'p_idle'),
  '23514', null, 'and fails that person''s own file closed too');
reset role;
set local session_replication_role = replica;
update public.people set reports_to_person_id = :'p_manager' where id = :'p_idle';

-- An assignee row in this organisation pointing at another organisation's operation.
insert into public.plan_operation_assignees(id, org_id, plan_op_id, person_id, is_lead)
values ('23100000-0000-0000-0000-000000000901', :'org', :'op_b', :'p_worker', false);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  '23514', null, 'an assignee row pointing at a foreign operation fails the directory closed');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 10)$$, :'org', :'p_worker'),
  '23514', null, 'and fails that person''s own file closed too');
reset role;
set local session_replication_role = replica;
delete from public.plan_operation_assignees where id = '23100000-0000-0000-0000-000000000901';

-- An operation in this organisation whose responsible person belongs elsewhere.
update public.plan_operations set responsible_person_id = :'b_person' where id = :'op_progress';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  '23514', null, 'a foreign responsible person fails the directory closed');
reset role;
set local session_replication_role = replica;
update public.plan_operations set responsible_person_id = null where id = :'op_progress';

-- An operation this person is linked to whose PLAN belongs to another organisation: the link would
-- render as a dead route into another tenant's plan.
update public.plan_operations set plan_id = :'plan_b' where id = :'op_planned';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 10)$$, :'org', :'p_lead'),
  '23514', null, 'an operation whose plan is foreign fails that person''s file closed');
reset role;
set local session_replication_role = replica;
update public.plan_operations set plan_id = :'plan_a' where id = :'op_planned';
set local session_replication_role = origin;

-- Once every corrupt link is removed both snapshots read again: the guard is a gate, not a wall.
select pg_temp.as_user(current_setting('test.owner'), :'org');
select lives_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  'a clean organization still reads its directory');
select lives_ok(format($$select public.fn_person_snapshot(%L, %L, 10, 8, 8, 10)$$, :'org', :'p_lead'),
  'a clean organization still reads a person file');
reset role;

-- ── recorded timestamps are ISO-8601, and blank free text is not a recorded value ──────────────
select pg_temp.as_user(current_setting('test.owner'), :'org');
-- A timestamp leaves as ISO-8601 with an explicit offset, not PostgreSQL's space-separated text
-- form: `Date.parse` on a non-ISO string is implementation-defined, and this contract is read by a
-- strict client parser that must never see an unparseable instant.
select matches(
  public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'performed_events'->'rows'->0->>'occurred_at',
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?[+-][0-9]{2}:[0-9]{2}$',
  'a recorded activity timestamp is published as ISO-8601 with an explicit offset');
select is(
  (public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'performed_events'->'rows'->0->>'occurred_at')::timestamptz,
  (select occurred_at from public.farm_event where id = '23100000-0000-0000-0000-000000000031'),
  'and it round-trips to exactly the recorded instant');
reset role;

-- A blank recorded value is NOT a recorded value. It must read as null rather than fail the strict
-- reader on an empty string and blank the whole page.
set local session_replication_role = replica;
update public.people set position = '   ' where id = :'p_idle';
update public.farm_event set notes = '' where id = '23100000-0000-0000-0000-000000000031';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select ok((select r->'position' = 'null'::jsonb
             from jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->'rows') r
            where r->>'name' = 'عامل بلا تكليف'),
  'a whitespace-only recorded position publishes as null, never as blank text');
select ok(public.fn_person_snapshot(:'org', :'p_worker', 10, 8, 8, 10)->'performed_events'->'rows'->0->'notes' = 'null'::jsonb,
  'and an empty recorded note publishes as null too');
select is((select r->>'position' from jsonb_array_elements(public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->'rows') r
            where r->>'name' = 'عامل مسند'), 'عامل حقل',
  'while a real recorded position is untouched');
reset role;
set local session_replication_role = replica;
update public.people set position = 'عامل حقل' where id = :'p_idle';
update public.farm_event set notes = 'رية كاملة' where id = '23100000-0000-0000-0000-000000000031';
set local session_replication_role = origin;

-- ── the manager option ceiling never offers a truncated roster or takes the directory down ─────
-- Added last, so it cannot disturb any count asserted above.
insert into public.people(id, org_id, name, active)
select pg_catalog.gen_random_uuid(), :'org', 'زميل ' || g, true from pg_catalog.generate_series(1, 496) g;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select is(jsonb_array_length(public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->'manager_options'), 500,
  'five hundred active colleagues are still published in full');
reset role;
insert into public.people(id, org_id, name, active)
values (pg_catalog.gen_random_uuid(), :'org', 'زميل إضافي', true);
select pg_temp.as_user(current_setting('test.owner'), :'org');
select lives_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  'beyond the manager-option ceiling the directory itself remains readable');
select is(public.fn_people_directory_snapshot(:'org', null, 'all', 20, 0)->'manager_options', 'null'::jsonb,
  'and the optional manager list becomes null rather than a misleading partial roster');
reset role;
-- A caller who cannot onboard never builds that list, so the ceiling cannot take their page down.
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select lives_ok(format($$select public.fn_people_directory_snapshot(%L, null, 'all', 20, 0)$$, :'org'),
  'and a reader who cannot onboard still gets their directory');
reset role;

select * from finish();
rollback;

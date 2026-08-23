-- SPEC-0033 R3e: the supervisor home is role-exact, active-org-only, current-Cairo-date-only,
-- bounded, finance-free, based ONLY on the caller's real person link, and its actionability mirrors
-- the shipped fn_execute_operation / fn_post_movement rejections rather than inventing gates.
begin;
select no_plan();

\set org '22700000-0000-0000-0000-0000000000a0'
\set org_b '22700000-0000-0000-0000-0000000000b0'
\set org_c '22700000-0000-0000-0000-0000000000c0'
\set org_d '22700000-0000-0000-0000-0000000000d0'
\set plan '22700000-0000-0000-0000-000000000001'
\set draft_plan '22700000-0000-0000-0000-000000000002'
\set me '22700000-0000-0000-0000-000000000003'
\set mate '22700000-0000-0000-0000-000000000004'
\set other '22700000-0000-0000-0000-000000000005'
\set item '22700000-0000-0000-0000-000000000006'
\set item_kg '22700000-0000-0000-0000-000000000007'
\set farm '22700000-0000-0000-0000-000000000011'
\set sector '22700000-0000-0000-0000-000000000012'
\set b_farm '22700000-0000-0000-0000-000000000013'
\set b_sector '22700000-0000-0000-0000-000000000014'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where role = 'supervisor' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.agronomist', (select user_id::text from public.organization_member where role = 'agri_engineer' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact supervisor home org'),
  (:'org_b', 'Exact supervisor foreign org'),
  (:'org_c', 'Exact supervisor unlinked org'),
  (:'org_d', 'Exact supervisor ambiguous org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.supervisor')::uuid, 'supervisor'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.agronomist')::uuid, 'agri_engineer'),
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org_b', current_setting('test.supervisor')::uuid, 'supervisor'),
  (:'org_c', current_setting('test.supervisor')::uuid, 'supervisor'),
  (:'org_d', current_setting('test.supervisor')::uuid, 'supervisor');
-- Deliberately PARTIAL: an incomplete source must NOT blank an exact recorded count.
insert into public.data_authority_status(org_id, domain, status, source_label, record_count, notes) values
  (:'org', 'operations', 'partial', 'fixture', 9, 'partial test fixture');

-- The caller's REAL person link, plus a crew mate and an unrelated colleague.
insert into public.people(id, org_id, name, user_id, active) values
  (:'me', :'org', 'مشرف اختبار', current_setting('test.supervisor')::uuid, true),
  (:'mate', :'org', 'زميل الفريق', null, true),
  (:'other', :'org', 'مشرف آخر', null, true);
-- org_d links the SAME auth user twice → "my work" is not well defined.
insert into public.people(id, org_id, name, user_id, active) values
  ('22700000-0000-0000-0000-0000000000d1', :'org_d', 'تكرار أول', current_setting('test.supervisor')::uuid, true),
  ('22700000-0000-0000-0000-0000000000d2', :'org_d', 'تكرار ثانٍ', current_setting('test.supervisor')::uuid, true);

insert into public.farms(id, org_id, name, code) values
  (:'farm', :'org', 'مزرعة الاختبار', 'F1'),
  (:'b_farm', :'org_b', 'مزرعة أجنبية', 'FB');
insert into public.sectors(id, org_id, farm_id, name, code) values
  (:'sector', :'org', :'farm', 'قطاع الاختبار', 'S1'),
  (:'b_sector', :'org_b', :'b_farm', 'قطاع أجنبي', 'SB');

insert into public.plans(id, org_id, type, period_start, status, scope_type, scope_id) values
  (:'plan', :'org', 'weekly', current_setting('test.today')::date - 7, 'active', 'sector', :'sector'),
  (:'draft_plan', :'org', 'weekly', current_setting('test.today')::date - 7, 'draft', 'sector', :'sector');

insert into public.plan_operations(id, org_id, plan_id, subtype, planned_at, ends_on, status,
                                   responsible_person_id, target_type, target_id) values
  -- overdue, single-day, resolvable sector target → recordable now
  ('22700000-0000-0000-0000-000000000101', :'org', :'plan', 'irrigation', current_setting('test.today')::date - 3, null, 'planned', :'me', 'sector', :'sector'),
  -- multi-day spanning today (inclusive), assigned through plan_operation_assignees, no target
  ('22700000-0000-0000-0000-000000000102', :'org', :'plan', 'pruning_dethorning', current_setting('test.today')::date - 1, current_setting('test.today')::date + 1, 'in_progress', null, null, null),
  -- due today, dose-bearing with only HALF the sign-off pair recorded → blocked template
  ('22700000-0000-0000-0000-000000000103', :'org', :'plan', 'spraying', current_setting('test.today')::date, null, 'planned', :'me', null, null),
  -- assigned but never dated → explicit unscheduled bucket, never counted as due
  ('22700000-0000-0000-0000-000000000104', :'org', :'plan', 'inspection', null, null, 'planned', :'me', null, null),
  -- future work
  ('22700000-0000-0000-0000-000000000105', :'org', :'plan', 'bagging', current_setting('test.today')::date + 3, null, 'planned', :'me', null, null),
  -- due today but assigned to SOMEONE ELSE → never enters this snapshot (no team fallback)
  ('22700000-0000-0000-0000-000000000106', :'org', :'plan', 'irrigation', current_setting('test.today')::date, null, 'planned', :'other', null, null),
  -- terminal status, still dated today → excluded
  ('22700000-0000-0000-0000-000000000107', :'org', :'plan', 'irrigation', current_setting('test.today')::date, null, 'done', :'me', null, null),
  -- due today on a DRAFT plan → inactive plans are out of scope
  ('22700000-0000-0000-0000-000000000108', :'org', :'draft_plan', 'irrigation', current_setting('test.today')::date, null, 'planned', :'me', null, null),
  -- due today, typed target in ANOTHER organisation → fn_execute_operation would raise P0002
  ('22700000-0000-0000-0000-000000000109', :'org', :'plan', 'irrigation', current_setting('test.today')::date, null, 'planned', :'me', 'sector', :'b_sector'),
  -- due today, material unit contradicts the item's tracked unit → fn_post_movement would raise 22023
  ('22700000-0000-0000-0000-000000000110', :'org', :'plan', 'irrigation', current_setting('test.today')::date, null, 'planned', :'me', null, null),
  -- overdue only AFTER its effective end (multi-day that finished yesterday)
  ('22700000-0000-0000-0000-000000000111', :'org', :'plan', 'irrigation', current_setting('test.today')::date - 5, current_setting('test.today')::date - 1, 'planned', :'me', null, null),
  -- due today with an UNRECOGNISED target_type → fn_execute_operation would raise 22023
  ('22700000-0000-0000-0000-000000000112', :'org', :'plan', 'irrigation', current_setting('test.today')::date, null, 'planned', :'me', 'district', :'sector'),
  -- terminal status variants are all excluded
  ('22700000-0000-0000-0000-000000000113', :'org', :'plan', 'irrigation', current_setting('test.today')::date, null, 'blocked', :'me', null, null),
  ('22700000-0000-0000-0000-000000000114', :'org', :'plan', 'irrigation', current_setting('test.today')::date, null, 'abandoned', :'me', null, null),
  ('22700000-0000-0000-0000-000000000115', :'org', :'plan', 'irrigation', current_setting('test.today')::date, null, 'skipped', :'me', null, null);

-- Only HALF the sign-off pair on 103; the pair is complete on 105 (so a signed dose is not blocked).
set local session_replication_role = replica;
update public.plan_operations set signed_off_at = pg_catalog.now()
 where id = '22700000-0000-0000-0000-000000000103';
set local session_replication_role = origin;

-- Crew: the caller is assigned to 102 through the join table, alongside a crew mate.
insert into public.plan_operation_assignees(id, org_id, plan_op_id, person_id, is_lead) values
  ('22700000-0000-0000-0000-000000000201', :'org', '22700000-0000-0000-0000-000000000102', :'me', true),
  ('22700000-0000-0000-0000-000000000202', :'org', '22700000-0000-0000-0000-000000000102', :'mate', false),
  -- an assignment to someone else on an operation that is NOT the caller's must not pull it in
  ('22700000-0000-0000-0000-000000000203', :'org', '22700000-0000-0000-0000-000000000106', :'other', false);

insert into public.inventory_items(id, org_id, name, unit) values
  (:'item', :'org', 'سماد اختبار', 'كجم'),
  (:'item_kg', :'org', 'مادة ثانية', 'كجم'),
  ('22700000-0000-0000-0000-000000000008', :'org', 'مادة ثالثة', 'كجم'),
  -- no canonical unit: fn_post_movement never raises a unit mismatch for it
  ('22700000-0000-0000-0000-000000000009', :'org', 'مادة بلا وحدة', null);
insert into public.plan_material_requirements(id, org_id, plan_op_id, item_id, qty, unit) values
  ('22700000-0000-0000-0000-000000000301', :'org', '22700000-0000-0000-0000-000000000101', :'item', 2.5, 'كجم'),
  ('22700000-0000-0000-0000-000000000302', :'org', '22700000-0000-0000-0000-000000000101', :'item_kg', 4, 'كجم'),
  ('22700000-0000-0000-0000-000000000303', :'org', '22700000-0000-0000-0000-000000000101', '22700000-0000-0000-0000-000000000008', 1, 'كجم'),
  -- a NULL requirement unit is left null by fn_pmr_unit_reconcile because the item has no canonical
  -- unit; fn_execute_operation then passes 'kg' and fn_post_movement accepts it, so this is NOT a
  -- mismatch and must not block 102
  ('22700000-0000-0000-0000-000000000305', :'org', '22700000-0000-0000-0000-000000000102', '22700000-0000-0000-0000-000000000009', 1, null);

-- Unit contradiction: the requirement says لتر, the item is tracked in كجم. Since migration
-- 20260701170000 the fn_pmr_unit_reconcile trigger rejects this on write, so it can only exist as
-- LEGACY data written before that trigger — which is exactly the row fn_post_movement would still
-- reject at execution time (22023). Written with triggers disabled to reproduce that legacy state.
set local session_replication_role = replica;
insert into public.plan_material_requirements(id, org_id, plan_op_id, item_id, qty, unit) values
  ('22700000-0000-0000-0000-000000000304', :'org', '22700000-0000-0000-0000-000000000110', :'item', 3, 'لتر');
set local session_replication_role = origin;

-- ── grants and metadata ────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('public', 'public.fn_supervisor_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'PUBLIC cannot execute the supervisor home snapshot');
select ok(not has_function_privilege('anon', 'public.fn_supervisor_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'anon cannot execute the supervisor home snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_supervisor_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'authenticated reaches internal gates');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_supervisor_home_snapshot(uuid,date,integer)'::regprocedure), 'snapshot is SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'public.fn_supervisor_home_snapshot(uuid,date,integer)'::regprocedure), 's', 'snapshot is stable');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_supervisor_home_snapshot(uuid,date,integer)'::regprocedure), 'search_path=""', 'snapshot has empty search_path');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when active_org is null
    then json_build_object('sub', uid, 'role', 'authenticated')
    else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text, true);
  execute 'set local role authenticated';
end $$;

-- ── the supervisor's own snapshot ──────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select set_config('test.snapshot', public.fn_supervisor_home_snapshot(:'org', current_setting('test.today')::date, 2)::text, false);
select set_config('test.wide', public.fn_supervisor_home_snapshot(:'org', current_setting('test.today')::date, 8)::text, false);

select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.supervisor-home.v1', 'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org', 'snapshot is bound to the active organization');
select is(current_setting('test.snapshot')::jsonb->>'as_of', current_setting('test.today'), 'snapshot carries the current Cairo date');
select is((current_setting('test.snapshot')::jsonb->>'detail_limit')::integer, 2, 'snapshot echoes its detail bound');
select is(current_setting('test.snapshot')::jsonb->'authority'->>'operations', 'partial', 'operations authority is reported as partial');
select is(current_setting('test.snapshot')::jsonb->'link'->>'state', 'linked', 'the caller resolves to one real person');
select is(current_setting('test.snapshot')::jsonb->'link'->>'person_id', :'me', 'the linked person is the caller''s own people row');
select is(current_setting('test.snapshot')::jsonb->'link'->>'person_name', 'مشرف اختبار', 'the linked person is named');

-- Recorded counts stay exact while the source authority is only partial.
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'due_today')::integer, 5, 'today includes inclusive multi-day assigned work');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'overdue')::integer, 2, 'overdue starts only after the effective end');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'ready_now')::integer, 3, 'ready work is today''s work with no recorded blocker');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'blocked_now')::integer, 4, 'blocked work is today''s work with a recorded blocker');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'unscheduled')::integer, 1, 'undated assigned work stays explicit');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'upcoming')::integer, 1, 'future assigned work is counted separately');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'ready_now')::bigint
        + (current_setting('test.snapshot')::jsonb->'recorded'->>'blocked_now')::bigint,
          (current_setting('test.snapshot')::jsonb->'recorded'->>'due_today')::bigint
        + (current_setting('test.snapshot')::jsonb->'recorded'->>'overdue')::bigint,
  'ready and blocked reconcile exactly with today plus overdue');
select ok(jsonb_typeof(current_setting('test.snapshot')::jsonb->'recorded'->'due_today') = 'string',
  'counts leave PostgreSQL as exact text');

-- ── no finance anywhere ────────────────────────────────────────────────────────────────────────
select ok(not (current_setting('test.wide')::jsonb ? 'finance'), 'snapshot exposes no finance branch');
select ok(current_setting('test.wide') not like '%est_cost%', 'snapshot never carries est_cost');
select ok(current_setting('test.wide') not like '%unit_cost%'
      and current_setting('test.wide') not like '%amount%'
      and current_setting('test.wide') not like '%"rate"%'
      and current_setting('test.wide') not like '%cost%',
  'snapshot carries no money key at all');

-- ── assignment is the caller''s own person link, never the team ────────────────────────────────
select ok(not exists (
    select 1 from jsonb_array_elements(
      current_setting('test.wide')::jsonb->'drivers'->'ready_now'
      || current_setting('test.wide')::jsonb->'drivers'->'blocked_now'
      || current_setting('test.wide')::jsonb->'drivers'->'unscheduled'
      || current_setting('test.wide')::jsonb->'drivers'->'upcoming') d
     where d->>'id' in ('22700000-0000-0000-0000-000000000106', '22700000-0000-0000-0000-000000000107',
                        '22700000-0000-0000-0000-000000000108', '22700000-0000-0000-0000-000000000113',
                        '22700000-0000-0000-0000-000000000114', '22700000-0000-0000-0000-000000000115')),
  'another person''s work, terminal work and draft-plan work never appear');
select ok(exists (
    select 1 from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d
     where d->>'id' = '22700000-0000-0000-0000-000000000102'),
  'work assigned through the assignee join table is included');

-- ── bounded drivers, independently limited ─────────────────────────────────────────────────────
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'ready_now'), 2, 'ready drivers obey the limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'blocked_now'), 2, 'blocked drivers obey the limit independently');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'unscheduled'), 1, 'unscheduled drivers obey their own count');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'upcoming'), 1, 'upcoming drivers obey their own count');
select is(jsonb_array_length(current_setting('test.wide')::jsonb->'drivers'->'ready_now'), 3, 'a wider bound reveals every ready row');
select is(jsonb_array_length(current_setting('test.wide')::jsonb->'drivers'->'blocked_now'), 4, 'a wider bound reveals every blocked row');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'ready_now'->0->>'urgency', 'overdue', 'overdue work leads the ready list');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'ready_now'->0->>'id', '22700000-0000-0000-0000-000000000101', 'the longest overdue assigned work leads');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'unscheduled'->0->>'id', '22700000-0000-0000-0000-000000000104', 'the undated operation is the unscheduled row');
select ok((current_setting('test.snapshot')::jsonb->'drivers'->'unscheduled'->0->'planned_at') = 'null'::jsonb, 'unscheduled work carries no date');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'upcoming'->0->>'id', '22700000-0000-0000-0000-000000000105', 'future work is the upcoming row');

-- ── actionability mirrors the shipped execute path ─────────────────────────────────────────────
select ok((select bool_and((d->>'executable')::boolean)
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d),
  'every ready row is executable');
select ok((select bool_and(not (d->>'executable')::boolean)
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked_now') d),
  'no blocked row is offered as executable');
select is((select d->'blockers'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000103'),
  '["signoff_missing"]'::jsonb, 'a half-recorded dose sign-off blocks a dose-bearing operation');

-- The UI is not the enforcement boundary: a direct status transition (including the one inside
-- fn_execute_operation) must fail atomically while either sign-off half is missing.
reset role;
select throws_ok(
  $$update public.plan_operations
       set status = 'done'
     where id = '22700000-0000-0000-0000-000000000103'$$,
  '42501',
  'dose-bearing operation requires complete agronomy sign-off before execution',
  'database rejects direct execution of an incompletely signed dose-bearing operation');
select is(
  (select status from public.plan_operations where id = '22700000-0000-0000-0000-000000000103'),
  'planned',
  'rejected dose execution leaves the operation unchanged');
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(
  $$select public.fn_execute_operation(
      '22700000-0000-0000-0000-000000000103'::uuid, 0, 0, 'unsigned dose')$$,
  '42501',
  'dose-bearing operation requires complete agronomy sign-off before execution',
  'direct execution RPC rejects an incompletely signed dose-bearing operation');
reset role;
select throws_ok(
  format(
    $$insert into public.plan_operations(id, org_id, plan_id, subtype, status)
      values ('22700000-0000-0000-0000-000000000116', %L, %L, 'fertilization', 'done')$$,
    :'org', :'plan'),
  '42501',
  'dose-bearing operation requires complete agronomy sign-off before execution',
  'database rejects insertion of a completed unsigned dose');
select throws_ok(
  $$update public.plan_operations
       set subtype = 'spraying'
     where id = '22700000-0000-0000-0000-000000000107'$$,
  '42501',
  'dose-bearing operation requires complete agronomy sign-off before execution',
  'database rejects changing an unsigned completed non-dose operation into a dose');
set local session_replication_role = replica;
update public.plan_operations
   set signed_off_by = :'mate', signed_off_at = pg_catalog.now()
 where id = '22700000-0000-0000-0000-000000000107';
set local session_replication_role = origin;
update public.plan_operations
   set subtype = 'fertilization'
 where id = '22700000-0000-0000-0000-000000000107';
select throws_ok(
  $$update public.plan_operations
       set signed_off_at = null
     where id = '22700000-0000-0000-0000-000000000107'$$,
  '42501',
  'dose-bearing operation requires complete agronomy sign-off before execution',
  'database rejects clearing sign-off from a completed dose');
select lives_ok(
  $$update public.plan_operations
       set status = 'done'
     where id = '22700000-0000-0000-0000-000000000102'$$,
  'a non-dose operation may still transition to done');
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select is((select d->'blockers'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000109'),
  '["target_unresolved"]'::jsonb, 'a cross-organisation typed target blocks the operation');
select is((select d->>'target_state'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000109'),
  'unresolved', 'a cross-organisation target never resolves to a label');
select ok((select d->>'target_label'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000109') is null,
  'no foreign structure name leaks through the target label');
select is((select d->'blockers'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000110'),
  '["unit_mismatch"]'::jsonb, 'a material unit that contradicts its item blocks the operation');
select is((select d->'blockers'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000112'),
  '["target_unresolved"]'::jsonb, 'an unrecognised target type blocks the operation');
select is((select d->>'target_state'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'blocked_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000112'),
  'unrecognized', 'an unrecognised target type is reported as such');
select is((select d->>'target_state'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000102'),
  'legacy', 'a null target type stays the tolerated legacy path, not a blocker');
select is((select d->>'target_label'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000101'),
  'قطاع الاختبار', 'a same-organisation target is named for the field');
select is((select d->>'scope_label'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000101'),
  'قطاع الاختبار', 'the plan scope is named too');

-- ── nested material and crew context: bounded, exact totals, quantities only ───────────────────
select is((select d->>'material_count'
             from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'drivers'->'ready_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000101'),
  '3', 'material count is the exact recorded total, not the bounded sample');
select is((select jsonb_array_length(d->'materials')
             from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'drivers'->'ready_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000101'),
  2, 'nested material context is bounded too');
select is((select jsonb_array_length(d->'materials')
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000101'),
  3, 'a wider bound reveals every recorded material');
select is((select m->>'qty'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d,
                  jsonb_array_elements(d->'materials') m
            where d->>'id' = '22700000-0000-0000-0000-000000000101' and m->>'item_name' = 'سماد اختبار'),
  '2.5', 'material quantities are exact decimal text');
select is((select d->>'crew_count'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d
            where d->>'id' = '22700000-0000-0000-0000-000000000102'),
  '2', 'the recorded crew total is exact');
select is((select jsonb_agg(c->>'name' order by c->>'name')
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'ready_now') d,
                  jsonb_array_elements(d->'crew') c
            where d->>'id' = '22700000-0000-0000-0000-000000000102'),
  '["زميل الفريق", "مشرف اختبار"]'::jsonb, 'the crew is named for the field');
reset role;

-- ── an unlinked and an ambiguous person link both fail closed on counts ────────────────────────
select pg_temp.as_user(current_setting('test.supervisor'), :'org_c');
select is(public.fn_supervisor_home_snapshot(:'org_c', current_setting('test.today')::date, 8)->'link'->>'state',
  'unlinked', 'an organization with no linked person reports the unlinked state');
select ok(public.fn_supervisor_home_snapshot(:'org_c', current_setting('test.today')::date, 8)->'recorded' = 'null'::jsonb,
  'an unlinked caller gets NULL counts, never zeros that read as all clear');
select ok(public.fn_supervisor_home_snapshot(:'org_c', current_setting('test.today')::date, 8)->'drivers' = 'null'::jsonb,
  'an unlinked caller gets no drivers and no team fallback');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'), :'org_d');
select is(public.fn_supervisor_home_snapshot(:'org_d', current_setting('test.today')::date, 8)->'link'->>'state',
  'ambiguous', 'two person rows for one account report the ambiguous state');
select ok(public.fn_supervisor_home_snapshot(:'org_d', current_setting('test.today')::date, 8)->'recorded' = 'null'::jsonb,
  'an ambiguous link never silently picks one person''s work');
reset role;

-- ── role and tenant gates ──────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.manager'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'farm manager is denied');
reset role;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'agronomist is denied');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'owner is denied');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'missing active org fails closed');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'), :'org_b');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'active org mismatch fails closed');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 0)$$, :'org', current_setting('test.today')), '22023', null, 'zero detail limit rejected');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 21)$$, :'org', current_setting('test.today')), '22023', null, 'detail limit above twenty rejected');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, (%L::date - 1), 8)$$, :'org', current_setting('test.today')), '22007', null, 'stale date rejected');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, (%L::date + 1), 8)$$, :'org', current_setting('test.today')), '22007', null, 'future date rejected');
reset role;

-- ── cross-organisation corruption fails closed ─────────────────────────────────────────────────
set local session_replication_role = replica;
insert into public.inventory_items(id, org_id, name, unit) values ('22700000-0000-0000-0000-000000000901', :'org_b', 'صنف أجنبي', 'كجم');
insert into public.plan_material_requirements(id, org_id, plan_op_id, item_id, qty, unit)
values ('22700000-0000-0000-0000-000000000902', :'org', '22700000-0000-0000-0000-000000000101', '22700000-0000-0000-0000-000000000901', 1, 'كجم');
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization material item fails closed');
reset role;
set local session_replication_role = replica;
delete from public.plan_material_requirements where id = '22700000-0000-0000-0000-000000000902';

insert into public.people(id, org_id, name, active) values ('22700000-0000-0000-0000-000000000903', :'org_b', 'عامل أجنبي', true);
update public.plan_operation_assignees set person_id = '22700000-0000-0000-0000-000000000903'
 where id = '22700000-0000-0000-0000-000000000202';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization assignee person fails closed');
reset role;
set local session_replication_role = replica;
update public.plan_operation_assignees set person_id = :'mate' where id = '22700000-0000-0000-0000-000000000202';

update public.plan_operations set responsible_person_id = '22700000-0000-0000-0000-000000000903'
 where id = '22700000-0000-0000-0000-000000000105';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization responsible person fails closed');
reset role;
set local session_replication_role = replica;
update public.plan_operations set responsible_person_id = :'me' where id = '22700000-0000-0000-0000-000000000105';

insert into public.plans(id, org_id, type, period_start, status)
values ('22700000-0000-0000-0000-000000000904', :'org_b', 'weekly', current_setting('test.today')::date, 'active');
update public.plan_operations set plan_id = '22700000-0000-0000-0000-000000000904'
 where id = '22700000-0000-0000-0000-000000000104';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization operation plan fails closed');
reset role;
set local session_replication_role = replica;
update public.plan_operations set plan_id = :'plan' where id = '22700000-0000-0000-0000-000000000104';

update public.plans set scope_type = 'sector', scope_id = :'b_sector' where id = :'plan';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select throws_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization plan scope fails closed');
reset role;
set local session_replication_role = replica;
update public.plans set scope_id = :'sector' where id = :'plan';
set local session_replication_role = origin;

-- Once every corrupt link is removed the snapshot is readable again: the guard is a gate, not a wall.
select pg_temp.as_user(current_setting('test.supervisor'), :'org');
select lives_ok(format($$select public.fn_supervisor_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  'a clean organization still reads its snapshot');
reset role;

select * from finish();
rollback;

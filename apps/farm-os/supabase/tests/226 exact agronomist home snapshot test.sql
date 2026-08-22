-- SPEC-0033 R3d: the agronomist home is role-exact, active-org-only, bounded, agronomy-only and
-- finance-free, and every count it returns is an exact count of RECORDED rows.
begin;
select no_plan();

\set org '22600000-0000-0000-0000-0000000000a0'
\set org_b '22600000-0000-0000-0000-0000000000b0'
\set plan '22600000-0000-0000-0000-000000000001'
\set draft_plan '22600000-0000-0000-0000-000000000002'
\set person '22600000-0000-0000-0000-000000000003'
\set item '22600000-0000-0000-0000-000000000004'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.agronomist', (select user_id::text from public.organization_member where role = 'agri_engineer' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact agronomist home org'), (:'org_b', 'Exact agronomist foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.agronomist')::uuid, 'agri_engineer'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org_b', current_setting('test.agronomist')::uuid, 'agri_engineer');
-- Deliberately PARTIAL: an incomplete source must NOT blank an exact recorded count.
insert into public.data_authority_status(org_id, domain, status, source_label, record_count, notes) values
  (:'org', 'operations', 'partial', 'fixture', 9, 'partial test fixture');

insert into public.people(id, org_id, name, active) values (:'person', :'org', 'مهندس اختبار', true);
insert into public.plans(id, org_id, type, period_start, status) values
  (:'plan', :'org', 'weekly', current_setting('test.today')::date - 2, 'active'),
  (:'draft_plan', :'org', 'weekly', current_setting('test.today')::date - 2, 'draft');

insert into public.plan_operations(id, org_id, plan_id, subtype, planned_at, ends_on, status, responsible_person_id) values
  -- overdue agronomy work, dose-bearing and completely unsigned
  ('22600000-0000-0000-0000-000000000101', :'org', :'plan', 'spraying', current_setting('test.today')::date - 3, null, 'planned', null),
  -- multi-day irrigation spanning today (inclusive)
  ('22600000-0000-0000-0000-000000000102', :'org', :'plan', 'irrigation', current_setting('test.today')::date - 1, current_setting('test.today')::date + 1, 'in_progress', :'person'),
  -- due today AND dose-bearing with only half the sign-off pair recorded
  ('22600000-0000-0000-0000-000000000103', :'org', :'plan', 'fertilization', current_setting('test.today')::date, null, 'planned', null),
  -- agronomy work with no date: never counted as due or overdue
  ('22600000-0000-0000-0000-000000000104', :'org', :'plan', 'pollination', null, null, 'planned', null),
  -- NOT agronomy work: belongs to the Farm Manager home
  ('22600000-0000-0000-0000-000000000105', :'org', :'plan', 'harvest', current_setting('test.today')::date, null, 'planned', null),
  -- terminal statuses are excluded even when dated today / overdue
  ('22600000-0000-0000-0000-000000000106', :'org', :'plan', 'inspection', current_setting('test.today')::date, null, 'done', null),
  ('22600000-0000-0000-0000-000000000107', :'org', :'plan', 'pest_scouting', current_setting('test.today')::date - 5, null, 'blocked', null),
  -- future dose work with BOTH sign-off halves recorded
  ('22600000-0000-0000-0000-000000000108', :'org', :'plan', 'spraying', current_setting('test.today')::date + 3, null, 'planned', :'person'),
  -- unsigned dose work on a DRAFT plan: inactive plans are out of scope
  ('22600000-0000-0000-0000-000000000109', :'org', :'draft_plan', 'spraying', current_setting('test.today')::date, null, 'planned', null);
set local session_replication_role = replica;
update public.plan_operations set signed_off_at = pg_catalog.now()
 where id = '22600000-0000-0000-0000-000000000103';
update public.plan_operations set signed_off_by = :'person', signed_off_at = pg_catalog.now()
 where id = '22600000-0000-0000-0000-000000000108';
set local session_replication_role = origin;

insert into public.inventory_items(id, org_id, name, unit) values
  (:'item', :'org', 'مبيد اختبار', 'لتر'),
  ('22600000-0000-0000-0000-000000000005', :'org', 'سماد اختبار', 'كجم'),
  ('22600000-0000-0000-0000-000000000006', :'org', 'مادة ثالثة', 'لتر');
insert into public.plan_material_requirements(id, org_id, plan_op_id, item_id, qty, unit, target_pest, apc_registration_ref, rei_hours, phi_days, target_zone, applicator_person_id) values
  ('22600000-0000-0000-0000-000000000201', :'org', '22600000-0000-0000-0000-000000000101', :'item', 2.5, 'لتر', 'سوسة النخيل', 'APC-2026-001', 12, 7, 'bunch', :'person'),
  ('22600000-0000-0000-0000-000000000202', :'org', '22600000-0000-0000-0000-000000000101', '22600000-0000-0000-0000-000000000005', 4, 'كجم', null, null, null, null, null, null),
  ('22600000-0000-0000-0000-000000000203', :'org', '22600000-0000-0000-0000-000000000101', '22600000-0000-0000-0000-000000000006', 1, 'لتر', null, null, null, null, null, null);

-- Blocked checks on the ACTIVE plan cover weather, stock and budget; the draft plan's block is excluded.
insert into public.plan_checks(id, org_id, plan_id, kind, result) values
  ('22600000-0000-0000-0000-000000000301', :'org', :'plan', 'weather', 'block'),
  ('22600000-0000-0000-0000-000000000302', :'org', :'plan', 'stock', 'block'),
  ('22600000-0000-0000-0000-000000000303', :'org', :'plan', 'budget', 'block'),
  ('22600000-0000-0000-0000-000000000304', :'org', :'plan', 'labor', 'ok'),
  ('22600000-0000-0000-0000-000000000305', :'org', :'draft_plan', 'weather', 'block');

-- Traps: thresholds and the installed_at fallback mirror lib/pest-scouting.ts exactly.
insert into public.pest_traps(id, org_id, code, label, installed_at, lure_changed_at, status) values
  -- lure age 100 > 90 (checked recently) → follow-up
  ('22600000-0000-0000-0000-000000000401', :'org', 'T-1', 'مصيدة ١', current_setting('test.today')::date - 200, current_setting('test.today')::date - 100, 'active'),
  -- never checked → check age falls back to installed_at (30 > 10) → follow-up
  ('22600000-0000-0000-0000-000000000402', :'org', 'T-2', 'مصيدة ٢', current_setting('test.today')::date - 30, current_setting('test.today')::date - 5, 'active'),
  -- never checked, no lure change → both fall back to installed_at (5) → clear
  ('22600000-0000-0000-0000-000000000403', :'org', 'T-3', 'مصيدة ٣', current_setting('test.today')::date - 5, null, 'active'),
  -- removed traps are never flagged, however old
  ('22600000-0000-0000-0000-000000000404', :'org', 'T-4', 'مصيدة ٤', current_setting('test.today')::date - 500, null, 'removed'),
  -- exact boundary: 90 days of lure and 10 days since check are NOT yet follow-up
  ('22600000-0000-0000-0000-000000000405', :'org', 'T-5', 'مصيدة ٥', current_setting('test.today')::date - 200, current_setting('test.today')::date - 90, 'active'),
  -- never checked, very old → follow-up (gives three follow-ups against a limit of two)
  ('22600000-0000-0000-0000-000000000406', :'org', 'T-6', 'مصيدة ٦', current_setting('test.today')::date - 400, null, 'active');
insert into public.pest_trap_catches(org_id, trap_id, checked_at, catch_count) values
  (:'org', '22600000-0000-0000-0000-000000000401', current_setting('test.today')::date - 40, 1),
  (:'org', '22600000-0000-0000-0000-000000000401', current_setting('test.today')::date - 2, 0),
  (:'org', '22600000-0000-0000-0000-000000000405', current_setting('test.today')::date - 10, 2);

-- ── grants and metadata ────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('public', 'public.fn_agronomist_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'PUBLIC cannot execute the agronomist home snapshot');
select ok(not has_function_privilege('anon', 'public.fn_agronomist_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'anon cannot execute the agronomist home snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_agronomist_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'authenticated reaches internal gates');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_agronomist_home_snapshot(uuid,date,integer)'::regprocedure), 'snapshot is SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'public.fn_agronomist_home_snapshot(uuid,date,integer)'::regprocedure), 's', 'snapshot is stable');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_agronomist_home_snapshot(uuid,date,integer)'::regprocedure), 'search_path=""', 'snapshot has empty search_path');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when active_org is null
    then json_build_object('sub', uid, 'role', 'authenticated')
    else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text, true);
  execute 'set local role authenticated';
end $$;

-- ── the agronomist's own snapshot ──────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select set_config('test.snapshot', public.fn_agronomist_home_snapshot(:'org', current_setting('test.today')::date, 2)::text, false);
select set_config('test.wide', public.fn_agronomist_home_snapshot(:'org', current_setting('test.today')::date, 8)::text, false);

select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.agronomist-home.v1', 'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org', 'snapshot is bound to the active organization');
select is(current_setting('test.snapshot')::jsonb->>'as_of', current_setting('test.today'), 'snapshot carries the current Cairo date');
select is((current_setting('test.snapshot')::jsonb->>'detail_limit')::integer, 2, 'snapshot echoes its detail bound');
select is(current_setting('test.snapshot')::jsonb->'authority'->>'operations', 'partial', 'operations authority is reported as partial');

-- Recorded counts stay exact while the source authority is only partial (the R3c usability defect).
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'pending_signoffs')::integer, 2, 'either missing sign-off half keeps dose work pending');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'due_today')::integer, 2, 'today includes inclusive multi-day agronomy work');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'overdue')::integer, 1, 'overdue starts only after the effective end');
select is((current_setting('test.snapshot')::jsonb->'recorded'->>'trap_followups')::integer, 3, 'trap follow-up counts overdue checks and aged lures only');
select ok((current_setting('test.snapshot')::jsonb->'recorded'->>'pending_signoffs') is not null
       and jsonb_typeof(current_setting('test.snapshot')::jsonb->'recorded'->'pending_signoffs') = 'string',
  'counts leave PostgreSQL as exact text');

-- ── no finance anywhere ────────────────────────────────────────────────────────────────────────
select ok(not (current_setting('test.snapshot')::jsonb ? 'finance'), 'snapshot exposes no finance branch');
select ok(current_setting('test.snapshot') not like '%est_cost%', 'snapshot never carries est_cost');
select ok(current_setting('test.snapshot') not like '%amount%' and current_setting('test.snapshot') not like '%cost%',
  'snapshot carries no money key at all');

-- ── drivers: bounded independently, with material and trap context ─────────────────────────────
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'pending_signoffs'), 2, 'sign-off drivers obey the limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'due_operations'), 2, 'due drivers obey the limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'trap_followups'), 2, 'trap drivers obey the limit independently');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'blocked_checks'), 2, 'blocked-check drivers obey the limit independently');

select is(current_setting('test.snapshot')::jsonb->'drivers'->'pending_signoffs'->0->>'id',
  '22600000-0000-0000-0000-000000000101', 'the oldest unsigned dose operation leads');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'pending_signoffs'->0->>'material_count', '3',
  'material count is the exact recorded total, not the bounded sample');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'pending_signoffs'->0->'materials'), 2,
  'nested material context is bounded too');
select is(jsonb_array_length(current_setting('test.wide')::jsonb->'drivers'->'pending_signoffs'->0->'materials'), 3,
  'a wider bound reveals every recorded material');
select is((select m->>'apc_registration_ref'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'pending_signoffs'->0->'materials') m
            where m->>'item_name' = 'مبيد اختبار'),
  'APC-2026-001', 'the recorded registration reference is passed through verbatim');
select ok((select m->>'apc_registration_ref'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'pending_signoffs'->0->'materials') m
            where m->>'item_name' = 'سماد اختبار') is null,
  'a material with no recorded registration reference reports missing, never a default');
select is((select m->>'qty'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'pending_signoffs'->0->'materials') m
            where m->>'item_name' = 'مبيد اختبار'),
  '2.5', 'material quantities are exact decimal text');
select is((select m->>'rei_hours'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'pending_signoffs'->0->'materials') m
            where m->>'item_name' = 'مبيد اختبار'),
  '12', 'the recorded re-entry interval is passed through as decimal text');
select is((select m->>'phi_days'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'pending_signoffs'->0->'materials') m
            where m->>'item_name' = 'مبيد اختبار'),
  '7', 'the recorded pre-harvest interval is passed through as decimal text');
select is((select m->>'target_zone'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'pending_signoffs'->0->'materials') m
            where m->>'item_name' = 'مبيد اختبار'),
  'bunch', 'the recorded spray target zone is passed through without interpretation');
select is((select m->>'applicator_name'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'pending_signoffs'->0->'materials') m
            where m->>'item_name' = 'مبيد اختبار'),
  'مهندس اختبار', 'the recorded applicator is named');

select is(current_setting('test.snapshot')::jsonb->'drivers'->'due_operations'->0->>'urgency', 'overdue', 'overdue work leads the due list');
select is((select jsonb_agg(distinct d->>'urgency' order by d->>'urgency')
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'due_operations') d),
  '["overdue", "today"]'::jsonb, 'due drivers carry only today and overdue');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'due_operations') d
     where d->>'id' in ('22600000-0000-0000-0000-000000000104', '22600000-0000-0000-0000-000000000105',
                        '22600000-0000-0000-0000-000000000106', '22600000-0000-0000-0000-000000000107')),
  'undated, non-agronomy and terminal work never enters the due list');

select is((select jsonb_agg(t->>'code' order by t->>'code')
             from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'drivers'->'trap_followups') t),
  '["T-2", "T-6"]'::jsonb, 'the longest unattended traps lead and boundary/removed traps stay out');
select is((select t->>'days_since_check'
             from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'drivers'->'trap_followups') t
            where t->>'code' = 'T-2'), '30', 'a never-checked trap falls back to installed_at');
select ok((select t->>'last_checked_at'
             from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'drivers'->'trap_followups') t
            where t->>'code' = 'T-2') is null, 'a never-checked trap reports no recorded check');
select is((select t->>'days_since_lure_change'
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'trap_followups') t
            where t->>'code' = 'T-1'), '100', 'an aged lure is flagged even when the trap was checked recently');
select ok((select (t->>'overdue_check')::boolean
             from jsonb_array_elements(current_setting('test.wide')::jsonb->'drivers'->'trap_followups') t
            where t->>'code' = 'T-1') is false, 'a recently checked trap is not also flagged overdue');
select is((select jsonb_agg(c->>'kind' order by c->>'kind')
             from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'drivers'->'blocked_checks') c),
  '["budget", "stock"]'::jsonb, 'blocked checks are not narrowed to one kind');
reset role;

-- The full blocked set (weather included) is visible once the bound allows it, and draft plans stay out.
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select is((select jsonb_agg(c->>'kind' order by c->>'kind')
             from jsonb_array_elements(
               public.fn_agronomist_home_snapshot(:'org', current_setting('test.today')::date, 8)->'drivers'->'blocked_checks') c),
  '["budget", "stock", "weather"]'::jsonb, 'weather blocks are included and inactive plans are excluded');
select is(jsonb_array_length(current_setting('test.wide')::jsonb->'drivers'->'trap_followups'), 3,
  'a wider bound reveals every recorded trap follow-up');
reset role;

-- ── role and tenant gates ──────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.manager'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'farm manager is denied');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'owner is denied');
reset role;
select pg_temp.as_user(current_setting('test.agronomist'));
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'missing active org fails closed');
reset role;
select pg_temp.as_user(current_setting('test.agronomist'), :'org_b');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'active org mismatch fails closed');
reset role;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 0)$$, :'org', current_setting('test.today')), '22023', null, 'zero detail limit rejected');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 21)$$, :'org', current_setting('test.today')), '22023', null, 'detail limit above twenty rejected');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, (%L::date - 1), 8)$$, :'org', current_setting('test.today')), '22007', null, 'stale date rejected');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, (%L::date + 1), 8)$$, :'org', current_setting('test.today')), '22007', null, 'future date rejected');
reset role;

-- ── cross-organisation corruption fails closed ─────────────────────────────────────────────────
set local session_replication_role = replica;
insert into public.inventory_items(id, org_id, name) values ('22600000-0000-0000-0000-000000000901', :'org_b', 'صنف أجنبي');
insert into public.plan_material_requirements(id, org_id, plan_op_id, item_id, qty, unit)
values ('22600000-0000-0000-0000-000000000902', :'org', '22600000-0000-0000-0000-000000000101', '22600000-0000-0000-0000-000000000901', 1, 'لتر');
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization material item fails closed');
reset role;
set local session_replication_role = replica;
delete from public.plan_material_requirements where id = '22600000-0000-0000-0000-000000000902';

insert into public.people(id, org_id, name, active) values ('22600000-0000-0000-0000-000000000903', :'org_b', 'منفذ أجنبي', true);
update public.plan_material_requirements set applicator_person_id = '22600000-0000-0000-0000-000000000903'
 where id = '22600000-0000-0000-0000-000000000202';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization applicator fails closed');
reset role;
set local session_replication_role = replica;
update public.plan_material_requirements set applicator_person_id = null where id = '22600000-0000-0000-0000-000000000202';

update public.plan_operations set signed_off_by = '22600000-0000-0000-0000-000000000903'
 where id = '22600000-0000-0000-0000-000000000108';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization sign-off person fails closed');
reset role;
set local session_replication_role = replica;
update public.plan_operations set signed_off_by = :'person' where id = '22600000-0000-0000-0000-000000000108';

insert into public.plans(id, org_id, type, period_start, status)
values ('22600000-0000-0000-0000-000000000904', :'org_b', 'weekly', current_setting('test.today')::date, 'active');
update public.plan_operations set plan_id = '22600000-0000-0000-0000-000000000904'
 where id = '22600000-0000-0000-0000-000000000104';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization operation plan fails closed');
reset role;
set local session_replication_role = replica;
update public.plan_operations set plan_id = :'plan' where id = '22600000-0000-0000-0000-000000000104';

insert into public.farms(id, org_id, name, code) values ('22600000-0000-0000-0000-000000000905', :'org_b', 'مزرعة أجنبية', 'FB');
insert into public.sectors(id, org_id, farm_id, name, code)
values ('22600000-0000-0000-0000-000000000906', :'org_b', '22600000-0000-0000-0000-000000000905', 'قطاع أجنبي', 'SB');
update public.pest_traps set sector_id = '22600000-0000-0000-0000-000000000906'
 where id = '22600000-0000-0000-0000-000000000403';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization trap structure link fails closed');
reset role;
set local session_replication_role = replica;
update public.pest_traps set sector_id = null where id = '22600000-0000-0000-0000-000000000403';

insert into public.pest_traps(id, org_id, code, label, installed_at, status)
values ('22600000-0000-0000-0000-000000000907', :'org_b', 'TB-1', 'مصيدة أجنبية', current_setting('test.today')::date, 'active');
insert into public.pest_trap_catches(id, org_id, trap_id, checked_at, catch_count)
values ('22600000-0000-0000-0000-000000000908', :'org', '22600000-0000-0000-0000-000000000907', current_setting('test.today')::date, 0);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization trap catch fails closed');
reset role;
set local session_replication_role = replica;
delete from public.pest_trap_catches where id = '22600000-0000-0000-0000-000000000908';
set local session_replication_role = origin;

-- Once every corrupt link is removed the snapshot is readable again: the guard is a gate, not a wall.
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select lives_ok(format($$select public.fn_agronomist_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  'a clean organization still reads its snapshot');
reset role;

select * from finish();
rollback;

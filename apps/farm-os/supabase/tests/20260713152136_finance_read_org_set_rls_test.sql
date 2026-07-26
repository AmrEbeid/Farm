-- Finance-read RLS organization set: privilege lockdown, policy shape, active-org behavior,
-- live membership changes, and cross-organization row isolation.
-- Run via supabase/test-shims/run-pgtap-local.sh (Docker-free temporary PostgreSQL).

begin;
select plan(42);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB 'f2131521-0000-0000-0000-000000000002'
\set orgX 'f2131521-0000-0000-0000-000000000099'

-- Function and schema security contract.
select isnt(to_regprocedure('private.finance_read_org_ids()'), null,
  'finance-read set helper exists in the private schema');
select is((select provolatile from pg_proc where oid = 'private.finance_read_org_ids()'::regprocedure), 's'::"char",
  'finance-read set helper is STABLE');
select is((select prosecdef from pg_proc where oid = 'private.finance_read_org_ids()'::regprocedure), false,
  'finance-read set helper is SECURITY INVOKER');
select is(
  (select array_to_string(proconfig, ',') from pg_proc where oid = 'private.finance_read_org_ids()'::regprocedure),
  'search_path=""', 'finance-read set helper pins an empty search_path');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'),
  'anon has no USAGE on the private schema');
select ok(has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated can resolve the private policy helper');
select ok(not has_function_privilege('anon', 'private.finance_read_org_ids()', 'EXECUTE'),
  'anon cannot execute the finance-read set helper');
select ok(has_function_privilege('authenticated', 'private.finance_read_org_ids()', 'EXECUTE'),
  'authenticated can execute the finance-read set helper');

-- All fourteen finance-only tenant_read policies use the uncorrelated organization set.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and policyname = 'tenant_read'
      and tablename = any (array[
        'custody_accounts','custody_movements','payment_requests','payment_request_lines',
        'accounts','journal_entries','journal_lines','payment_request_fundings','cost_centers',
        'offshoot_valuation','buyers','sales','sale_collections','accounting_periods'
      ])
      and qual like '%private.finance_read_org_ids()%'),
  14::bigint, 'all finance-only tenant_read policies use the organization-set helper');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and policyname = 'tenant_read'
      and tablename = any (array[
        'custody_accounts','custody_movements','payment_requests','payment_request_lines',
        'accounts','journal_entries','journal_lines','payment_request_fundings','cost_centers',
        'offshoot_valuation','buyers','sales','sale_collections','accounting_periods'
      ])
      and qual like '%finance.read%'),
  0::bigint, 'finance-only tenant_read policies no longer call authorize per row');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'expenses' and policyname = 'tenant_all'
      and qual like '%private.finance_read_org_ids()%'
      and qual like '%kind <> ''drawing''%'),
  1::bigint, 'expenses keeps ordinary rows open while drawing rows use the finance set');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'expenses' and policyname = 'tenant_all'
      and qual like '%finance.read%'),
  0::bigint, 'expenses no longer calls finance.read per drawing row');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_read'
      and qual like '%private.finance_read_org_ids()%'
      and qual like '%accounting_period%'),
  1::bigint, 'audit finance entities use the organization-set helper');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and qual like '%finance.read%'),
  0::bigint, 'no public RLS policy retains a direct finance.read call');

-- Multi-organization fixtures. Existing users keep their orgA roles and gain different orgB roles.
insert into public.organization (id, name) values (:'orgB', 'Finance RLS test organization');
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
insert into public.organization_member (org_id, user_id, role) values
  (:'orgB', current_setting('test.owner')::uuid, 'accountant'),
  (:'orgB', current_setting('test.manager')::uuid, 'owner');
insert into public.accounts (id, org_id, code, name_ar, account_type, normal_balance) values
  ('f2131521-0000-0000-0000-000000000011', :'orgA', 'RLS-A', 'حساب اختبار أ', 'asset', 'debit'),
  ('f2131521-0000-0000-0000-000000000012', :'orgB', 'RLS-B', 'حساب اختبار ب', 'asset', 'debit');
insert into public.audit_log (org_id, action, entity_type, entity_id) values
  (:'orgA', 'UPDATE', 'account', 'RLS-A-AUDIT'),
  (:'orgB', 'UPDATE', 'account', 'RLS-B-AUDIT'),
  (:'orgA', 'UPDATE', 'farm', 'RLS-A-OPEN');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    case when active_org is null
      then json_build_object('sub', uid, 'role', 'authenticated')::text
      else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org)::text
    end,
    true
  );
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.explain_analyze_json(query_text text)
returns jsonb language plpgsql as $$
declare query_plan jsonb;
begin
  execute 'explain (analyze, costs off, verbose, format json) ' || query_text into query_plan;
  return query_plan;
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select is(
  coalesce((select array_agg(org_id order by org_id)
    from private.finance_read_org_ids() as finance_orgs(org_id)), '{}'::uuid[]),
  array[:'orgA'::uuid, :'orgB'::uuid],
  'owner/accountant multi-org user gets both finance organizations without an active claim');
select is((select count(*) from public.accounts where code in ('RLS-A','RLS-B')), 2::bigint,
  'finance multi-org user can read finance rows from both memberships without an active claim');
select is((select count(*) from public.audit_log
  where entity_id in ('RLS-A-AUDIT','RLS-B-AUDIT')), 2::bigint,
  'finance multi-org user can read finance audit rows from both memberships');
select is(
  (with recursive plan_nodes(node) as (
    select pg_temp.explain_analyze_json('select id, code from public.accounts')->0->'Plan'
    union all
    select child
    from plan_nodes
    cross join lateral jsonb_array_elements(coalesce(node->'Plans', '[]'::jsonb)) as children(child)
  )
  select max((node->>'Actual Loops')::int)
  from plan_nodes
  where node::text like '%private.finance_read_org_ids()%'),
  1, 'planner executes the finance organization-set helper exactly once for a multi-row finance read');
reset role;

select pg_temp.as_user(current_setting('test.owner'), :'orgA');
select is(
  coalesce((select array_agg(org_id order by org_id)
    from private.finance_read_org_ids() as finance_orgs(org_id)), '{}'::uuid[]),
  array[:'orgA'::uuid], 'active org A narrows the finance organization set to A');
select is((select count(*) from public.accounts where code in ('RLS-A','RLS-B')), 1::bigint,
  'active org A hides org B finance rows');
select is((select array_agg(entity_id order by entity_id) from public.audit_log
  where entity_id in ('RLS-A-AUDIT','RLS-B-AUDIT')),
  array['RLS-A-AUDIT']::text[], 'active org A hides org B finance audit rows');
reset role;

select pg_temp.as_user(current_setting('test.owner'), :'orgB');
select is(
  coalesce((select array_agg(org_id order by org_id)
    from private.finance_read_org_ids() as finance_orgs(org_id)), '{}'::uuid[]),
  array[:'orgB'::uuid], 'active org B narrows the finance organization set to B');
select is((select count(*) from public.accounts where code = 'RLS-A'), 0::bigint,
  'active org B prevents cross-organization reads from org A');
select is((select array_agg(entity_id order by entity_id) from public.audit_log
  where entity_id in ('RLS-A-AUDIT','RLS-B-AUDIT')),
  array['RLS-B-AUDIT']::text[], 'active org B prevents cross-organization finance audit reads');
reset role;

select pg_temp.as_user(current_setting('test.owner'), :'orgX');
select is(
  coalesce((select array_agg(org_id order by org_id)
    from private.finance_read_org_ids() as finance_orgs(org_id)), '{}'::uuid[]),
  '{}'::uuid[], 'a forged active-org claim fails closed');
select is((select count(*) from public.accounts where code in ('RLS-A','RLS-B')), 0::bigint,
  'a forged active-org claim exposes no finance rows');
select is((select count(*) from public.audit_log
  where entity_id in ('RLS-A-AUDIT','RLS-B-AUDIT','RLS-A-OPEN')), 0::bigint,
  'a forged active-org claim exposes no audit rows');
reset role;

select pg_temp.as_user(current_setting('test.manager'));
select is(
  coalesce((select array_agg(org_id order by org_id)
    from private.finance_read_org_ids() as finance_orgs(org_id)), '{}'::uuid[]),
  array[:'orgB'::uuid], 'a manager in org A who owns org B gets finance access only to org B');
select is((select array_agg(code order by code) from public.accounts where code in ('RLS-A','RLS-B')),
  array['RLS-B']::text[], 'finance table RLS hides org A while allowing the user-owned org B');
select is((select array_agg(entity_id order by entity_id) from public.audit_log
  where entity_id in ('RLS-A-AUDIT','RLS-B-AUDIT')),
  array['RLS-B-AUDIT']::text[], 'manager in org A cannot read its finance audit but can read owned org B');
select is((select count(*) from public.audit_log where entity_id = 'RLS-A-OPEN'), 1::bigint,
  'manager keeps ordinary non-finance audit visibility in org A');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is((select array_agg(code order by code) from public.accounts where code in ('RLS-A','RLS-B')),
  array['RLS-A']::text[], 'org A accountant reads org A and cannot read unrelated org B');
select is((select array_agg(entity_id order by entity_id) from public.audit_log
  where entity_id in ('RLS-A-AUDIT','RLS-B-AUDIT')),
  array['RLS-A-AUDIT']::text[], 'org A accountant reads only org A finance audit rows');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select is(
  coalesce((select array_agg(org_id order by org_id)
    from private.finance_read_org_ids() as finance_orgs(org_id)), '{}'::uuid[]),
  '{}'::uuid[], 'supervisor has no finance-readable organizations');
select is((select count(*) from public.accounts where code in ('RLS-A','RLS-B')), 0::bigint,
  'supervisor receives no finance rows');
select is((select count(*) from public.audit_log
  where entity_id in ('RLS-A-AUDIT','RLS-B-AUDIT')), 0::bigint,
  'supervisor receives no finance audit rows');
select is((select count(*) from public.audit_log where entity_id = 'RLS-A-OPEN'), 1::bigint,
  'supervisor keeps ordinary non-finance audit visibility in org A');
reset role;

-- The helper reflects membership changes immediately; no stale JWT role list is trusted.
update public.organization_member set role = 'supervisor'
  where org_id = :'orgB' and user_id = current_setting('test.owner')::uuid;
select pg_temp.as_user(current_setting('test.owner'));
select is(
  coalesce((select array_agg(org_id order by org_id)
    from private.finance_read_org_ids() as finance_orgs(org_id)), '{}'::uuid[]),
  array[:'orgA'::uuid], 'live role downgrade removes org B immediately from the finance set');
select is((select array_agg(code order by code) from public.accounts where code in ('RLS-A','RLS-B')),
  array['RLS-A']::text[], 'live role downgrade immediately removes org B finance rows');
select is((select array_agg(entity_id order by entity_id) from public.audit_log
  where entity_id in ('RLS-A-AUDIT','RLS-B-AUDIT')),
  array['RLS-A-AUDIT']::text[], 'live role downgrade immediately removes org B finance audit rows');
reset role;

set local role anon;
select throws_ok(
  $$ select * from private.finance_read_org_ids() $$,
  '42501', null, 'anon cannot call the private finance helper');
select throws_ok(
  $$ select count(*) from public.accounts $$,
  '42501', null, 'anon cannot read finance tables');
reset role;

select * from finish();
rollback;

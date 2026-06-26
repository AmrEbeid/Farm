-- 53 — #270 H2: people_compensation audit rows leak wages to non-payroll members via audit_log.
-- audit_read (0002) is org-only; 0046 restricted the people_compensation BASE table to payroll.read but
-- left the audit mirror org-wide, so any member could read wage before/after out of audit_log. 0053
-- mirrors the base-table rule onto the log: a people_compensation audit row needs payroll.read; other
-- entity_types stay org-scoped. Impersonation via request.jwt.claims (tests 25/36/42/45/48/51/52).
-- Rows seeded as superuser. payroll.read = owner/accountant (0046).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set orgA '00000000-0000-0000-0000-000000000001'

select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

-- one wage audit row + one ordinary (non-wage) audit row, same org
insert into public.audit_log (org_id, action, entity_type, entity_id, after, occurred_at)
values
  (:'orgA', 'update', 'people_compensation', 'comp-h2-1', '{"monthly_rate": 9999}'::jsonb, now()),
  (:'orgA', 'update', 'plan_operations',     'op-h2-1',   '{"status": "approved"}'::jsonb, now());

-- ===== a non-payroll member (storekeeper): wage row hidden, ordinary row visible =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.audit_log
     where org_id = :'orgA' and entity_type = 'people_compensation'),
  0,
  '#270 H2: a non-payroll member sees ZERO people_compensation audit rows (wage PII hidden)');

select is(
  (select count(*)::int from public.audit_log
     where org_id = :'orgA' and entity_type = 'plan_operations' and entity_id = 'op-h2-1'),
  1,
  '#270 H2: the same member still sees ordinary (non-wage) audit rows in their org');

reset role;

-- ===== a payroll.read holder (owner): wage row visible =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.audit_log
     where org_id = :'orgA' and entity_type = 'people_compensation' and entity_id = 'comp-h2-1'),
  1,
  '#270 H2: an owner (payroll.read) CAN read people_compensation audit rows');

reset role;

-- structural invariant: the gate is present on the policy
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_read'
       and qual like '%payroll.read%'),
  1,
  '#270 H2: audit_read gates people_compensation rows on payroll.read');

-- and the org scope is still enforced (no cross-org widening from the re-emit)
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_read'
       and qual like '%user_org_ids%'),
  1,
  '#270 H2: audit_read still enforces org scope (re-emit preserved the base predicate)');

select * from finish();
rollback;

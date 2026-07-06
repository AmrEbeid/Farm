-- 131 - D2: audit_read sensitive-entity completeness pin.
--
-- audit_read is re-emitted as new confidential audited entities are added. A stale copy can leak even
-- when tests/56 still passes: if an entity remains in a gated branch but is dropped from the open
-- org-member exclusion list, the policy still names the entity once while plain org members can read it.
--
-- This test pins the known sensitive audit entity vocabulary in BOTH policy locations:
--   (1) the open-branch exclusion, and
--   (2) the payroll/budget/finance gated branch.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(2);

select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_log'
      and policyname = 'audit_read'),
  1,
  'audit_read policy exists exactly once');

with expected_sensitive(entity_type) as (
  values
    ('people_compensation'),
    ('sale'),
    ('expense'),
    ('custody_account'),
    ('custody_movement'),
    ('payment_request'),
    ('payment_request_line'),
    ('account'),
    ('journal_entry'),
    ('journal_line'),
    ('payment_request_funding'),
    ('cost_center'),
    ('offshoot_valuation'),
    ('buyer'),
    ('sale_collection'),
    ('accounting_period')
),
audit_gate as (
  select lower(coalesce(qual, '')) as policy_sql
  from pg_policies
  where schemaname = 'public'
    and tablename = 'audit_log'
    and policyname = 'audit_read'
)
select is(
  (select count(*)::int
   from expected_sensitive e
   cross join audit_gate g
   where (
     length(g.policy_sql)
       - length(replace(g.policy_sql, quote_literal(e.entity_type), ''))
   ) / length(quote_literal(e.entity_type)) < 2),
  0,
  'audit_read names every sensitive entity in both the open-branch exclusion and its gated branch');

select * from finish();
rollback;

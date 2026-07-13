-- Evaluate finance.read once per candidate organization instead of once per returned row.
--
-- Problem: finance table policies called authorize('finance.read', org_id) for every row, adding
-- avoidable membership lookups to large accounting reads. Intent: compose the existing active-org
-- and permission helpers into one STABLE organization-set helper, then use an uncorrelated subquery
-- so PostgreSQL can initialize the authorized set once per statement. Security: role definitions,
-- active-org narrowing, ordinary-expense visibility, audit branches, and every write check remain
-- unchanged. No index or application-data changes are included.
--
-- Rollback: restore the prior policy USING expressions from the preceding migrations, drop
-- private.finance_read_org_ids(), revoke authenticated USAGE on private, then drop schema private.
-- This migration creates that previously absent schema; remove newer private-schema objects first.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.finance_read_org_ids()
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select scoped.org_id
  from public.user_org_ids() as scoped(org_id)
  where public.authorize('finance.read', scoped.org_id)
$$;

revoke execute on function private.finance_read_org_ids() from public, anon, authenticated;
grant execute on function private.finance_read_org_ids() to authenticated;

comment on function private.finance_read_org_ids() is
  'Active-org-narrowed organizations where the current user has finance.read; used as a one-time uncorrelated RLS subplan.';

alter policy tenant_read on public.custody_accounts
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.custody_movements
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.payment_requests
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.payment_request_lines
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.accounts
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.journal_entries
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.journal_lines
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.payment_request_fundings
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.cost_centers
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.offshoot_valuation
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.buyers
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.sales
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.sale_collections
  using (org_id in (select private.finance_read_org_ids()));
alter policy tenant_read on public.accounting_periods
  using (org_id in (select private.finance_read_org_ids()));

-- Ordinary operating/capex expenses stay visible to active organization members. Only the existing
-- drawing arm moves to the finance organization set; the policy's budget.write WITH CHECK is retained.
alter policy tenant_all on public.expenses
  using (
    org_id in (select public.user_org_ids())
    and (
      kind <> 'drawing'
      or org_id in (select private.finance_read_org_ids())
    )
  );

-- Preserve every existing audit branch. Only the finance-entity branch uses the precomputed set.
alter policy audit_read on public.audit_log
  using (
    org_id in (select public.user_org_ids())
    and (
      (
        entity_type is distinct from 'people_compensation'
        and entity_type not in (
          'sale','expense','custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation',
          'buyer','sale_collection','accounting_period'
        )
      )
      or (entity_type = 'people_compensation' and public.authorize('payroll.read', org_id))
      or (entity_type in ('sale','expense') and public.authorize('budget.write', org_id))
      or (
        entity_type in (
          'custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation',
          'buyer','sale_collection','accounting_period'
        )
        and org_id in (select private.finance_read_org_ids())
      )
    )
  );

commit;

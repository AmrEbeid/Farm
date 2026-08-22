-- One role-aware, atomic read for the daily finance dashboard.
-- Full totals/counts are independent from bounded detail samples; numeric money leaves PostgreSQL as text.
-- Farm managers retain the existing shared budget/operational view, while finance-only queues stay withheld.

begin;

create index if not exists finance_dashboard_pr_followup_idx
  on public.purchase_requests(org_id, needed_by asc nulls last, id)
  where status in ('submitted', 'approved', 'partially_received');

create index if not exists finance_dashboard_payment_followup_idx
  on public.payment_requests(org_id, created_at desc, id desc)
  where status in ('submitted', 'approved_operational', 'approved_final');

create or replace function public.fn_finance_dashboard_snapshot(
  p_org uuid,
  p_month_start date,
  p_month_end date,
  p_as_of date,
  p_row_limit integer default 12,
  p_journal_limit integer default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_can_see_accounting boolean;
  v_budget_authority text;
  v_result jsonb;
begin
  if p_org is null or p_month_start is null or p_month_end is null or p_as_of is null then
    raise exception 'organization and dashboard dates are required' using errcode = '23502';
  end if;
  if p_month_end <= p_month_start then
    raise exception 'month end must be after month start' using errcode = '22023';
  end if;
  if p_as_of <> (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'dashboard as-of must equal the current Cairo business date' using errcode = '22007';
  end if;
  if p_month_start <> date_trunc('month', p_as_of)::date
     or p_month_end <> (date_trunc('month', p_as_of) + interval '1 month')::date then
    raise exception 'dashboard month bounds must contain the Cairo as-of date' using errcode = '22007';
  end if;
  if p_row_limit is null or p_row_limit < 1 or p_row_limit > 50 then
    raise exception 'row limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_journal_limit is null or p_journal_limit < 1 or p_journal_limit > 20 then
    raise exception 'journal limit must be between 1 and 20' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org finance dashboard' using errcode = '42501';
  end if;

  select m.role
    into v_role
    from public.organization_member m
   where m.org_id = p_org
     and m.user_id = (select auth.uid())
   limit 1;
  if v_role is null or v_role not in ('owner', 'accountant', 'farm_manager') then
    raise exception 'forbidden: finance dashboard requires owner/accountant/farm_manager'
      using errcode = '42501';
  end if;
  v_can_see_accounting := public.authorize('finance.read', p_org);
  select coalesce((
    select d.status
      from public.data_authority_status d
     where d.org_id = p_org and d.domain = 'budgets'
  ), 'unverified') into v_budget_authority;

  if exists (
    select 1
      from public.custody_movements m
      left join public.custody_accounts a
        on a.id = m.custody_account_id and a.org_id = p_org
     where m.org_id = p_org and a.id is null
  ) then
    raise exception 'finance dashboard custody movement organization mismatch' using errcode = '23514';
  end if;

  with
  budget_source as materialized (
    select b.id, b.name, b.category, b.approved, b.committed, b.actual
     from public.budgets b
     where b.org_id = p_org
       and v_budget_authority = 'verified'
  ),
  budget_summary as (
    select count(*)::bigint as budget_count,
           coalesce(sum(approved), 0) as approved,
           coalesce(sum(committed), 0) as committed,
           coalesce(sum(actual), 0) as actual
      from budget_source
  ),
  budget_categories as (
    select coalesce(category, '—') as category,
           coalesce(sum(approved), 0) as approved,
           coalesce(sum(committed), 0) as committed,
           coalesce(sum(actual), 0) as actual
      from budget_source
     group by coalesce(category, '—')
  ),
  budget_rows as materialized (
    select id, coalesce(name, '—') as name, coalesce(category, '—') as category,
           approved, committed, actual
      from budget_source
     order by (approved - committed - actual), id
     limit 8
  ),
  expense_rows as materialized (
    select e.id, e.date, e.category, e.description, e.total, e.kind, e.account_id,
           e.supplier_id, s.name as supplier_name, s.org_id as supplier_org_id
      from public.expenses e
      left join public.suppliers s on s.id = e.supplier_id and s.org_id = p_org
     where e.org_id = p_org
       and (e.kind <> 'drawing' or v_can_see_accounting)
     order by e.date desc nulls last, e.id desc
     limit p_row_limit
  ),
  expense_sample_summary as (
    select count(*)::bigint as row_count,
           coalesce(sum(total) filter (where kind = 'operating'), 0) as operating_total,
           count(*) filter (where kind = 'operating' and total is null)::bigint as operating_unknown_count,
           coalesce(sum(total) filter (where kind = 'drawing'), 0) as drawing_total,
           count(*) filter (where kind = 'drawing' and total is null)::bigint as drawing_unknown_count,
           count(*) filter (where supplier_id is not null and supplier_org_id is null)::bigint as supplier_mismatch_count
      from expense_rows
  ),
  pr_rows as materialized (
    select pr.id, pr.code, pr.status, pr.reason, pr.needed_by
      from public.purchase_requests pr
     where pr.org_id = p_org
       and pr.status in ('submitted', 'approved', 'partially_received')
     order by pr.needed_by asc nulls last, pr.id
     limit p_row_limit
  ),
  pr_sample_summary as (
    select count(*)::bigint as row_count,
           count(*) filter (where status = 'submitted')::bigint as submitted_count,
           count(*) filter (where needed_by between p_as_of and p_as_of + 7)::bigint as near_due_count
      from pr_rows
  ),
  payment_rows as materialized (
    select r.id, r.request_no, r.status, r.period_start, r.period_end,
           r.approved_net_request, r.created_at
      from public.payment_requests r
     where v_can_see_accounting
       and r.org_id = p_org
       and r.status in ('submitted', 'approved_operational', 'approved_final')
     order by r.created_at desc nulls last, r.id desc
     limit p_row_limit
  ),
  unpaid_rows as materialized (
    select e.id, e.date, e.category, e.description, e.total, e.kind
      from public.expenses e
     where v_can_see_accounting
       and e.org_id = p_org
       and e.payment_status = 'post_paid_unpaid'
     order by e.date asc nulls last, e.id
     limit p_row_limit
  ),
  journal_rows as materialized (
    select j.id, j.entry_date, j.source_type, j.description, j.status, j.posted_at
      from public.journal_entries j
     where v_can_see_accounting
       and j.org_id = p_org
     order by j.entry_date desc nulls last, j.posted_at desc nulls last, j.id desc
     limit p_journal_limit
  )
  select jsonb_build_object(
    'version', 'farm-os.finance-dashboard.v1',
    'org_id', p_org,
    'role', v_role,
    'can_see_accounting', v_can_see_accounting,
    'as_of', p_as_of::text,
    'month_start', p_month_start::text,
    'month_end', p_month_end::text,
    'row_limit', p_row_limit,
    'journal_limit', p_journal_limit,
    'budget_authority_status', v_budget_authority,
    'budget_summary', (
      select jsonb_build_object(
        'budget_count', budget_count,
        'approved', approved::text,
        'committed', committed::text,
        'actual', actual::text
      ) from budget_summary
    ),
    'budget_categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', category,
        'approved', approved::text,
        'committed', committed::text,
        'actual', actual::text
      ) order by category)
      from budget_categories
    ), '[]'::jsonb),
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'name', name,
        'category', category,
        'approved', approved::text,
        'committed', committed::text,
        'actual', actual::text
      ) order by (approved - committed - actual), id)
      from budget_rows
    ), '[]'::jsonb),
    'expense_sample_summary', (
      select jsonb_build_object(
        'row_count', row_count,
        'operating_total', operating_total::text,
        'operating_unknown_count', operating_unknown_count,
        'drawing_total', case when v_can_see_accounting then drawing_total::text else null end,
        'drawing_unknown_count', case when v_can_see_accounting then drawing_unknown_count else null end,
        'supplier_mismatch_count', supplier_mismatch_count
      ) from expense_sample_summary
    ),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'date', case when date is null then null else date::text end,
        'category', category,
        'description', description,
        'total', case when total is null then null else total::text end,
        'kind', kind,
        'account_id', account_id,
        'supplier_name', supplier_name
      ) order by date desc nulls last, id desc)
      from expense_rows
    ), '[]'::jsonb),
    'purchase_request_sample_summary', (
      select jsonb_build_object(
        'row_count', row_count,
        'submitted_count', submitted_count,
        'near_due_count', near_due_count
      ) from pr_sample_summary
    ),
    'purchase_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'code', code,
        'status', status,
        'reason', reason,
        'needed_by', case when needed_by is null then null else needed_by::text end
      ) order by needed_by asc nulls last, id)
      from pr_rows
    ), '[]'::jsonb),
    'private', case when v_can_see_accounting then jsonb_build_object(
      'custody', public.fn_custody_dashboard_summary(p_org),
      'expense_summary', public.fn_expense_register_summary(p_org, p_month_start, p_month_end),
      'open_payment_count', (
        select count(*) from public.payment_requests r
         where r.org_id = p_org
           and r.status in ('submitted', 'approved_operational', 'approved_final')
      ),
      'ready_payment_count', (
        select count(*) from public.payment_requests r
         where r.org_id = p_org and r.status = 'approved_final'
      ),
      'unclassified_expense_count', (
        select count(*) from public.expenses e
         where e.org_id = p_org and e.account_id is null
      ),
      'journal_count', (
        select count(*) from public.journal_entries j where j.org_id = p_org
      ),
      'payment_requests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'request_no', request_no,
          'status', status,
          'period_start', case when period_start is null then null else period_start::text end,
          'period_end', case when period_end is null then null else period_end::text end,
          'approved_net_request', case when approved_net_request is null then null else approved_net_request::text end
        ) order by created_at desc nulls last, id desc)
        from payment_rows
      ), '[]'::jsonb),
      'unpaid_expenses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'date', case when date is null then null else date::text end,
          'category', category,
          'description', description,
          'total', case when total is null then null else total::text end,
          'kind', kind
        ) order by date asc nulls last, id)
        from unpaid_rows
      ), '[]'::jsonb),
      'journal_entries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'entry_date', entry_date::text,
          'source_type', source_type,
          'description', description,
          'status', status
        ) order by entry_date desc nulls last, posted_at desc nulls last, id desc)
        from journal_rows
      ), '[]'::jsonb)
    ) else null end
  ) into v_result;

  if (v_result->'expense_sample_summary'->>'supplier_mismatch_count')::bigint <> 0 then
    raise exception 'finance dashboard expense supplier organization mismatch' using errcode = '23514';
  end if;
  return v_result;
end;
$$;

revoke execute on function public.fn_finance_dashboard_snapshot(uuid, date, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.fn_finance_dashboard_snapshot(uuid, date, date, date, integer, integer)
  to authenticated;

commit;

-- Exact, reversal-safe revenue attribution for owner finance views.
--
-- The affected pages previously downloaded every finalized sale (and, on two pages, every posted
-- sale journal) before grouping in Node. PostgREST can cap those reads, and three pages did not
-- require a live posted journal at all. This bounded aggregate makes one definition authoritative:
-- a sale contributes only when it is finalized, is not historically reversed, and has a live
-- posted sale journal with an exact revenue-account credit. EXISTS prevents duplicate journal rows
-- from multiplying revenue. Numeric money and bigint counts leave Postgres as text.
begin;

create or replace function public.fn_cost_center_revenue_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_version constant text := 'farm-os.cost-center-revenue-summary.v1';
  v_rows jsonb;
  v_total numeric;
  v_count bigint;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org revenue summary' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  with posted_sales as materialized (
    select s.cost_center_id, s.total
      from public.sales s
     where s.org_id = p_org
       and s.price_status = 'finalized'
       and s.payment_status <> 'historical_reversed'
       and exists (
         select 1
           from public.journal_entries je
           join public.journal_lines revenue_line
             on revenue_line.journal_entry_id = je.id
            and revenue_line.org_id = s.org_id
            and revenue_line.debit = 0
            and revenue_line.credit = s.total
           join public.accounts revenue_account
             on revenue_account.id = revenue_line.account_id
            and revenue_account.org_id = s.org_id
            and revenue_account.account_type = 'revenue'
          where je.org_id = s.org_id
            and je.source_type = 'sale'
            and je.source_id = s.id
            and je.status = 'posted'
       )
  ), grouped as (
    select
      ps.cost_center_id,
      count(*)::bigint as sale_count,
      coalesce(sum(ps.total), 0) as revenue
    from posted_sales ps
    group by ps.cost_center_id
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'cost_center_id', g.cost_center_id,
          'sale_count', g.sale_count::text,
          'revenue', g.revenue::text
        ) order by g.cost_center_id nulls first
      ),
      '[]'::jsonb
    ),
    coalesce(sum(g.revenue), 0),
    coalesce(sum(g.sale_count), 0)
  into v_rows, v_total, v_count
  from grouped g;

  return jsonb_build_object(
    'version', c_version,
    'org_id', p_org,
    'sale_count', v_count::text,
    'total_revenue', v_total::text,
    'rows', v_rows
  );
end;
$$;

revoke execute on function public.fn_cost_center_revenue_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_cost_center_revenue_summary(uuid)
  to authenticated;

comment on function public.fn_cost_center_revenue_summary(uuid) is
  'Exact active-organization sale revenue grouped by nullable cost center; requires a live posted journal with an exact revenue-account credit, is finance.read gated and independent of PostgREST row caps.';

commit;

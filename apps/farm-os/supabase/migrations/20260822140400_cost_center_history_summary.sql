-- Exact annual cost-center aggregate for /finance/reports?view=history.
-- The browser receives one row per year/account/center instead of every journal line and entry.
begin;

create or replace function public.fn_cost_center_history_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unallocated_id uuid;
  v_unallocated_code text;
  v_unallocated_name text;
  v_rows jsonb;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org cost-center history' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  select c.id, c.code, c.name_ar
    into v_unallocated_id, v_unallocated_code, v_unallocated_name
    from public.cost_centers c
   where c.org_id = p_org
     and c.code = 'CC-UNALLOC'
     and c.is_system
   limit 1;
  if v_unallocated_id is null then
    raise exception 'cost-center history: CC-UNALLOC is missing' using errcode = '55000';
  end if;

  with annual as (
    select
      extract(year from je.entry_date)::integer as year,
      a.id as account_id,
      a.code as account_code,
      a.name_ar as account_name_ar,
      a.account_type,
      coalesce(c.id, v_unallocated_id) as cost_center_id,
      coalesce(c.code, v_unallocated_code) as center_code,
      coalesce(c.name_ar, v_unallocated_name) as center_name_ar,
      sum(
        case
          when a.account_type = 'expense' then jl.debit - jl.credit
          else jl.credit - jl.debit
        end
      ) as amount
    from public.journal_lines jl
    join public.journal_entries je
      on je.id = jl.journal_entry_id
     and je.org_id = p_org
     and je.status = 'posted'
     and je.entry_date is not null
    join public.accounts a
      on a.id = jl.account_id
     and a.org_id = p_org
     and a.account_type in ('expense', 'revenue')
    left join public.cost_centers c
      on c.id = jl.cost_center_id
     and c.org_id = p_org
    where jl.org_id = p_org
    group by
      extract(year from je.entry_date)::integer,
      a.id,
      a.code,
      a.name_ar,
      a.account_type,
      coalesce(c.id, v_unallocated_id),
      coalesce(c.code, v_unallocated_code),
      coalesce(c.name_ar, v_unallocated_name)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'year', annual.year,
        'account_id', annual.account_id,
        'account_code', annual.account_code,
        'account_name_ar', annual.account_name_ar,
        'account_type', annual.account_type,
        'cost_center_id', annual.cost_center_id,
        'center_code', annual.center_code,
        'center_name_ar', annual.center_name_ar,
        'amount', annual.amount::text
      )
      order by annual.year, annual.account_code, annual.center_code, annual.account_id, annual.cost_center_id
    ),
    '[]'::jsonb
  )
  into v_rows
  from annual;

  return jsonb_build_object(
    'version', 'farm-os.cost-center-history.v1',
    'rows', v_rows
  );
end;
$$;

revoke execute on function public.fn_cost_center_history_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_cost_center_history_summary(uuid)
  to authenticated;

commit;

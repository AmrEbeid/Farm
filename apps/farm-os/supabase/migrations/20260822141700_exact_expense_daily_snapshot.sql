-- One exact, bounded daily expense-register snapshot.
begin;

create index if not exists expenses_org_date_id_all_idx
  on public.expenses (org_id, date desc nulls last, id desc);

create or replace function public.fn_expense_daily_snapshot(
  p_org uuid,
  p_filter text,
  p_month_start date,
  p_month_end date,
  p_row_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_can_see_drawings boolean;
  v_matching_count bigint;
  v_rows jsonb;
  v_suppliers jsonb;
  v_accounts jsonb;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_filter not in ('all','month','operating','drawing','undated','unrouted','unclassified','uncentered') then
    raise exception 'invalid expense filter' using errcode = '22023';
  end if;
  if p_month_start is null or p_month_end is null or p_month_end <= p_month_start then
    raise exception 'valid month bounds required' using errcode = '22023';
  end if;
  if p_row_limit is null or p_row_limit < 1 or p_row_limit > 500 then
    raise exception 'row limit must be between 1 and 500' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense daily snapshot' using errcode = '42501';
  end if;

  select m.role
    into v_role
    from public.organization_member m
   where m.user_id = (select auth.uid())
     and m.org_id = p_org
   limit 1;
  if v_role is null or v_role not in ('owner','accountant','farm_manager') then
    raise exception 'forbidden: expense daily snapshot requires owner/accountant/farm_manager'
      using errcode = '42501';
  end if;

  v_can_see_drawings := public.authorize('finance.read', p_org);
  if p_filter = 'drawing' and not v_can_see_drawings then
    raise exception 'forbidden: drawing filter requires finance.read' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.expenses e
     where e.org_id = p_org
       and (e.kind <> 'drawing' or v_can_see_drawings)
       and case p_filter
         when 'all' then true
         when 'month' then e.date >= p_month_start and e.date < p_month_end
         when 'operating' then e.kind = 'operating'
         when 'drawing' then e.kind = 'drawing'
         when 'undated' then e.date is null and coalesce(e.payment_status, '') not in ('cancelled','historical_reversed')
         when 'unrouted' then e.payment_status is null
         when 'unclassified' then e.account_id is null
         when 'uncentered' then e.cost_center_id is null
       end
       and (
         (e.supplier_id is not null and not exists (
           select 1 from public.suppliers s where s.id = e.supplier_id and s.org_id = p_org
         ))
         or (e.account_id is not null and not exists (
           select 1 from public.accounts a where a.id = e.account_id and a.org_id = p_org
         ))
         or (e.cost_center_id is not null and not exists (
           select 1 from public.cost_centers c where c.id = e.cost_center_id and c.org_id = p_org
         ))
       )
  ) then
    raise exception 'expense daily snapshot: cross-organization reference corruption'
      using errcode = '23514';
  end if;

  select count(*)
    into v_matching_count
    from public.expenses e
   where e.org_id = p_org
     and (e.kind <> 'drawing' or v_can_see_drawings)
     and case p_filter
       when 'all' then true
       when 'month' then e.date >= p_month_start and e.date < p_month_end
       when 'operating' then e.kind = 'operating'
       when 'drawing' then e.kind = 'drawing'
       when 'undated' then e.date is null and coalesce(e.payment_status, '') not in ('cancelled','historical_reversed')
       when 'unrouted' then e.payment_status is null
       when 'unclassified' then e.account_id is null
       when 'uncentered' then e.cost_center_id is null
     end;

  select coalesce(jsonb_agg(r.payload order by r.date desc nulls last, r.id desc), '[]'::jsonb)
    into v_rows
    from (
      select e.date, e.id, jsonb_build_object(
        'id', e.id,
        'date', case when e.date is null then null else e.date::text end,
        'category', e.category,
        'description', e.description,
        'total', case when e.total is null then null else e.total::text end,
        'kind', e.kind,
        'supplier_id', e.supplier_id,
        'payment_status', e.payment_status,
        'account_id', e.account_id,
        'cost_center_id', e.cost_center_id
      ) as payload
        from public.expenses e
       where e.org_id = p_org
         and (e.kind <> 'drawing' or v_can_see_drawings)
         and case p_filter
           when 'all' then true
           when 'month' then e.date >= p_month_start and e.date < p_month_end
           when 'operating' then e.kind = 'operating'
           when 'drawing' then e.kind = 'drawing'
           when 'undated' then e.date is null and coalesce(e.payment_status, '') not in ('cancelled','historical_reversed')
           when 'unrouted' then e.payment_status is null
           when 'unclassified' then e.account_id is null
           when 'uncentered' then e.cost_center_id is null
         end
       order by e.date desc nulls last, e.id desc
       limit p_row_limit
    ) r;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name, s.id), '[]'::jsonb)
    into v_suppliers
    from public.suppliers s
   where s.org_id = p_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'code', a.code,
    'name_ar', a.name_ar,
    'account_type', a.account_type,
    'kind', a.kind,
    'parent_id', a.parent_id,
    'active', a.active
  ) order by a.code, a.id), '[]'::jsonb)
    into v_accounts
    from public.accounts a
   where a.org_id = p_org
     and v_can_see_drawings;

  return jsonb_build_object(
    'version', 'farm-os.expense-daily.v1',
    'org_id', p_org,
    'filter', p_filter,
    'month_start', p_month_start::text,
    'month_end', p_month_end::text,
    'row_limit', p_row_limit,
    'matching_count', v_matching_count::text,
    'summary', public.fn_expense_register_summary(p_org, p_month_start, p_month_end),
    'expenses', v_rows,
    'suppliers', v_suppliers,
    'accounts', v_accounts
  );
end;
$$;

revoke execute on function public.fn_expense_daily_snapshot(uuid,text,date,date,integer)
  from public, anon, authenticated;
grant execute on function public.fn_expense_daily_snapshot(uuid,text,date,date,integer)
  to authenticated;

commit;

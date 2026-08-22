-- One exact, role-gated snapshot for /finance/reports.
begin;

create or replace function public.fn_cost_center_reports_snapshot(
  p_org uuid,
  p_include_history boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rollup jsonb;
  v_flags jsonb;
  v_history jsonb := '[]'::jsonb;
  v_rollup_count integer;
  v_flag_count integer;
  v_history_count integer := 0;
  v_unallocated_count bigint;
  v_expense numeric;
  v_revenue numeric;
  v_integrity_count bigint;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_include_history is null then
    raise exception 'history flag required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org cost-center report' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  -- SECURITY DEFINER must not turn damaged cross-tenant relationships into a partial report.
  select count(*)
    into v_integrity_count
    from (
      select jl.id
        from public.journal_lines jl
        left join public.journal_entries je on je.id = jl.journal_entry_id
        left join public.accounts a on a.id = jl.account_id
        left join public.cost_centers c on c.id = jl.cost_center_id
       where jl.org_id = p_org
         and (
           je.id is null
           or a.id is null
           or je.org_id is distinct from p_org
           or a.org_id is distinct from p_org
           or (jl.cost_center_id is not null and (c.id is null or c.org_id is distinct from p_org))
         )
      union all
      select jl.id
        from public.journal_entries je
        join public.journal_lines jl on jl.journal_entry_id = je.id
       where je.org_id = p_org and jl.org_id is distinct from p_org
      union all
      select jl.id
        from public.accounts a
        join public.journal_lines jl on jl.account_id = a.id
       where a.org_id = p_org and jl.org_id is distinct from p_org
      union all
      select jl.id
        from public.cost_centers c
        join public.journal_lines jl on jl.cost_center_id = c.id
       where c.org_id = p_org and jl.org_id is distinct from p_org
    ) mismatches;

  select v_integrity_count + count(*)
    into v_integrity_count
    from public.cost_centers c
    left join public.cost_centers parent on parent.id = c.parent_id
    left join public.sectors s on s.id = c.sector_id
   where c.org_id = p_org
     and (
       (c.parent_id is not null and (parent.id is null or parent.org_id is distinct from p_org))
       or (c.sector_id is not null and (s.id is null or s.org_id is distinct from p_org))
     );

  if v_integrity_count <> 0 then
    raise exception 'cost-center report: tenant integrity mismatch' using errcode = '55000';
  end if;

  select count(*) into v_integrity_count
    from public.cost_centers c
   where c.org_id = p_org and c.code = 'CC-UNALLOC' and c.is_system;
  if v_integrity_count <> 1 then
    raise exception 'cost-center report: CC-UNALLOC is missing or invalid' using errcode = '55000';
  end if;

  -- Privileged imports can bypass the save RPC's cycle guard. Detect damaged hierarchies before
  -- recursive rollup so the report fails closed instead of exhausting the statement timeout.
  with recursive paths as (
    select c.id as origin_id, c.id as current_id, array[c.id] as visited, false as cycle
      from public.cost_centers c
     where c.org_id = p_org
    union all
    select p.origin_id, child.id, p.visited || child.id, child.id = any(p.visited)
      from paths p
      join public.cost_centers child
        on child.parent_id = p.current_id
       and child.org_id = p_org
     where not p.cycle and cardinality(p.visited) < 5
  )
  select count(*) into v_integrity_count
    from paths
   where cycle or cardinality(visited) > 4;

  if v_integrity_count <> 0 then
    raise exception 'cost-center report: hierarchy cycle or depth exceeds 4' using errcode = '55000';
  end if;

  with recursive subtree as (
    select c.id as ancestor_id, c.id as descendant_id, array[c.id] as visited
      from public.cost_centers c
     where c.org_id = p_org
    union all
    select s.ancestor_id, child.id, s.visited || child.id
      from subtree s
      join public.cost_centers child
        on child.parent_id = s.descendant_id
       and child.org_id = p_org
     where not child.id = any(s.visited) and cardinality(s.visited) < 4
  ), rows as (
    select
      c.org_id,
      c.id as cost_center_id,
      c.parent_id,
      c.code,
      c.name_ar,
      c.sector_id,
      c.enterprise,
      c.area_feddan,
      c.active,
      c.is_system,
      c.sort_order,
      count(jl.id) filter (where a.id is not null) as line_count,
      coalesce(sum(case when a.account_type = 'expense' then jl.debit - jl.credit else 0 end), 0) as expense,
      coalesce(sum(case when a.account_type = 'revenue' then jl.credit - jl.debit else 0 end), 0) as revenue,
      coalesce(sum(case when a.account_type = 'revenue' then jl.credit - jl.debit else 0 end), 0)
        - coalesce(sum(case when a.account_type = 'expense' then jl.debit - jl.credit else 0 end), 0) as net,
      case when c.area_feddan > 0
        then (
          coalesce(sum(case when a.account_type = 'revenue' then jl.credit - jl.debit else 0 end), 0)
          - coalesce(sum(case when a.account_type = 'expense' then jl.debit - jl.credit else 0 end), 0)
        ) / c.area_feddan
        else null
      end as net_per_feddan
      from public.cost_centers c
      left join subtree s on s.ancestor_id = c.id
      left join public.journal_lines jl
        on jl.org_id = p_org
       and (
         jl.cost_center_id = s.descendant_id
         or (
           c.code = 'CC-UNALLOC'
           and s.descendant_id = c.id
           and jl.cost_center_id is null
         )
       )
       and exists (
         select 1 from public.journal_entries je
          where je.id = jl.journal_entry_id and je.org_id = p_org and je.status = 'posted'
       )
      left join public.accounts a
        on a.id = jl.account_id
       and a.org_id = p_org
       and a.account_type in ('expense', 'revenue')
     where c.org_id = p_org
     group by c.org_id, c.id, c.parent_id, c.code, c.name_ar, c.sector_id, c.enterprise,
       c.area_feddan, c.active, c.is_system, c.sort_order
  )
  select
    count(*)::integer,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'org_id', rows.org_id,
        'cost_center_id', rows.cost_center_id,
        'parent_id', rows.parent_id,
        'code', rows.code,
        'name_ar', rows.name_ar,
        'sector_id', rows.sector_id,
        'enterprise', rows.enterprise,
        'area_feddan', case when rows.area_feddan is null then null else to_jsonb(rows.area_feddan::text) end,
        'active', rows.active,
        'is_system', rows.is_system,
        'sort_order', rows.sort_order,
        'line_count', rows.line_count,
        'expense', rows.expense::text,
        'revenue', rows.revenue::text,
        'net', rows.net::text,
        'net_per_feddan', case when rows.net_per_feddan is null then null else to_jsonb(rows.net_per_feddan::text) end
      ) order by rows.sort_order nulls last, rows.code, rows.cost_center_id
    ), '[]'::jsonb)
    into v_rollup_count, v_rollup
    from rows;

  with rows as (
    select
      c.org_id,
      c.id as cost_center_id,
      c.code,
      c.name_ar,
      'missing_sector_link'::text as flag_code,
      'مركز تكلفة محاسبي بلا ربط مباشر بقطاع فعلي'::text as message_ar
      from public.cost_centers c
     where c.org_id = p_org and c.active and not c.is_system and c.sector_id is null
    union all
    select
      c.org_id,
      c.id,
      c.code,
      c.name_ar,
      'area_mismatch'::text,
      ('مساحة مركز التكلفة ' || c.area_feddan::text || ' فدان لا تطابق مساحة القطاع ' || s.area_feddan::text || ' فدان')::text
      from public.cost_centers c
      join public.sectors s on s.id = c.sector_id and s.org_id = p_org
     where c.org_id = p_org
       and c.active
       and not c.is_system
       and c.parent_id is null
       and c.area_feddan is not null
       and s.area_feddan is not null
       and abs(c.area_feddan - s.area_feddan) > 0.01
  )
  select
    count(*)::integer,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'org_id', rows.org_id,
        'cost_center_id', rows.cost_center_id,
        'code', rows.code,
        'name_ar', rows.name_ar,
        'flag_code', rows.flag_code,
        'message_ar', rows.message_ar
      ) order by rows.code, rows.flag_code, rows.cost_center_id
    ), '[]'::jsonb)
    into v_flag_count, v_flags
    from rows;

  select
    coalesce(sum(case when a.account_type = 'expense' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_type = 'revenue' then jl.credit - jl.debit else 0 end), 0),
    count(*) filter (where jl.cost_center_id is null)
    into v_expense, v_revenue, v_unallocated_count
    from public.journal_lines jl
    join public.journal_entries je
      on je.id = jl.journal_entry_id
     and je.org_id = p_org
     and je.status = 'posted'
    join public.accounts a
      on a.id = jl.account_id
     and a.org_id = p_org
     and a.account_type in ('expense', 'revenue')
   where jl.org_id = p_org;

  if p_include_history then
    v_history := public.fn_cost_center_history_summary(p_org)->'rows';
    if jsonb_typeof(v_history) is distinct from 'array' then
      raise exception 'cost-center report: history payload is invalid' using errcode = '55000';
    end if;
    v_history_count := jsonb_array_length(v_history);
  end if;

  return jsonb_build_object(
    'version', 'farm-os.cost-center-reports.v1',
    'org_id', p_org,
    'history_included', p_include_history,
    'rollup_count', v_rollup_count,
    'flag_count', v_flag_count,
    'history_count', v_history_count,
    'unallocated_line_count', v_unallocated_count,
    'expense_total', v_expense::text,
    'revenue_total', v_revenue::text,
    'profit', (v_revenue - v_expense)::text,
    'rollup', v_rollup,
    'flags', v_flags,
    'history', v_history
  );
end;
$$;

revoke execute on function public.fn_cost_center_reports_snapshot(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.fn_cost_center_reports_snapshot(uuid, boolean)
  to authenticated;

commit;

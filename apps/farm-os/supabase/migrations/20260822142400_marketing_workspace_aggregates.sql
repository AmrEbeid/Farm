-- SPEC-0032: exact all-row aggregates for workspace insights; never aggregate only the UI page.

create or replace function public.fn_marketing_workspace_aggregates(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_daily jsonb;
  v_weekly jsonb;
begin
  if p_org is null or p_org not in (select public.user_org_ids()) or not exists (
    select 1 from public.organization_member m
    where m.user_id = v_uid and m.org_id = p_org
      and m.role in ('owner','accountant','farm_manager')
  ) then
    raise exception 'not authorized to read marketing workspace aggregates' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(summary) order by summary.revenue desc, summary.name), '[]'::jsonb)
  into v_daily
  from (
    select
      sector->>'name' as name,
      count(distinct r.payload->>'date')::integer as days,
      sum((sector->>'qtyKg')::numeric) as "qtyKg",
      sum((sector->>'revenueShare')::numeric) as revenue,
      sum((sector->>'expenseShare')::numeric) as expenses,
      sum((sector->>'netShare')::numeric) as net,
      case when sum((sector->>'qtyKg')::numeric) = 0 then 0
        else sum((sector->>'revenueShare')::numeric) / sum((sector->>'qtyKg')::numeric) end as "avgPrice"
    from public.marketing_record r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'sectors', '[]'::jsonb)) sector
    where r.org_id = p_org and not r.archived and r.record_type = 'daily_sales_report'
      and jsonb_typeof(sector) = 'object'
      and jsonb_typeof(sector->'qtyKg') = 'number'
      and jsonb_typeof(sector->'revenueShare') = 'number'
      and jsonb_typeof(sector->'expenseShare') = 'number'
      and jsonb_typeof(sector->'netShare') = 'number'
      and nullif(btrim(sector->>'name'), '') is not null
    group by sector->>'name'
  ) summary;

  select jsonb_build_object(
    'weeks', count(distinct nullif(btrim(coalesce(payload->>'week','')), '')),
    'premiumTons', coalesce(sum(case when lower(coalesce(payload->>'variety','')) like '%premium%'
      or coalesce(payload->>'variety','') like '%بريميوم%' then
        case when coalesce(payload->>'tons','') ~ '^[0-9]+([.][0-9]+)?$' then (payload->>'tons')::numeric else 0 end else 0 end), 0),
    'largeTons', coalesce(sum(case when lower(coalesce(payload->>'variety','')) like '%large%'
      or coalesce(payload->>'variety','') like '%كبير%' then
        case when coalesce(payload->>'tons','') ~ '^[0-9]+([.][0-9]+)?$' then (payload->>'tons')::numeric else 0 end else 0 end), 0),
    'commercialTons', coalesce(sum(case when lower(coalesce(payload->>'variety','')) like '%commercial%'
      or coalesce(payload->>'variety','') like '%تجار%' then
        case when coalesce(payload->>'tons','') ~ '^[0-9]+([.][0-9]+)?$' then (payload->>'tons')::numeric else 0 end else 0 end), 0)
  )
  into v_weekly
  from public.marketing_record
  where org_id = p_org and not archived and record_type = 'weekly_availability';

  return jsonb_build_object('dailySectorLedger', v_daily, 'weeklyAvailability', v_weekly);
end;
$$;

revoke execute on function public.fn_marketing_workspace_aggregates(uuid) from public, anon;
grant execute on function public.fn_marketing_workspace_aggregates(uuid) to authenticated;

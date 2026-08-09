-- One exact, atomic read for the daily harvest/revenue season cockpit.
-- Full aggregates are never derived from the bounded delivery sample; every numeric leaves as text.

begin;

create index if not exists season_sales_org_event_date_idx
  on public.sales(
    org_id,
    (coalesce(sale_date, delivery_date, (created_at at time zone 'Africa/Cairo')::date)) desc,
    id desc
  )
  where payment_status not in ('historical_treasury', 'historical_reversed');

create or replace function public.fn_season_dashboard_snapshot(
  p_org uuid,
  p_from date,
  p_as_of date,
  p_row_limit integer default 400)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_org is null or p_from is null or p_as_of is null then
    raise exception 'organization and season dates are required' using errcode = '23502';
  end if;
  if p_from > p_as_of then
    raise exception 'season start must not be after as-of date' using errcode = '22007';
  end if;
  if p_as_of > (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'season as-of date cannot be in the future' using errcode = '22007';
  end if;
  if p_row_limit is null or p_row_limit < 1 or p_row_limit > 400 then
    raise exception 'row limit must be between 1 and 400' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org season snapshot' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  with
  visible_sales as materialized (
    select
      s.id,
      s.sale_date,
      s.delivery_date,
      s.created_at,
      coalesce(s.sale_date, s.delivery_date,
        (s.created_at at time zone 'Africa/Cairo')::date) as event_date,
      s.crop,
      s.qty,
      s.unit,
      s.total,
      s.price_status,
      s.payment_status,
      (select count(*) = 1 and bool_and(
          (select
              count(*) = 2
              and sum(jl.debit) = s.total
              and sum(jl.credit) = s.total
              and count(*) filter (
                where a.code = '1200' and a.account_type = 'asset'
                  and jl.debit = s.total and jl.credit = 0
              ) = 1
              and count(*) filter (
                where a.account_type = 'revenue'
                  and jl.debit = 0 and jl.credit = s.total
              ) = 1
            from public.journal_lines jl
            join public.accounts a
              on a.id = jl.account_id and a.org_id = s.org_id
            where jl.journal_entry_id = je.id
              and jl.org_id = s.org_id)
        )
        from public.journal_entries je
        where je.org_id = s.org_id
          and je.source_type = 'sale'
          and je.source_id = s.id
          and je.status = 'posted'
      ) as revenue_posted,
      s.buyer_id,
      b.name as buyer_name,
      b.org_id as buyer_org_id,
      s.cost_center_id,
      cc.name_ar as cost_center_name,
      cc.area_feddan,
      cc.org_id as cost_center_org_id,
      s.delivery_note_no,
      s.crates
    from public.sales s
    left join public.buyers b
      on b.id = s.buyer_id and b.org_id = p_org
    left join public.cost_centers cc
      on cc.id = s.cost_center_id and cc.org_id = p_org
    where s.org_id = p_org
      and s.payment_status not in ('historical_treasury', 'historical_reversed')
      and coalesce(s.sale_date, s.delivery_date,
        (s.created_at at time zone 'Africa/Cairo')::date) between p_from and p_as_of
  ),
  collection_totals as materialized (
    select c.sale_id, sum(c.amount) as amount
    from public.sale_collections c
    join visible_sales vs on vs.id = c.sale_id
    where c.org_id = p_org
    group by c.sale_id
  ),
  enriched_sales as materialized (
    select vs.*, coalesce(ct.amount, 0::numeric) as collected
    from visible_sales vs
    left join collection_totals ct on ct.sale_id = vs.id
  ),
  summary as materialized (
    select
      count(*)::integer as delivery_count,
      count(distinct buyer_id)::integer as trader_count,
      count(*) filter (where buyer_id is null)::integer as unnamed_count,
      count(*) filter (where qty is null)::integer as unknown_qty_count,
      count(*) filter (where price_status = 'pending')::integer as pending_count,
      count(*) filter (where price_status = 'pending' and qty is null)::integer as pending_unknown_qty_count,
      count(*) filter (where price_status = 'finalized' and not revenue_posted)::integer as invalid_revenue_count,
      coalesce(sum(qty), 0::numeric) as delivered_qty,
      coalesce(sum(qty) filter (where price_status = 'pending'), 0::numeric) as pending_qty,
      coalesce(sum(total) filter (where price_status = 'finalized' and revenue_posted), 0::numeric) as finalized_total,
      coalesce(sum(collected) filter (where revenue_posted), 0::numeric) as collected_total
    from enriched_sales
  ),
  picked_by_crop as materialized (
    select hd.crop, sum(hd.crates_picked) as crates
    from public.harvest_days hd
    where hd.org_id = p_org
      and hd.day between p_from and p_as_of
    group by hd.crop
  ),
  crate_summary as materialized (
    select
      coalesce((select sum(pbc.crates) from picked_by_crop pbc), 0::numeric) as picked_crates,
      coalesce((
        select sum(coalesce(vs.crates, 0::numeric))
        from visible_sales vs
        join picked_by_crop pbc on pbc.crop = vs.crop
      ), 0::numeric) as delivered_crates
  ),
  party_mismatch as materialized (
    select count(*)::integer as value
    from visible_sales vs
    where (vs.buyer_id is not null and (vs.buyer_name is null or vs.buyer_org_id is distinct from p_org))
       or (vs.cost_center_id is not null and (vs.cost_center_name is null or vs.cost_center_org_id is distinct from p_org))
  ),
  sample_sales as materialized (
    select * from enriched_sales
    order by event_date desc, id desc
    limit p_row_limit
  ),
  center_rows as materialized (
    select
      es.cost_center_id as id,
      es.cost_center_name as name,
      es.area_feddan,
      count(*)::integer as delivery_count,
      count(*) filter (where es.qty is null)::integer as unknown_qty_count,
      count(*) filter (where es.price_status = 'pending')::integer as pending_count,
      coalesce(sum(es.qty), 0::numeric) as qty,
      coalesce(sum(es.total) filter (
        where es.price_status = 'finalized' and es.revenue_posted
      ), 0::numeric) as finalized_total,
      case
        when count(*) filter (where es.qty is null) = 0 and es.area_feddan > 0
          then coalesce(sum(es.qty), 0::numeric) / es.area_feddan
        else null
      end as qty_per_feddan
    from enriched_sales es
    where es.cost_center_id is not null
    group by es.cost_center_id, es.cost_center_name, es.area_feddan
  )
  select jsonb_build_object(
    'version', 'farm-os.season-dashboard.v1',
    'org_id', p_org,
    'from', p_from,
    'as_of', p_as_of,
    'row_limit', p_row_limit,
    'party_mismatch_count', (select value from party_mismatch),
    'summary', jsonb_build_object(
      'delivery_count', s.delivery_count,
      'trader_count', s.trader_count,
      'unnamed_count', s.unnamed_count,
      'unknown_qty_count', s.unknown_qty_count,
      'pending_count', s.pending_count,
      'pending_unknown_qty_count', s.pending_unknown_qty_count,
      'invalid_revenue_count', s.invalid_revenue_count,
      'delivered_qty', s.delivered_qty::text,
      'delivered_tons', (s.delivered_qty / 1000::numeric)::text,
      'pending_qty', s.pending_qty::text,
      'pending_tons', (s.pending_qty / 1000::numeric)::text,
      'finalized_total', s.finalized_total::text,
      'collected_total', s.collected_total::text,
      'outstanding_total', (s.finalized_total - s.collected_total)::text,
      'collection_percent', case when s.finalized_total > 0
        then ((s.collected_total * 100::numeric) / s.finalized_total)::text else null end,
      'picked_crates', cs.picked_crates::text,
      'delivered_crates', cs.delivered_crates::text
    ),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', ss.id,
      'event_date', ss.event_date,
      'crop', ss.crop,
      'quantity', case when ss.qty is null then null else ss.qty::text end,
      'unit', ss.unit,
      'amount', case when ss.revenue_posted then ss.total::text else null end,
      'price_status', ss.price_status,
      'payment_status', ss.payment_status,
      'revenue_posted', ss.revenue_posted,
      'buyer_id', ss.buyer_id,
      'buyer_name', ss.buyer_name,
      'cost_center_id', ss.cost_center_id,
      'delivery_note_no', ss.delivery_note_no,
      'crates', case when ss.crates is null then null else ss.crates::text end
    ) order by ss.event_date desc, ss.id desc) from sample_sales ss), '[]'::jsonb),
    'centers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', cr.id,
      'name', cr.name,
      'area_feddan', case when cr.area_feddan is null then null else cr.area_feddan::text end,
      'delivery_count', cr.delivery_count,
      'unknown_qty_count', cr.unknown_qty_count,
      'pending_count', cr.pending_count,
      'quantity', cr.qty::text,
      'quantity_per_feddan', case when cr.qty_per_feddan is null then null else cr.qty_per_feddan::text end,
      'finalized_total', cr.finalized_total::text
    ) order by cr.qty desc, cr.id) from center_rows cr), '[]'::jsonb)
  ) into v_result
  from summary s cross join crate_summary cs;

  if (v_result->>'party_mismatch_count')::integer <> 0 then
    raise exception 'season snapshot party mismatch' using errcode = '23514';
  end if;
  if (v_result->'summary'->>'outstanding_total')::numeric < 0 then
    raise exception 'season snapshot collections exceed finalized revenue' using errcode = '23514';
  end if;

  return v_result;
end;
$$;

revoke execute on function public.fn_season_dashboard_snapshot(uuid, date, date, integer)
  from public, anon, authenticated;
grant execute on function public.fn_season_dashboard_snapshot(uuid, date, date, integer)
  to authenticated;

commit;

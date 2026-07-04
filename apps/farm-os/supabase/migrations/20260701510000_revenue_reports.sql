-- SPEC-0024 S-10b / SPEC-0018-EXT §4 — revenue reports + A/R aging.
--
-- PROBLEM. The revenue/A-R backend can now record pending-price deliveries, final prices, and collections,
-- but owner/accountant users still lack one printable/exportable report source for period sales, collections,
-- pending prices, and outstanding receivables.
--
-- INTENT. Add one finance.read-gated read RPC that returns derived JSON for the UI. It is read-only and
-- keeps the cash-method discipline: pending-price deliveries are visible as operational/revenue work-in-progress
-- but excluded from finalized revenue and A/R totals until a price is finalized.
--
-- SECURITY. SECURITY DEFINER, search_path='', explicit org membership + finance.read checks, no anonymous
-- EXECUTE. No table grants, no posting, no permission widening, and no authorize() re-emit.
--
-- ROLLBACK. Drop public.fn_revenue_sales_report(uuid,date,date,date). No persisted business data is changed.

begin;

create or replace function public.fn_revenue_sales_report(
  p_org uuid,
  p_period_start date default null,
  p_period_end date default null,
  p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_end date := coalesce(p_period_end, current_date);
  v_as_of date := coalesce(p_as_of, coalesce(p_period_end, current_date));
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if v_start > v_end then
    raise exception 'period_start must be on or before period_end' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org revenue report' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  return (
    with sale_base as (
      select
        s.id as sale_id,
        coalesce(s.sale_date, s.delivery_date, s.created_at::date) as report_date,
        s.sale_date,
        s.delivery_date,
        s.crop,
        s.season,
        s.qty,
        s.unit,
        s.unit_price,
        s.total,
        s.price_status,
        s.payment_status,
        s.buyer_id,
        b.name as buyer_name,
        b.buyer_type,
        s.cost_center_id,
        cc.code as cost_center_code,
        cc.name_ar as cost_center_name,
        s.farm_id,
        f.name as farm_name,
        s.sector_id,
        sec.name as sector_name,
        s.hawsha_id,
        h.name as hawsha_name,
        coalesce(col.collected_to_as_of, 0) as collected_to_as_of,
        coalesce(col.collected_in_period, 0) as collected_in_period,
        case
          when s.price_status = 'finalized' then greatest(coalesce(s.total, 0) - coalesce(col.collected_to_as_of, 0), 0)
          else null
        end as outstanding,
        greatest(0, v_as_of - coalesce(s.sale_date, s.delivery_date, s.created_at::date)) as age_days,
        case
          when greatest(0, v_as_of - coalesce(s.sale_date, s.delivery_date, s.created_at::date)) >= 60 then '60+'
          when greatest(0, v_as_of - coalesce(s.sale_date, s.delivery_date, s.created_at::date)) >= 30 then '30-59'
          else '0-29'
        end as aging_bucket
      from public.sales s
      left join public.buyers b on b.id = s.buyer_id and b.org_id = s.org_id
      left join public.cost_centers cc on cc.id = s.cost_center_id and cc.org_id = s.org_id
      left join public.farms f on f.id = s.farm_id and f.org_id = s.org_id
      left join public.sectors sec on sec.id = s.sector_id and sec.org_id = s.org_id
      left join public.hawshat h on h.id = s.hawsha_id and h.org_id = s.org_id
      left join lateral (
        select
          coalesce(sum(c.amount) filter (where c.occurred_at <= v_as_of), 0) as collected_to_as_of,
          coalesce(sum(c.amount) filter (where c.occurred_at between v_start and v_end), 0) as collected_in_period
        from public.sale_collections c
        where c.org_id = s.org_id
          and c.sale_id = s.id
      ) col on true
      where s.org_id = p_org
    ),
    period_sales as (
      select *
      from sale_base
      where report_date between v_start and v_end
    ),
    ar_rows as (
      select *
      from sale_base
      where price_status = 'finalized'
        and report_date <= v_as_of
        and coalesce(outstanding, 0) > 0
    ),
    by_buyer as (
      select
        buyer_id,
        coalesce(buyer_name, 'نقدي/غير محدد') as buyer_name,
        buyer_type,
        count(*)::int as sale_count,
        count(*) filter (where price_status = 'pending')::int as pending_count,
        coalesce(sum(qty), 0) as qty,
        coalesce(sum(total) filter (where price_status = 'finalized'), 0) as finalized_revenue,
        coalesce(sum(collected_in_period), 0) as collected_in_period,
        coalesce(sum(collected_to_as_of), 0) as collected_to_as_of,
        coalesce(sum(outstanding), 0) as outstanding
      from period_sales
      group by buyer_id, coalesce(buyer_name, 'نقدي/غير محدد'), buyer_type
    ),
    by_crop_season as (
      select
        crop,
        coalesce(season, 'غير محدد') as season,
        count(*)::int as sale_count,
        count(*) filter (where price_status = 'pending')::int as pending_count,
        coalesce(sum(qty), 0) as qty,
        coalesce(sum(total) filter (where price_status = 'finalized'), 0) as finalized_revenue,
        coalesce(sum(collected_in_period), 0) as collected_in_period,
        coalesce(sum(outstanding), 0) as outstanding
      from period_sales
      group by crop, coalesce(season, 'غير محدد')
    ),
    collections as (
      select
        c.id as collection_id,
        c.sale_id,
        c.occurred_at,
        c.amount,
        coalesce(b.name, 'نقدي/غير محدد') as buyer_name,
        s.crop,
        s.season,
        c.collected_by,
        c.note,
        c.journal_entry_id
      from public.sale_collections c
      join public.sales s on s.id = c.sale_id and s.org_id = c.org_id
      left join public.buyers b on b.id = s.buyer_id and b.org_id = s.org_id
      where c.org_id = p_org
        and c.occurred_at between v_start and v_end
      order by c.occurred_at desc, c.created_at desc, c.id
    )
    select jsonb_build_object(
      'period_start', v_start,
      'period_end', v_end,
      'as_of', v_as_of,
      'finalized_revenue', coalesce((select sum(total) from period_sales where price_status = 'finalized'), 0),
      'period_collections', coalesce((select sum(amount) from collections), 0),
      'outstanding_total', coalesce((select sum(outstanding) from ar_rows), 0),
      'over_30_amount', coalesce((select sum(outstanding) from ar_rows where age_days >= 30), 0),
      'over_30_count', coalesce((select count(*) from ar_rows where age_days >= 30), 0),
      'pending_count', coalesce((select count(*) from period_sales where price_status = 'pending'), 0),
      'pending_qty', coalesce((select sum(qty) from period_sales where price_status = 'pending'), 0),
      'sales', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'sale_id', sale_id,
            'report_date', report_date,
            'sale_date', sale_date,
            'delivery_date', delivery_date,
            'crop', crop,
            'season', season,
            'qty', qty,
            'unit', unit,
            'unit_price', unit_price,
            'total', total,
            'price_status', price_status,
            'payment_status', payment_status,
            'buyer_id', buyer_id,
            'buyer_name', buyer_name,
            'buyer_type', buyer_type,
            'cost_center_id', cost_center_id,
            'cost_center_code', cost_center_code,
            'cost_center_name', cost_center_name,
            'farm_id', farm_id,
            'farm_name', farm_name,
            'sector_id', sector_id,
            'sector_name', sector_name,
            'hawsha_id', hawsha_id,
            'hawsha_name', hawsha_name,
            'collected_to_as_of', collected_to_as_of,
            'collected_in_period', collected_in_period,
            'outstanding', outstanding
          )
          order by report_date desc, sale_id
        )
        from period_sales
      ), '[]'::jsonb),
      'by_buyer', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'buyer_id', buyer_id,
            'buyer_name', buyer_name,
            'buyer_type', buyer_type,
            'sale_count', sale_count,
            'pending_count', pending_count,
            'qty', qty,
            'finalized_revenue', finalized_revenue,
            'collected_in_period', collected_in_period,
            'collected_to_as_of', collected_to_as_of,
            'outstanding', outstanding
          )
          order by finalized_revenue desc, buyer_name
        )
        from by_buyer
      ), '[]'::jsonb),
      'by_crop_season', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'crop', crop,
            'season', season,
            'sale_count', sale_count,
            'pending_count', pending_count,
            'qty', qty,
            'finalized_revenue', finalized_revenue,
            'collected_in_period', collected_in_period,
            'outstanding', outstanding
          )
          order by finalized_revenue desc, crop, season
        )
        from by_crop_season
      ), '[]'::jsonb),
      'ar_rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'sale_id', sale_id,
            'report_date', report_date,
            'buyer_id', buyer_id,
            'buyer_name', buyer_name,
            'buyer_type', buyer_type,
            'crop', crop,
            'season', season,
            'total', total,
            'collected_to_as_of', collected_to_as_of,
            'outstanding', outstanding,
            'age_days', age_days,
            'aging_bucket', aging_bucket,
            'payment_status', payment_status
          )
          order by age_days desc, report_date asc, sale_id
        )
        from ar_rows
      ), '[]'::jsonb),
      'collections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'collection_id', collection_id,
            'sale_id', sale_id,
            'occurred_at', occurred_at,
            'amount', amount,
            'buyer_name', buyer_name,
            'crop', crop,
            'season', season,
            'collected_by', collected_by,
            'note', note,
            'journal_entry_id', journal_entry_id
          )
          order by occurred_at desc, collection_id
        )
        from collections
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.fn_revenue_sales_report(uuid, date, date, date) from public, anon, authenticated;
grant execute on function public.fn_revenue_sales_report(uuid, date, date, date) to authenticated;

commit;

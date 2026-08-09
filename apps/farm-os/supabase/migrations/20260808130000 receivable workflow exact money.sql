-- Exact, bounded daily receivables workflow.
--
-- The pricing and collection screens previously loaded tenant tables independently, accumulated all
-- collections in JavaScript binary floats, and sent numeric RPC arguments as JS numbers. These focused
-- RPCs keep the active organization and aggregate in PostgreSQL, cap the picker rows after calculating
-- the true remaining balance, and transport every numeric/monetary value as JSON text. The two write
-- functions are re-emitted only to make their JSON money fields exact text as well.

begin;

create or replace function public.fn_pending_sale_pricing(p_org uuid, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit must be between 1 and 500' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org pending sale pricing' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', p_org) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.sales s
      join public.buyers b on b.id = s.buyer_id
     where s.org_id = p_org
       and s.price_status = 'pending'
       and b.org_id <> s.org_id
  ) then
    raise exception 'pending sale pricing tenant invariant failed: cross-org buyer' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', row.id,
      'sale_date', row.sale_date,
      'crop', row.crop,
      'qty', row.qty::text,
      'unit', coalesce(row.unit, ''),
      'buyer_name', row.buyer_name,
      'delivery_note_no', row.delivery_note_no
    ) order by row.sale_date desc nulls last, row.id
  ), '[]'::jsonb)
  into v_rows
  from (
    select
      s.id,
      s.sale_date,
      s.crop,
      s.qty,
      s.unit,
      coalesce(b.name, 'بدون اسم') as buyer_name,
      s.delivery_note_no
    from public.sales s
    left join public.buyers b on b.id = s.buyer_id and b.org_id = s.org_id
    where s.org_id = p_org
      and s.price_status = 'pending'
      and s.qty > 0
    order by s.sale_date desc nulls last, s.id
    limit p_limit
  ) row;

  return v_rows;
end;
$$;
revoke execute on function public.fn_pending_sale_pricing(uuid, integer) from public, anon, authenticated;
grant execute on function public.fn_pending_sale_pricing(uuid, integer) to authenticated;

create or replace function public.fn_open_sale_receivables(p_org uuid, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'limit must be between 1 and 500' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org open receivables' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', p_org) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.sales s
      join public.buyers b on b.id = s.buyer_id
     where s.org_id = p_org
       and s.price_status = 'finalized'
       and s.payment_status not in ('historical_treasury', 'historical_reversed')
       and b.org_id <> s.org_id
  ) then
    raise exception 'open receivables tenant invariant failed: cross-org buyer' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.sales s
    left join lateral (
      select coalesce(sum(c.amount), 0) as collected
      from public.sale_collections c
      where c.sale_id = s.id and c.org_id = s.org_id
    ) totals on true
    where s.org_id = p_org
      and s.price_status = 'finalized'
      and s.payment_status not in ('historical_treasury', 'historical_reversed')
      and totals.collected > coalesce(s.total, 0)
  ) then
    raise exception 'open receivables invariant failed: collections exceed sale total' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', row.id,
      'sale_date', row.sale_date,
      'crop', row.crop,
      'buyer_name', row.buyer_name,
      'total', row.total::text,
      'collected', row.collected::text,
      'remaining', row.remaining::text
    ) order by row.sale_date desc nulls last, row.id
  ), '[]'::jsonb)
  into v_rows
  from (
    select
      s.id,
      s.sale_date,
      s.crop,
      coalesce(b.name, 'عميل نقدي') as buyer_name,
      s.total,
      totals.collected,
      s.total - totals.collected as remaining
    from public.sales s
    left join public.buyers b on b.id = s.buyer_id and b.org_id = s.org_id
    left join lateral (
      select coalesce(sum(c.amount), 0) as collected
      from public.sale_collections c
      where c.sale_id = s.id and c.org_id = s.org_id
    ) totals on true
    where s.org_id = p_org
      and s.price_status = 'finalized'
      and s.payment_status <> 'collected'
      and s.payment_status not in ('historical_treasury', 'historical_reversed')
      and s.total is not null
      and s.total - totals.collected > 0
      and exists (
        select 1
        from public.journal_entries je
        where je.org_id = s.org_id
          and je.source_type = 'sale'
          and je.source_id = s.id
          and je.status = 'posted'
      )
    order by s.sale_date desc nulls last, s.id
    limit p_limit
  ) row;

  return v_rows;
end;
$$;
revoke execute on function public.fn_open_sale_receivables(uuid, integer) from public, anon, authenticated;
grant execute on function public.fn_open_sale_receivables(uuid, integer) to authenticated;

create or replace function public.fn_finalize_sale_price(p_sale uuid, p_unit_price numeric)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_qty numeric; v_status text; v_total numeric; v_ar uuid; v_rev uuid; v_journal uuid;
  v_sale_date date; v_delivery_date date; v_entry_date date;
begin
  if p_unit_price is null or p_unit_price <= 0 then raise exception 'unit_price must be positive' using errcode = '22023'; end if;
  select org_id, qty, price_status, sale_date, delivery_date
    into v_org, v_qty, v_status, v_sale_date, v_delivery_date
    from public.sales where id = p_sale for update;
  if v_org is null then raise exception 'sale % not found', p_sale using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org sale' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if v_status = 'finalized' then raise exception 'sale price already finalized' using errcode = '22023'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'set a positive qty before finalizing the price' using errcode = '22023'; end if;

  v_total := round(v_qty * p_unit_price, 2);
  if v_total <= 0 then
    raise exception 'rounded sale total must be positive' using errcode = '22023';
  end if;
  update public.sales
     set unit_price = p_unit_price, total = v_total, price_status = 'finalized', price_finalized_at = now()
   where id = p_sale;

  v_entry_date := coalesce(v_sale_date, v_delivery_date, current_date);
  v_ar  := public.fn_ensure_account(v_org, '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit');
  v_rev := public.fn_ensure_account(v_org, '4000', 'إيرادات المبيعات', 'revenue', 'credit');
  v_journal := public.fn_post_two_line_journal(
    v_org, v_entry_date, 'sale', p_sale, 'إثبات إيراد بيع عند تحديد السعر',
    v_ar, v_rev, v_total, 'ذمم مدينة على العميل', 'إيراد مبيعات', null, null, null, null);

  return jsonb_build_object(
    'id', p_sale,
    'total', v_total::text,
    'price_status', 'finalized',
    'journal_entry_id', v_journal
  );
end $$;
revoke execute on function public.fn_finalize_sale_price(uuid, numeric) from public, anon, authenticated;
grant execute on function public.fn_finalize_sale_price(uuid, numeric) to authenticated;

create or replace function public.fn_record_sale_collection(
  p_sale uuid, p_amount numeric, p_occurred_at date default null,
  p_collected_by text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_status text; v_total numeric; v_collected numeric; v_new_total numeric;
  v_cash uuid; v_ar uuid; v_id uuid; v_journal uuid; v_pay text; v_occurred_at date;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'collection amount must be positive' using errcode = '22023'; end if;
  select org_id, price_status, total into v_org, v_status, v_total from public.sales where id = p_sale for update;
  if v_org is null then raise exception 'sale % not found', p_sale using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org sale' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if v_status <> 'finalized' then raise exception 'cannot collect on a pending-price sale; finalize the price first' using errcode = '22023'; end if;

  if not exists (
    select 1 from public.journal_entries
     where org_id = v_org and source_type = 'sale' and source_id = p_sale and status = 'posted'
  ) then
    raise exception 'cannot collect: this sale has no posted revenue entry (was it reversed?)' using errcode = '22023';
  end if;

  select coalesce(sum(amount),0) into v_collected
    from public.sale_collections where sale_id = p_sale and org_id = v_org;
  v_new_total := v_collected + p_amount;
  if v_new_total > coalesce(v_total,0) then
    raise exception 'collection exceeds the outstanding receivable (total %, already collected %)', v_total, v_collected using errcode = '22023';
  end if;

  v_occurred_at := coalesce(p_occurred_at, (pg_catalog.now() at time zone 'Africa/Cairo')::date);

  insert into public.sale_collections(org_id, sale_id, amount, occurred_at, collected_by, note)
  values (v_org, p_sale, p_amount, v_occurred_at, nullif(trim(coalesce(p_collected_by,'')),''), nullif(trim(coalesce(p_note,'')),''))
  returning id into v_id;

  v_cash := public.fn_ensure_account(v_org, '1100', 'نقدية المبيعات', 'asset', 'debit');
  v_ar   := public.fn_ensure_account(v_org, '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit');
  v_journal := public.fn_post_two_line_journal(
    v_org, v_occurred_at, 'sale_collection', v_id, 'تحصيل من عميل',
    v_cash, v_ar, p_amount, 'نقدية محصّلة', 'سداد ذمم مدينة', null, null, null, null);
  update public.sale_collections set journal_entry_id = v_journal where id = v_id;

  v_pay := case when v_new_total >= coalesce(v_total,0) then 'collected'
                when v_new_total > 0 then 'partially_collected' else 'unpaid' end;
  update public.sales set payment_status = v_pay where id = p_sale;

  return jsonb_build_object(
    'id', v_id,
    'collected_total', v_new_total::text,
    'payment_status', v_pay,
    'journal_entry_id', v_journal
  );
end $$;
revoke execute on function public.fn_record_sale_collection(uuid, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.fn_record_sale_collection(uuid, numeric, date, text, text) to authenticated;

commit;

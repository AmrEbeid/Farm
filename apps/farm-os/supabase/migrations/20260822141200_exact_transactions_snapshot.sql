-- One exact, atomic read for the unified daily transactions ledger.
-- Counts cover the full visible ledger; rows remain bounded per source and money leaves PostgreSQL as text.

begin;

create index if not exists transactions_expenses_org_date_idx
  on public.expenses(org_id, date desc nulls last, id desc)
  where coalesce(payment_status, '') not in ('cancelled', 'historical_reversed');
create index if not exists transactions_sales_org_date_idx
  on public.sales(org_id, sale_date desc nulls last, id desc)
  where payment_status <> 'historical_reversed';
create index if not exists transactions_collections_org_date_idx
  on public.sale_collections(org_id, occurred_at desc nulls last, id desc);
create index if not exists transactions_custody_org_date_idx
  on public.custody_movements(org_id, occurred_at desc nulls last, id desc);

create or replace function public.fn_transactions_snapshot(
  p_org uuid,
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
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_row_limit is null or p_row_limit < 1 or p_row_limit > 400 then
    raise exception 'row limit must be between 1 and 400' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org transactions snapshot' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  with
  expense_rows as materialized (
    select
      e.id,
      e.date as event_date,
      e.category,
      e.description,
      e.total,
      e.supplier_id as party_id,
      s.name as party_name,
      s.org_id as party_org_id
    from public.expenses e
    left join public.suppliers s on s.id = e.supplier_id and s.org_id = p_org
    where e.org_id = p_org
      and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    order by e.date desc nulls last, e.id desc
    limit p_row_limit
  ),
  sale_rows as materialized (
    select
      s.id,
      s.sale_date as event_date,
      s.crop,
      s.qty,
      s.unit,
      s.total,
      s.price_status,
      s.buyer_id as party_id,
      b.name as party_name,
      b.org_id as party_org_id
    from public.sales s
    left join public.buyers b on b.id = s.buyer_id and b.org_id = p_org
    where s.org_id = p_org
      and s.payment_status <> 'historical_reversed'
    order by s.sale_date desc nulls last, s.id desc
    limit p_row_limit
  ),
  collection_rows as materialized (
    select c.id, c.occurred_at as event_date, c.amount, c.collected_by
    from public.sale_collections c
    where c.org_id = p_org
    order by c.occurred_at desc nulls last, c.id desc
    limit p_row_limit
  ),
  custody_rows as materialized (
    select
      cm.id,
      cm.occurred_at as event_date,
      cm.movement_type,
      cm.note,
      cm.amount_in,
      cm.amount_out,
      cm.custody_account_id as party_id,
      ca.holder_label as party_name,
      ca.org_id as party_org_id
    from public.custody_movements cm
    left join public.custody_accounts ca
      on ca.id = cm.custody_account_id and ca.org_id = p_org
    where cm.org_id = p_org
    order by cm.occurred_at desc nulls last, cm.id desc
    limit p_row_limit
  ),
  mismatch_count as materialized (
    select count(*)::integer as value
    from (
      select party_id, party_name, party_org_id from expense_rows
      union all
      select party_id, party_name, party_org_id from sale_rows
      union all
      select party_id, party_name, party_org_id from custody_rows
    ) parties
    where party_id is not null
      and (party_name is null or party_org_id is distinct from p_org)
  )
  select jsonb_build_object(
    'version', 'farm-os.transactions.v1',
    'org_id', p_org,
    'row_limit', p_row_limit,
    'party_mismatch_count', (select value from mismatch_count),
    'counts', jsonb_build_object(
      'expense', (select count(*) from public.expenses e where e.org_id = p_org
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')),
      'sale', (select count(*) from public.sales s where s.org_id = p_org
        and s.payment_status <> 'historical_reversed'),
      'collection', (select count(*) from public.sale_collections c where c.org_id = p_org),
      'custody', (select count(*) from public.custody_movements cm where cm.org_id = p_org),
      'pending_price', (select count(*) from public.sales s where s.org_id = p_org
        and s.price_status = 'pending' and s.payment_status <> 'historical_reversed')
    ),
    'rows',
      coalesce((select jsonb_agg(jsonb_build_object(
        'id', er.id,
        'type', 'expense',
        'event_date', er.event_date,
        'category', er.category,
        'description', er.description,
        'crop', null,
        'quantity', null,
        'unit', null,
        'pending_price', false,
        'party_id', er.party_id,
        'party_name', er.party_name,
        'amount', case when er.total is null then null else er.total::text end,
        'direction', 'out',
        'collected_by', null,
        'movement_type', null
      ) order by er.event_date desc nulls last, er.id desc) from expense_rows er), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object(
        'id', sr.id,
        'type', 'sale',
        'event_date', sr.event_date,
        'category', null,
        'description', null,
        'crop', sr.crop,
        'quantity', case when sr.qty is null then null else sr.qty::text end,
        'unit', sr.unit,
        'pending_price', sr.price_status = 'pending',
        'party_id', sr.party_id,
        'party_name', sr.party_name,
        'amount', case when sr.total is null then null else sr.total::text end,
        'direction', 'in',
        'collected_by', null,
        'movement_type', null
      ) order by sr.event_date desc nulls last, sr.id desc) from sale_rows sr), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object(
        'id', cr.id,
        'type', 'collection',
        'event_date', cr.event_date,
        'category', null,
        'description', null,
        'crop', null,
        'quantity', null,
        'unit', null,
        'pending_price', false,
        'party_id', null,
        'party_name', null,
        'amount', cr.amount::text,
        'direction', 'in',
        'collected_by', cr.collected_by,
        'movement_type', null
      ) order by cr.event_date desc nulls last, cr.id desc) from collection_rows cr), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object(
        'id', mr.id,
        'type', 'custody',
        'event_date', mr.event_date,
        'category', null,
        'description', mr.note,
        'crop', null,
        'quantity', null,
        'unit', null,
        'pending_price', false,
        'party_id', mr.party_id,
        'party_name', mr.party_name,
        'amount', case when mr.amount_in > 0 then mr.amount_in::text else mr.amount_out::text end,
        'direction', case when mr.amount_in > 0 then 'in' else 'out' end,
        'collected_by', null,
        'movement_type', mr.movement_type
      ) order by mr.event_date desc nulls last, mr.id desc) from custody_rows mr), '[]'::jsonb)
  ) into v_result;

  -- Never return even a partial payload when a source row points at a missing or foreign party.
  -- The joins above are organization-scoped, so foreign party attributes cannot enter v_result;
  -- this in-function gate then prevents the source's foreign party id from leaving PostgreSQL.
  if (v_result->>'party_mismatch_count')::integer <> 0 then
    raise exception 'transactions snapshot party mismatch' using errcode = '23514';
  end if;

  return v_result;
end;
$$;

revoke execute on function public.fn_transactions_snapshot(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.fn_transactions_snapshot(uuid, integer) to authenticated;

commit;

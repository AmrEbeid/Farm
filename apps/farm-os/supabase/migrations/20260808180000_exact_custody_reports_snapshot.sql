-- One exact, atomic read for the owner/accountant custody report pack.
-- Full totals are independent from bounded detail samples; every numeric amount leaves as text.

begin;

create index if not exists custody_reports_expenses_status_date_idx
  on public.expenses(org_id, payment_status, date, id)
  where payment_status in ('paid_from_custody', 'post_paid_unpaid');

create index if not exists custody_reports_fundings_org_date_idx
  on public.payment_request_fundings(org_id, occurred_at desc, id desc);

create or replace function public.fn_custody_reports_snapshot(
  p_org uuid,
  p_period_start date,
  p_period_end date,
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
  if p_org is null or p_period_start is null or p_period_end is null or p_as_of is null then
    raise exception 'organization and report dates are required' using errcode = '23502';
  end if;
  if p_period_start > p_period_end then
    raise exception 'period start must not be after period end' using errcode = '22007';
  end if;
  if p_period_end > (pg_catalog.now() at time zone 'Africa/Cairo')::date
     or p_as_of > (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'report dates cannot be in the future' using errcode = '22007';
  end if;
  if p_as_of is distinct from (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'obligations as-of date must be Cairo today because payment status has no historical ledger'
      using errcode = '22007';
  end if;
  if p_row_limit is null or p_row_limit < 1 or p_row_limit > 400 then
    raise exception 'row limit must be between 1 and 400' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody reports snapshot' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  with
  holder_rows as materialized (
    select
      a.id,
      a.holder_label,
      a.target_float,
      a.active,
      coalesce(sum(m.amount_in - m.amount_out) filter (where m.occurred_at < p_period_start), 0::numeric) as opening_balance,
      coalesce(sum(m.amount_in) filter (where m.occurred_at between p_period_start and p_period_end), 0::numeric) as amount_in,
      coalesce(sum(m.amount_out) filter (where m.occurred_at between p_period_start and p_period_end), 0::numeric) as amount_out,
      count(m.id) filter (where m.occurred_at between p_period_start and p_period_end)::integer as movement_count,
      coalesce(sum(m.amount_in - m.amount_out) filter (where m.occurred_at <= p_period_end), 0::numeric) as closing_balance
    from public.custody_accounts a
    left join public.custody_movements m
      on m.custody_account_id = a.id
     and m.org_id = p_org
     and m.occurred_at <= p_period_end
    where a.org_id = p_org
    group by a.id, a.holder_label, a.target_float, a.active
  ),
  holder_sample as materialized (
    select * from holder_rows
    order by holder_label, id
    limit p_row_limit
  ),
  movement_rows as materialized (
    select
      m.id,
      m.custody_account_id,
      a.holder_label,
      m.occurred_at,
      m.created_at,
      m.movement_type,
      m.amount_in,
      m.amount_out,
      m.amount_in - m.amount_out as net,
      m.expense_id,
      m.payment_request_id,
      m.transfer_group_id,
      m.note
    from public.custody_movements m
    join public.custody_accounts a
      on a.id = m.custody_account_id and a.org_id = p_org
    where m.org_id = p_org
      and m.occurred_at between p_period_start and p_period_end
  ),
  movement_sample as materialized (
    select * from movement_rows
    order by occurred_at desc, created_at desc, id desc
    limit p_row_limit
  ),
  cash_movement_rows as materialized (
    select distinct on (e.id)
      e.id,
      e.date as expense_date,
      e.category,
      e.description,
      e.total,
      coalesce(e.kind, 'operating') as kind,
      e.paid_by,
      m.id as movement_id,
      m.occurred_at as paid_at,
      m.custody_account_id,
      a.holder_label,
      m.payment_request_id
    from public.custody_movements m
    join public.expenses e
      on e.id = m.expense_id and e.org_id = p_org
    join public.custody_accounts a
      on a.id = m.custody_account_id and a.org_id = p_org
    where m.org_id = p_org
      and m.occurred_at between p_period_start and p_period_end
      and m.amount_out > 0
      and m.reversed_by is null
      and e.payment_status = 'paid_from_custody'
    order by e.id, m.occurred_at desc, m.created_at desc, m.id desc
  ),
  cash_rows as materialized (
    select * from cash_movement_rows
    union all
    select
      e.id,
      e.date as expense_date,
      e.category,
      e.description,
      e.total,
      coalesce(e.kind, 'operating') as kind,
      e.paid_by,
      null::uuid as movement_id,
      null::date as paid_at,
      null::uuid as custody_account_id,
      null::text as holder_label,
      null::uuid as payment_request_id
    from public.expenses e
    where e.org_id = p_org
      and e.payment_status = 'paid_from_custody'
      and e.date between p_period_start and p_period_end
      and not exists (
        select 1
        from public.custody_movements m
        where m.org_id = p_org
          and m.expense_id = e.id
          and m.amount_out > 0
          and m.reversed_by is null
      )
  ),
  cash_sample as materialized (
    select * from cash_rows
    order by coalesce(paid_at, expense_date) desc, id desc
    limit p_row_limit
  ),
  obligation_rows as materialized (
    select
      e.id,
      e.date as expense_date,
      e.category,
      e.description,
      e.total,
      coalesce(e.kind, 'operating') as kind,
      case when e.date is null then null else greatest(0, p_as_of - e.date) end as age_days,
      case
        when e.date is null then 'unknown'
        when greatest(0, p_as_of - e.date) >= 60 then '60+'
        when greatest(0, p_as_of - e.date) >= 30 then '30-59'
        else '0-29'
      end as aging_bucket,
      l.payment_request_id,
      r.request_no,
      r.status as request_status
    from public.expenses e
    left join lateral (
      select ll.payment_request_id
      from public.payment_request_lines ll
      where ll.expense_id = e.id and ll.org_id = p_org
      order by ll.id
      limit 1
    ) l on true
    left join public.payment_requests r
      on r.id = l.payment_request_id and r.org_id = p_org
    where e.org_id = p_org
      and e.payment_status = 'post_paid_unpaid'
      and (e.date is null or e.date <= p_as_of)
  ),
  obligation_sample as materialized (
    select * from obligation_rows
    order by (expense_date is not null), expense_date asc, id asc
    limit p_row_limit
  ),
  funding_requests as materialized (
    select distinct f.payment_request_id
    from public.payment_request_fundings f
    where f.org_id = p_org
      and f.occurred_at between p_period_start and p_period_end
  ),
  funding_totals as materialized (
    select fr.payment_request_id, public.fn_payment_request_totals(fr.payment_request_id) as value
    from funding_requests fr
  ),
  funding_rows as materialized (
    select
      f.id,
      f.payment_request_id,
      r.request_no,
      r.status as request_status,
      r.period_start as request_period_start,
      r.period_end as request_period_end,
      f.custody_account_id,
      a.holder_label,
      f.occurred_at,
      f.created_at,
      f.amount,
      f.note,
      case when r.approved_net_request is null then null else r.approved_net_request end as approved_net_request,
      (totals.value ->> 'gross_request')::numeric as gross_request,
      (totals.value ->> 'owner_funding_received')::numeric as owner_funding_received,
      (totals.value ->> 'remaining_to_fund')::numeric as remaining_to_fund
    from public.payment_request_fundings f
    join public.payment_requests r
      on r.id = f.payment_request_id and r.org_id = p_org
    join public.custody_accounts a
      on a.id = f.custody_account_id and a.org_id = p_org
    join funding_totals totals on totals.payment_request_id = f.payment_request_id
    where f.org_id = p_org
      and f.occurred_at between p_period_start and p_period_end
  ),
  funding_sample as materialized (
    select * from funding_rows
    order by occurred_at desc, created_at desc, id desc
    limit p_row_limit
  ),
  relationship_mismatch as materialized (
    select case when exists (
      select 1
      from (
      select m.id
      from public.custody_movements m
      left join public.custody_accounts a on a.id = m.custody_account_id
      left join public.expenses e on e.id = m.expense_id
      left join public.payment_requests r on r.id = m.payment_request_id
      left join public.journal_entries j on j.id = m.journal_entry_id
      left join public.custody_movements rb on rb.id = m.reversed_by
      left join public.custody_movements ro on ro.id = m.reversal_of
      where m.org_id = p_org
        and m.occurred_at <= p_period_end
        and (
          a.id is null or a.org_id is distinct from p_org
          or (m.expense_id is not null and (e.id is null or e.org_id is distinct from p_org))
          or (m.payment_request_id is not null and (r.id is null or r.org_id is distinct from p_org))
          or (m.journal_entry_id is not null and (j.id is null or j.org_id is distinct from p_org))
          or (m.reversed_by is not null and (rb.id is null or rb.org_id is distinct from p_org))
          or (m.reversal_of is not null and (ro.id is null or ro.org_id is distinct from p_org))
        )
      union all
      select l.id
      from public.payment_request_lines l
      join public.expenses e on e.id = l.expense_id
      left join public.payment_requests r on r.id = l.payment_request_id
      where e.org_id = p_org
        and e.payment_status = 'post_paid_unpaid'
        and (e.date is null or e.date <= p_as_of)
        and (
          l.org_id is distinct from p_org
          or r.id is null
          or r.org_id is distinct from p_org
        )
      union all
      select f.id
      from public.payment_request_fundings f
      left join public.payment_requests r on r.id = f.payment_request_id
      left join public.custody_accounts a on a.id = f.custody_account_id
      left join public.custody_movements m on m.id = f.custody_movement_id
      left join public.journal_entries j on j.id = f.journal_entry_id
      where f.org_id = p_org
        and f.occurred_at between p_period_start and p_period_end
        and (
          r.id is null or r.org_id is distinct from p_org
          or a.id is null or a.org_id is distinct from p_org
          or (f.custody_movement_id is not null and (m.id is null or m.org_id is distinct from p_org))
          or (f.journal_entry_id is not null and (j.id is null or j.org_id is distinct from p_org))
        )
      ) mismatch
    ) then 1 else 0 end::integer as value
  ),
  report_summary as materialized (
    select
      (select count(*)::integer from holder_rows) as holder_count,
      (select count(*)::integer from movement_rows) as movement_count,
      (select count(*)::integer from cash_rows) as cash_count,
      (select count(*)::integer from cash_rows where movement_id is null) as cash_missing_movement_count,
      (select count(*)::integer from cash_rows where total is null) as cash_unknown_total_count,
      (select count(*)::integer from obligation_rows) as obligation_count,
      (select count(*)::integer from obligation_rows where total is null) as obligation_unknown_total_count,
      (select count(*)::integer from obligation_rows where expense_date is null) as obligation_unknown_date_count,
      (select count(*)::integer from obligation_rows where age_days >= 30) as over_30_count,
      (select count(*)::integer from obligation_rows where age_days >= 30 and total is null) as over_30_unknown_total_count,
      (select count(*)::integer from funding_rows) as funding_count,
      coalesce((select sum(opening_balance) from holder_rows), 0::numeric) as opening_total,
      coalesce((select sum(amount_in) from holder_rows), 0::numeric) as period_in,
      coalesce((select sum(amount_out) from holder_rows), 0::numeric) as period_out,
      coalesce((select sum(closing_balance) from holder_rows), 0::numeric) as closing_total,
      coalesce((select sum(total) from cash_rows), 0::numeric) as cash_total,
      coalesce((select sum(total) from obligation_rows), 0::numeric) as obligation_total,
      coalesce((select sum(total) from obligation_rows where age_days >= 30), 0::numeric) as over_30_total,
      coalesce((select sum(amount) from funding_rows), 0::numeric) as funding_total
  )
  select jsonb_build_object(
    'version', 'farm-os.custody-reports.v1',
    'org_id', p_org,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'as_of', p_as_of,
    'row_limit', p_row_limit,
    'relationship_mismatch_count', (select value from relationship_mismatch),
    'summary', jsonb_build_object(
      'holder_count', s.holder_count,
      'movement_count', s.movement_count,
      'cash_count', s.cash_count,
      'cash_missing_movement_count', s.cash_missing_movement_count,
      'cash_unknown_total_count', s.cash_unknown_total_count,
      'obligation_count', s.obligation_count,
      'obligation_unknown_total_count', s.obligation_unknown_total_count,
      'obligation_unknown_date_count', s.obligation_unknown_date_count,
      'over_30_count', s.over_30_count,
      'over_30_unknown_total_count', s.over_30_unknown_total_count,
      'funding_count', s.funding_count,
      'opening_total', s.opening_total::text,
      'period_in', s.period_in::text,
      'period_out', s.period_out::text,
      'closing_total', s.closing_total::text,
      'cash_total', s.cash_total::text,
      'obligation_total', s.obligation_total::text,
      'over_30_total', s.over_30_total::text,
      'funding_total', s.funding_total::text
    ),
    'holders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id,
      'holder_label', h.holder_label,
      'target_float', h.target_float::text,
      'active', h.active,
      'opening_balance', h.opening_balance::text,
      'amount_in', h.amount_in::text,
      'amount_out', h.amount_out::text,
      'closing_balance', h.closing_balance::text,
      'movement_count', h.movement_count
    ) order by h.holder_label, h.id) from holder_sample h), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'custody_account_id', m.custody_account_id,
      'holder_label', m.holder_label,
      'occurred_at', m.occurred_at,
      'movement_type', m.movement_type,
      'amount_in', m.amount_in::text,
      'amount_out', m.amount_out::text,
      'net', m.net::text,
      'expense_id', m.expense_id,
      'payment_request_id', m.payment_request_id,
      'transfer_group_id', m.transfer_group_id,
      'note', m.note
    ) order by m.occurred_at desc, m.created_at desc, m.id desc) from movement_sample m), '[]'::jsonb),
    'cash_expenses', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'expense_date', c.expense_date,
      'category', c.category,
      'description', c.description,
      'total', case when c.total is null then null else c.total::text end,
      'kind', c.kind,
      'paid_by', c.paid_by,
      'movement_id', c.movement_id,
      'paid_at', c.paid_at,
      'holder_label', c.holder_label,
      'payment_request_id', c.payment_request_id,
      'missing_movement', c.movement_id is null
    ) order by coalesce(c.paid_at, c.expense_date) desc, c.id desc) from cash_sample c), '[]'::jsonb),
    'obligations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'expense_date', o.expense_date,
      'category', o.category,
      'description', o.description,
      'total', case when o.total is null then null else o.total::text end,
      'kind', o.kind,
      'age_days', o.age_days,
      'aging_bucket', o.aging_bucket,
      'payment_request_id', o.payment_request_id,
      'request_no', o.request_no,
      'request_status', o.request_status
    ) order by (o.expense_date is not null), o.expense_date asc, o.id asc) from obligation_sample o), '[]'::jsonb),
    'fundings', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'payment_request_id', f.payment_request_id,
      'request_no', f.request_no,
      'request_status', f.request_status,
      'request_period_start', f.request_period_start,
      'request_period_end', f.request_period_end,
      'holder_label', f.holder_label,
      'occurred_at', f.occurred_at,
      'amount', f.amount::text,
      'note', f.note,
      'approved_net_request', case when f.approved_net_request is null then null else f.approved_net_request::text end,
      'gross_request', f.gross_request::text,
      'owner_funding_received', f.owner_funding_received::text,
      'remaining_to_fund', f.remaining_to_fund::text
    ) order by f.occurred_at desc, f.created_at desc, f.id desc) from funding_sample f), '[]'::jsonb)
  ) into v_result
  from report_summary s;

  if (v_result->>'relationship_mismatch_count')::integer <> 0 then
    raise exception 'custody reports relationship mismatch' using errcode = '23514';
  end if;

  return v_result;
end;
$$;

revoke execute on function public.fn_custody_reports_snapshot(uuid, date, date, date, integer)
  from public, anon, authenticated;
grant execute on function public.fn_custody_reports_snapshot(uuid, date, date, date, integer)
  to authenticated;

commit;

-- One exact, atomic read for the daily custody and payment-request workspace.
-- Counts cover the full organization while detail remains bounded; all money crosses JSON as text.

begin;

create or replace function public.fn_custody_daily_snapshot(
  p_org uuid,
  p_request_filter text,
  p_month_start date,
  p_month_end date,
  p_movement_limit integer default 15,
  p_request_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or p_month_start is null or p_month_end is null then
    raise exception 'organization and month bounds are required' using errcode = '23502';
  end if;
  if p_request_filter is null or p_request_filter not in ('all', 'awaiting', 'settled') then
    raise exception 'request filter must be all, awaiting, or settled' using errcode = '22023';
  end if;
  if p_month_end <= p_month_start then
    raise exception 'month end must be after month start' using errcode = '22023';
  end if;
  if p_movement_limit is null or p_movement_limit < 1 or p_movement_limit > 50 then
    raise exception 'movement limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_request_limit is null or p_request_limit < 1 or p_request_limit > 500 then
    raise exception 'request limit must be between 1 and 500' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody daily snapshot' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.custody_movements m
      left join public.custody_accounts a
        on a.id = m.custody_account_id and a.org_id = p_org
     where m.org_id = p_org and a.id is null
  ) then
    raise exception 'custody daily snapshot movement organization mismatch' using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.payment_requests r
      left join public.custody_accounts a
        on a.id = r.custody_account_id and a.org_id = p_org
     where r.org_id = p_org
       and r.custody_account_id is not null
       and a.id is null
  ) then
    raise exception 'custody daily snapshot request organization mismatch' using errcode = '23514';
  end if;

  return (
    with
    account_balances as materialized (
      select
        a.id,
        a.holder_label,
        a.holder_user_id,
        a.target_float,
        a.active,
        coalesce(sum(m.amount_in - m.amount_out), 0) as closing_balance
      from public.custody_accounts a
      left join public.custody_movements m
        on m.org_id = p_org and m.custody_account_id = a.id
      where a.org_id = p_org
      group by a.id, a.holder_label, a.holder_user_id, a.target_float, a.active
    ),
    movement_rows as materialized (
      select m.id, m.occurred_at, m.created_at, m.movement_type, m.amount_in, m.amount_out,
             m.custody_account_id, a.holder_label, m.reversal_of, m.reversed_by
        from public.custody_movements m
        join public.custody_accounts a
          on a.id = m.custody_account_id and a.org_id = p_org
       where m.org_id = p_org
       order by m.occurred_at desc nulls last, m.created_at desc, m.id desc
       limit p_movement_limit
    ),
    request_rows as materialized (
      select r.id, r.request_no, r.status, r.period_start, r.period_end, r.created_at
        from public.payment_requests r
       where r.org_id = p_org
         and (
           p_request_filter = 'all'
           or (p_request_filter = 'awaiting' and r.status in ('submitted', 'approved_operational', 'approved_final'))
           or (p_request_filter = 'settled' and r.status in ('paid', 'closed'))
         )
       order by r.created_at desc nulls last, r.id desc
       limit p_request_limit
    ),
    counts as (
      select
        (select count(*) from public.custody_movements m where m.org_id = p_org) as movement_count,
        count(*) as all_request_count,
        count(*) filter (where r.status in ('submitted', 'approved_operational', 'approved_final')) as awaiting_request_count,
        count(*) filter (where r.status in ('paid', 'closed')) as settled_request_count,
        count(*) filter (
          where p_request_filter = 'all'
             or (p_request_filter = 'awaiting' and r.status in ('submitted', 'approved_operational', 'approved_final'))
             or (p_request_filter = 'settled' and r.status in ('paid', 'closed'))
        ) as selected_request_count
      from public.payment_requests r
      where r.org_id = p_org
    )
    select jsonb_build_object(
      'version', 'farm-os.custody-daily.v1',
      'org_id', p_org,
      'request_filter', p_request_filter,
      'movement_limit', p_movement_limit,
      'request_limit', p_request_limit,
      'movement_count', counts.movement_count,
      'all_request_count', counts.all_request_count,
      'awaiting_request_count', counts.awaiting_request_count,
      'settled_request_count', counts.settled_request_count,
      'selected_request_count', counts.selected_request_count,
      'accounts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'holder_label', a.holder_label,
          'holder_user_id', a.holder_user_id,
          'target_float', a.target_float::text,
          'active', a.active,
          'closing_balance', a.closing_balance::text
        ) order by a.holder_label, a.id)
        from account_balances a
      ), '[]'::jsonb),
      'movements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id,
          'occurred_at', m.occurred_at::text,
          'movement_type', m.movement_type,
          'amount_in', m.amount_in::text,
          'amount_out', m.amount_out::text,
          'custody_account_id', m.custody_account_id,
          'holder_label', m.holder_label,
          'reversal_of', m.reversal_of,
          'reversed_by', m.reversed_by
        ) order by m.occurred_at desc nulls last, m.created_at desc, m.id desc)
        from movement_rows m
      ), '[]'::jsonb),
      'requests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'request_no', r.request_no,
          'status', r.status,
          'period_start', case when r.period_start is null then null else r.period_start::text end,
          'period_end', case when r.period_end is null then null else r.period_end::text end,
          'created_at', r.created_at
        ) order by r.created_at desc nulls last, r.id desc)
        from request_rows r
      ), '[]'::jsonb),
      'expense_summary', public.fn_expense_register_summary(p_org, p_month_start, p_month_end)
    )
    from counts
  );
end;
$$;

revoke execute on function public.fn_custody_daily_snapshot(uuid,text,date,date,integer,integer)
  from public, anon, authenticated;
grant execute on function public.fn_custody_daily_snapshot(uuid,text,date,date,integer,integer)
  to authenticated;

commit;

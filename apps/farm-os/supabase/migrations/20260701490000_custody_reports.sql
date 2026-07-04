-- Farm OS — SPEC-0018-EXT slices 3/4: custody and payment-request reports.
--
-- PROBLEM. The custody workflow is now auditable, but the accountant still lacks period reports for opening
-- balances by holder, custody-paid expenses, unpaid obligations, and owner funding/replenishment.
--
-- INTENT. Add finance.read-gated read RPCs that report over the existing custody/payment-request tables only.
-- No posting, request lifecycle, payment routing, journal, or permission semantics change in this slice.
--
-- SECURITY. All functions are SECURITY DEFINER with search_path='', validate p_org against the current user,
-- require finance.read, and expose no anonymous EXECUTE. They return derived JSON so the app can render/export
-- reports without direct ad-hoc joins in the browser.
--
-- ROLLBACK. Drop the four fn_*_report functions. No persisted business data is changed by this migration.

begin;

create or replace function public.fn_custody_ledger_report(
  p_org uuid,
  p_period_start date default null,
  p_period_end date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_end date := coalesce(p_period_end, current_date);
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if v_start > v_end then
    raise exception 'period_start must be on or before period_end' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody report' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  return (
    with account_totals as (
      select
        a.id as custody_account_id,
        a.holder_label,
        a.target_float,
        a.active,
        coalesce(sum(m.amount_in - m.amount_out) filter (where m.occurred_at < v_start), 0) as opening_balance,
        coalesce(sum(m.amount_in) filter (where m.occurred_at between v_start and v_end), 0) as amount_in,
        coalesce(sum(m.amount_out) filter (where m.occurred_at between v_start and v_end), 0) as amount_out,
        coalesce(count(m.id) filter (where m.occurred_at between v_start and v_end), 0) as movements_count,
        coalesce(sum(m.amount_in - m.amount_out) filter (where m.occurred_at <= v_end), 0) as closing_balance
      from public.custody_accounts a
      left join public.custody_movements m
        on m.custody_account_id = a.id
       and m.org_id = a.org_id
      where a.org_id = p_org
      group by a.id, a.holder_label, a.target_float, a.active
    ),
    movements as (
      select
        m.id,
        m.custody_account_id,
        a.holder_label,
        m.occurred_at,
        m.movement_type,
        m.amount_in,
        m.amount_out,
        m.amount_in - m.amount_out as net,
        m.expense_id,
        m.payment_request_id,
        m.journal_entry_id,
        m.transfer_group_id,
        m.note
      from public.custody_movements m
      join public.custody_accounts a on a.id = m.custody_account_id
      where m.org_id = p_org
        and m.occurred_at between v_start and v_end
      order by m.occurred_at desc, m.created_at desc, m.id
    )
    select jsonb_build_object(
      'period_start', v_start,
      'period_end', v_end,
      'holders', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'custody_account_id', custody_account_id,
            'holder_label', holder_label,
            'target_float', target_float,
            'active', active,
            'opening_balance', opening_balance,
            'amount_in', amount_in,
            'amount_out', amount_out,
            'closing_balance', closing_balance,
            'movements_count', movements_count
          )
          order by holder_label
        )
        from account_totals
      ), '[]'::jsonb),
      'movements', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'custody_account_id', custody_account_id,
            'holder_label', holder_label,
            'occurred_at', occurred_at,
            'movement_type', movement_type,
            'amount_in', amount_in,
            'amount_out', amount_out,
            'net', net,
            'expense_id', expense_id,
            'payment_request_id', payment_request_id,
            'journal_entry_id', journal_entry_id,
            'transfer_group_id', transfer_group_id,
            'note', note
          )
          order by occurred_at desc, id
        )
        from movements
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.fn_custody_ledger_report(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_custody_ledger_report(uuid, date, date) to authenticated;

create or replace function public.fn_custody_cash_expense_report(
  p_org uuid,
  p_period_start date default null,
  p_period_end date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_end date := coalesce(p_period_end, current_date);
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if v_start > v_end then
    raise exception 'period_start must be on or before period_end' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org cash expense report' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  return (
    with rows as (
      select
        e.id as expense_id,
        e.date as expense_date,
        e.category,
        e.description,
        e.total,
        coalesce(e.kind, 'operating') as kind,
        e.paid_by,
        m.id as custody_movement_id,
        m.occurred_at as paid_at,
        m.custody_account_id,
        a.holder_label,
        m.payment_request_id,
        m.journal_entry_id
      from public.expenses e
      left join lateral (
        select mm.*
        from public.custody_movements mm
        where mm.org_id = e.org_id
          and mm.expense_id = e.id
          and mm.amount_out > 0
        order by mm.occurred_at desc, mm.created_at desc, mm.id
        limit 1
      ) m on true
      left join public.custody_accounts a on a.id = m.custody_account_id
      where e.org_id = p_org
        and e.payment_status = 'paid_from_custody'
        and coalesce(m.occurred_at, e.date) between v_start and v_end
      order by coalesce(m.occurred_at, e.date) desc, e.id
    )
    select jsonb_build_object(
      'period_start', v_start,
      'period_end', v_end,
      'total_amount', coalesce((select sum(total) from rows), 0),
      'missing_movement_count', coalesce((select count(*) from rows where custody_movement_id is null), 0),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'expense_id', expense_id,
            'expense_date', expense_date,
            'category', category,
            'description', description,
            'total', total,
            'kind', kind,
            'paid_by', paid_by,
            'custody_movement_id', custody_movement_id,
            'paid_at', paid_at,
            'custody_account_id', custody_account_id,
            'holder_label', holder_label,
            'payment_request_id', payment_request_id,
            'journal_entry_id', journal_entry_id,
            'missing_movement', custody_movement_id is null
          )
          order by coalesce(paid_at, expense_date) desc, expense_id
        )
        from rows
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.fn_custody_cash_expense_report(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_custody_cash_expense_report(uuid, date, date) to authenticated;

create or replace function public.fn_unpaid_obligations_report(
  p_org uuid,
  p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org obligations report' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  return (
    with rows as (
      select
        e.id as expense_id,
        e.date as expense_date,
        e.category,
        e.description,
        e.total,
        coalesce(e.kind, 'operating') as kind,
        greatest(0, v_as_of - e.date) as age_days,
        case
          when greatest(0, v_as_of - e.date) >= 60 then '60+'
          when greatest(0, v_as_of - e.date) >= 30 then '30-59'
          else '0-29'
        end as aging_bucket,
        l.payment_request_id,
        r.request_no,
        r.status as request_status
      from public.expenses e
      left join public.payment_request_lines l on l.expense_id = e.id
      left join public.payment_requests r on r.id = l.payment_request_id
      where e.org_id = p_org
        and e.payment_status = 'post_paid_unpaid'
      order by e.date asc, e.id
    )
    select jsonb_build_object(
      'as_of', v_as_of,
      'total_amount', coalesce((select sum(total) from rows), 0),
      'over_30_amount', coalesce((select sum(total) from rows where age_days >= 30), 0),
      'over_30_count', coalesce((select count(*) from rows where age_days >= 30), 0),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'expense_id', expense_id,
            'expense_date', expense_date,
            'category', category,
            'description', description,
            'total', total,
            'kind', kind,
            'age_days', age_days,
            'aging_bucket', aging_bucket,
            'payment_request_id', payment_request_id,
            'request_no', request_no,
            'request_status', request_status
          )
          order by expense_date asc, expense_id
        )
        from rows
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.fn_unpaid_obligations_report(uuid, date) from public, anon, authenticated;
grant execute on function public.fn_unpaid_obligations_report(uuid, date) to authenticated;

create or replace function public.fn_owner_funding_report(
  p_org uuid,
  p_period_start date default null,
  p_period_end date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_end date := coalesce(p_period_end, current_date);
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if v_start > v_end then
    raise exception 'period_start must be on or before period_end' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org funding report' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  return (
    with rows as (
      select
        f.id as funding_id,
        f.payment_request_id,
        r.request_no,
        r.status as request_status,
        r.period_start as request_period_start,
        r.period_end as request_period_end,
        f.custody_account_id,
        a.holder_label,
        f.occurred_at,
        f.amount,
        f.custody_movement_id,
        f.journal_entry_id,
        f.note,
        (totals.value ->> 'approved_net_request')::numeric as approved_net_request,
        (totals.value ->> 'owner_funding_received')::numeric as owner_funding_received,
        (totals.value ->> 'remaining_to_fund')::numeric as remaining_to_fund
      from public.payment_request_fundings f
      join public.payment_requests r on r.id = f.payment_request_id
      join public.custody_accounts a on a.id = f.custody_account_id
      cross join lateral (select public.fn_payment_request_totals(f.payment_request_id) as value) totals
      where f.org_id = p_org
        and f.occurred_at between v_start and v_end
      order by f.occurred_at desc, f.created_at desc, f.id
    )
    select jsonb_build_object(
      'period_start', v_start,
      'period_end', v_end,
      'total_funding', coalesce((select sum(amount) from rows), 0),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'funding_id', funding_id,
            'payment_request_id', payment_request_id,
            'request_no', request_no,
            'request_status', request_status,
            'request_period_start', request_period_start,
            'request_period_end', request_period_end,
            'custody_account_id', custody_account_id,
            'holder_label', holder_label,
            'occurred_at', occurred_at,
            'amount', amount,
            'custody_movement_id', custody_movement_id,
            'journal_entry_id', journal_entry_id,
            'note', note,
            'approved_net_request', approved_net_request,
            'owner_funding_received', owner_funding_received,
            'remaining_to_fund', remaining_to_fund
          )
          order by occurred_at desc, funding_id
        )
        from rows
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke execute on function public.fn_owner_funding_report(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_owner_funding_report(uuid, date, date) to authenticated;

commit;

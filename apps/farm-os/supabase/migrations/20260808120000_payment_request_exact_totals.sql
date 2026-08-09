-- Keep signed payment-request amounts exact across the PostgREST JSON boundary.
-- JSON numeric values become JavaScript doubles; JSON strings preserve PostgreSQL numeric digits.
begin;

create or replace function public.fn_payment_request_totals(p_request uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_acct uuid;
  v_status text;
  v_approved_post_paid numeric;
  v_approved_topup numeric;
  v_approved_net numeric;
  v_operating numeric;
  v_capex numeric;
  v_drawing numeric;
  v_unpaid numeric;
  v_target numeric;
  v_current numeric;
  v_topup numeric;
  v_funding numeric;
  v_cash_out numeric;
  v_gross numeric;
  v_snapshot numeric;
  v_remaining numeric;
begin
  select org_id, custody_account_id, status, approved_post_paid_total, approved_custody_top_up, approved_net_request
    into v_org, v_acct, v_status, v_approved_post_paid, v_approved_topup, v_approved_net
    from public.payment_requests
   where id = p_request;
  if v_org is null then raise exception 'payment request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org request' using errcode='42501'; end if;
  if not public.authorize('finance.read', v_org) then
    raise exception 'forbidden: finance.read is required' using errcode='42501'; end if;

  if v_acct is not null and not exists (
    select 1 from public.custody_accounts a where a.id = v_acct and a.org_id = v_org
  ) then
    raise exception 'forbidden: cross-org request custody account' using errcode='42501';
  end if;
  if exists (
    select 1
    from public.payment_request_lines l
    left join public.expenses e on e.id = l.expense_id
    left join public.custody_movements m on m.id = l.custody_movement_id
    where l.payment_request_id = p_request
      and (
        l.org_id is distinct from v_org
        or e.id is null
        or e.org_id is distinct from v_org
        or (
          l.custody_movement_id is not null
          and (m.id is null or m.org_id is distinct from v_org)
        )
      )
  ) then
    raise exception 'forbidden: cross-org payment request line' using errcode='42501';
  end if;
  if exists (
    select 1
    from public.payment_request_fundings f
    left join public.custody_accounts a on a.id = f.custody_account_id
    left join public.custody_movements m on m.id = f.custody_movement_id
    where f.payment_request_id = p_request
      and (
        f.org_id is distinct from v_org
        or a.id is null
        or a.org_id is distinct from v_org
        or (
          f.custody_movement_id is not null
          and (m.id is null or m.org_id is distinct from v_org)
        )
      )
  ) then
    raise exception 'forbidden: cross-org payment request funding' using errcode='42501';
  end if;

  select
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'operating'), 0),
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'capex'), 0),
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'drawing'), 0)
  into v_operating, v_capex, v_drawing
  from public.payment_request_lines l
  join public.expenses e on e.id = l.expense_id and e.org_id = v_org
  where l.payment_request_id = p_request
    and l.org_id = v_org;

  v_unpaid := coalesce(v_operating,0) + coalesce(v_capex,0) + coalesce(v_drawing,0);

  if v_acct is null then
    v_target := 0;
    v_current := 0;
  else
    select coalesce(target_float,0) into v_target
      from public.custody_accounts
     where id = v_acct and org_id = v_org;
    v_current := coalesce(public.fn_custody_balance(v_acct), 0);
  end if;
  v_topup := greatest(0, coalesce(v_target,0) - v_current);
  v_gross := v_unpaid + v_topup;

  select coalesce(sum(amount),0) into v_funding
    from public.payment_request_fundings
   where payment_request_id = p_request
     and org_id = v_org;
  select coalesce(sum(m.amount_out),0) into v_cash_out
    from public.payment_request_lines l
    join public.custody_movements m on m.id = l.custody_movement_id and m.org_id = v_org
   where l.payment_request_id = p_request
     and l.org_id = v_org;

  v_snapshot := coalesce(v_approved_net, v_gross);
  v_remaining := greatest(0, v_snapshot - coalesce(v_funding,0));

  return jsonb_build_object(
    'operating_unpaid', coalesce(v_operating,0)::text,
    'capex_unpaid', coalesce(v_capex,0)::text,
    'drawing_unpaid', coalesce(v_drawing,0)::text,
    'post_paid_unpaid', v_unpaid::text,
    'target_float', coalesce(v_target,0)::text,
    'current_custody', v_current::text,
    'custody_top_up', v_topup::text,
    'gross_request', v_gross::text,
    'approved_post_paid_total', coalesce(v_approved_post_paid,0)::text,
    'approved_custody_top_up', coalesce(v_approved_topup,0)::text,
    'approved_net_request', coalesce(v_approved_net,0)::text,
    'owner_funding_received', coalesce(v_funding,0)::text,
    'request_cash_out', coalesce(v_cash_out,0)::text,
    'remaining_to_fund', v_remaining::text,
    'net_request', v_remaining::text);
end;
$$;

revoke execute on function public.fn_payment_request_totals(uuid) from public, anon, authenticated;
grant execute on function public.fn_payment_request_totals(uuid) to authenticated;

commit;

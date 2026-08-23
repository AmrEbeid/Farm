-- A payment request cannot confirm payouts or close while approved funding remains outstanding.
begin;

create or replace function public.fn_payment_request_remaining_to_fund_guard(p_request uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_approved numeric;
  v_funding numeric;
begin
  select r.org_id, r.approved_net_request
    into v_org, v_approved
    from public.payment_requests r
   where r.id = p_request
   for update;

  if not found then
    raise exception 'payment request % not found', p_request using errcode = 'P0002';
  end if;
  if v_approved is null then
    raise exception 'payment request % has no approved funding total', p_request using errcode = '22023';
  end if;

  select coalesce(sum(f.amount), 0)
    into v_funding
    from public.payment_request_fundings f
   where f.payment_request_id = p_request
     and f.org_id = v_org;

  return greatest(0, v_approved - v_funding);
end;
$$;

revoke execute on function public.fn_payment_request_remaining_to_fund_guard(uuid)
  from public, anon, authenticated;

create or replace function public.fn_guard_payment_request_line_fully_funded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining numeric;
begin
  if old.paid_at is null and new.paid_at is not null then
    v_remaining := public.fn_payment_request_remaining_to_fund_guard(new.payment_request_id);
    if v_remaining > 0 then
      raise exception 'cannot confirm request payment while % remains unfunded', v_remaining
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_guard_payment_request_line_fully_funded() from public, anon, authenticated;

drop trigger if exists payment_request_line_requires_full_funding on public.payment_request_lines;
create trigger payment_request_line_requires_full_funding
before update of paid_at on public.payment_request_lines
for each row execute function public.fn_guard_payment_request_line_fully_funded();

create or replace function public.fn_guard_payment_request_close_fully_funded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining numeric;
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    v_remaining := public.fn_payment_request_remaining_to_fund_guard(new.id);
    if v_remaining > 0 then
      raise exception 'cannot close request while % remains unfunded', v_remaining
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_guard_payment_request_close_fully_funded() from public, anon, authenticated;

drop trigger if exists payment_request_close_requires_full_funding on public.payment_requests;
create trigger payment_request_close_requires_full_funding
before update of status on public.payment_requests
for each row execute function public.fn_guard_payment_request_close_fully_funded();

-- Keep one atomic detail RPC while extending funding rows with their accounting evidence.
do $$
begin
  if to_regprocedure(
    'public.fn_payment_request_detail_snapshot_base_r4g(uuid,uuid,integer)'
  ) is null then
    alter function public.fn_payment_request_detail_snapshot(uuid, uuid, integer)
      rename to fn_payment_request_detail_snapshot_base_r4g;
  end if;
end;
$$;
revoke execute on function public.fn_payment_request_detail_snapshot_base_r4g(uuid, uuid, integer)
  from public, anon, authenticated;

create or replace function public.fn_payment_request_detail_snapshot(
  p_org uuid,
  p_request uuid,
  p_available_limit integer default 150
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_fundings jsonb;
begin
  v_snapshot := public.fn_payment_request_detail_snapshot_base_r4g(
    p_org, p_request, p_available_limit
  );
  if v_snapshot -> 'request' = 'null'::jsonb then
    return v_snapshot;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'occurred_at', f.occurred_at::text,
    'amount', f.amount::text,
    'custody_account_id', f.custody_account_id,
    'custody_movement_id', f.custody_movement_id,
    'journal_entry_id', f.journal_entry_id,
    'note', f.note
  ) order by f.occurred_at desc, f.created_at desc, f.id desc), '[]'::jsonb)
    into v_fundings
    from public.payment_request_fundings f
   where f.payment_request_id = p_request
     and f.org_id = p_org;

  return jsonb_set(v_snapshot, '{fundings}', v_fundings, true);
end;
$$;

revoke execute on function public.fn_payment_request_detail_snapshot(uuid, uuid, integer)
  from public, anon;
grant execute on function public.fn_payment_request_detail_snapshot(uuid, uuid, integer)
  to authenticated;

commit;

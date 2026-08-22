-- Atomic, exact custody-dashboard read contract.
-- Account metadata and derived balances share one database snapshot; numeric values are emitted as
-- decimal text so JSON transport cannot round accounting amounts before application validation.

begin;

create or replace function public.fn_custody_dashboard_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody dashboard' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  return (
    with account_balances as (
      select
        account.id,
        account.holder_label,
        account.holder_user_id,
        account.target_float,
        account.active,
        coalesce(sum(movement.amount_in - movement.amount_out), 0) as closing_balance
      from public.custody_accounts account
      left join public.custody_movements movement
        on movement.org_id = account.org_id
       and movement.custody_account_id = account.id
      where account.org_id = p_org
      group by account.id, account.holder_label, account.holder_user_id,
               account.target_float, account.active
    )
    select jsonb_build_object(
      'version', 'farm-os.custody-dashboard.v1',
      'accounts', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'holder_label', holder_label,
            'holder_user_id', holder_user_id,
            'target_float', target_float::text,
            'active', active,
            'closing_balance', closing_balance::text
          ) order by holder_label, id
        )
        from account_balances
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.fn_custody_dashboard_summary(uuid) from public, anon, authenticated;
grant execute on function public.fn_custody_dashboard_summary(uuid) to authenticated;

commit;

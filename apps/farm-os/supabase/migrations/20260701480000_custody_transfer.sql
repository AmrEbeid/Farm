-- Farm OS — SPEC-0018-EXT slice 1: atomic custody holder transfer.
--
-- PROBLEM. The Owner's custody flow allows the farm manager to hand part/all of the standing float to the
-- accountant. Before this slice, that required two unrelated custody movements, with no atomicity or matched
-- amount guarantee.
--
-- INTENT. Add one RPC, fn_transfer_custody, that records a holder-to-holder transfer as a linked out/in pair
-- in custody_movements. This changes only the cash-holder location; it does not create a journal entry, does
-- not hit P&L, and does not widen farm-manager finance access.
--
-- SECURITY. Existing custody.write gate only (owner/accountant). RLS/FORCE posture is unchanged; direct DML
-- remains revoked. The transfer is audited by the existing custody_movements audit trigger.
--
-- ROLLBACK. Drop fn_transfer_custody, drop transfer_group_id/index. Existing transfer rows would remain normal
-- custody movements if rollback is needed.

begin;

alter table public.custody_movements
  add column if not exists transfer_group_id uuid;

create index if not exists custody_movements_transfer_group_idx
  on public.custody_movements(transfer_group_id)
  where transfer_group_id is not null;

create or replace function public.fn_transfer_custody(
  p_from_account uuid,
  p_to_account uuid,
  p_amount numeric,
  p_occurred_at date default current_date,
  p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_locked record;
  v_from_org uuid;
  v_to_org uuid;
  v_from_active boolean;
  v_to_active boolean;
  v_balance numeric;
  v_group uuid := gen_random_uuid();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_from_account is null or p_to_account is null then
    raise exception 'from and to custody accounts are required' using errcode = '23502';
  end if;
  if p_from_account = p_to_account then
    raise exception 'from and to custody accounts must be different' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'transfer amount must be positive' using errcode = '22023';
  end if;

  -- Lock both accounts in deterministic order so concurrent transfers cannot double-spend the same float.
  for v_locked in
    select id, org_id, active
      from public.custody_accounts
     where id in (p_from_account, p_to_account)
     order by id
     for update
  loop
    if v_locked.id = p_from_account then
      v_from_org := v_locked.org_id;
      v_from_active := v_locked.active;
    elsif v_locked.id = p_to_account then
      v_to_org := v_locked.org_id;
      v_to_active := v_locked.active;
    end if;
  end loop;

  if v_from_org is null then
    raise exception 'source custody account % not found', p_from_account using errcode = 'P0002';
  end if;
  if v_to_org is null then
    raise exception 'destination custody account % not found', p_to_account using errcode = 'P0002';
  end if;
  if v_from_org is distinct from v_to_org then
    raise exception 'forbidden: custody transfer must stay inside one org' using errcode = '42501';
  end if;
  if not coalesce(v_from_active, false) or not coalesce(v_to_active, false) then
    raise exception 'custody transfer requires active source and destination accounts' using errcode = '22023';
  end if;
  if v_from_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody transfer' using errcode = '42501';
  end if;
  if not public.authorize('custody.write', v_from_org) then
    raise exception 'forbidden: custody.write is required' using errcode = '42501';
  end if;

  select coalesce(sum(amount_in), 0) - coalesce(sum(amount_out), 0)
    into v_balance
    from public.custody_movements
   where org_id = v_from_org
     and custody_account_id = p_from_account;

  if coalesce(v_balance, 0) < p_amount then
    raise exception 'insufficient custody balance: available %, requested %', coalesce(v_balance, 0), p_amount
      using errcode = '22023';
  end if;

  insert into public.custody_movements(
    org_id, custody_account_id, occurred_at, movement_type,
    amount_in, amount_out, expense_id, note, transfer_group_id)
  values
    (v_from_org, p_from_account, coalesce(p_occurred_at, current_date), 'تحويل عهدة', 0, p_amount, null, v_note, v_group),
    (v_from_org, p_to_account, coalesce(p_occurred_at, current_date), 'تحويل عهدة', p_amount, 0, null, v_note, v_group);

  return v_group;
end;
$$;

revoke execute on function public.fn_transfer_custody(uuid, uuid, numeric, date, text) from public, anon, authenticated;
grant execute on function public.fn_transfer_custody(uuid, uuid, numeric, date, text) to authenticated;

commit;

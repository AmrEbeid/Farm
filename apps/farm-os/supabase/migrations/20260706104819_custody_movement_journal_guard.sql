-- Farm OS — custody movement journal guard.
--
-- Direct custody movements are allowed only when their accounting meaning is
-- explicit and journaled: owner funding in, or an expense-linked cash payout.
-- Holder-to-holder transfers remain on fn_transfer_custody because total cash
-- is conserved and no GL entry is intended.

begin;

create or replace function public.fn_record_custody_movement(
  p_account uuid, p_movement_type text, p_amount_in numeric, p_amount_out numeric,
  p_occurred_at date default current_date, p_expense_id uuid default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_exp_org uuid;
  v_exp_total numeric;
  v_exp_kind text;
  v_exp_payment_status text;
  v_debit_account uuid;
  v_credit_account uuid;
  v_journal uuid;
  v_amount_in numeric := coalesce(p_amount_in, 0);
  v_amount_out numeric := coalesce(p_amount_out, 0);
  v_movement_type text := nullif(trim(coalesce(p_movement_type, '')), '');
  v_balance numeric;
begin
  select org_id into v_org
    from public.custody_accounts
   where id = p_account
   for update;
  if v_org is null then raise exception 'custody account % not found', p_account using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody' using errcode = '42501';
  end if;
  if not public.authorize('custody.write', v_org) then
    raise exception 'forbidden: custody.write is required' using errcode = '42501';
  end if;
  if v_movement_type is null then
    raise exception 'movement_type is required' using errcode = '23502';
  end if;
  if v_amount_in < 0 or v_amount_out < 0 then
    raise exception 'amounts must be non-negative' using errcode = '22023';
  end if;
  if (v_amount_in > 0) = (v_amount_out > 0) then
    raise exception 'exactly one of amount_in / amount_out must be > 0' using errcode = '22023';
  end if;

  if p_expense_id is null then
    if v_amount_in > 0 and v_movement_type <> 'استلام عهدة من المالك' then
      raise exception 'direct custody cash-in requires the owner-funding movement type'
        using errcode = '22023';
    end if;
    if v_amount_out > 0 then
      raise exception 'direct custody cash-out requires a linked expense or fn_transfer_custody'
        using errcode = '22023';
    end if;
  elsif v_amount_in > 0 then
    raise exception 'expense-linked custody movement must be a cash out-movement'
      using errcode = '22023';
  end if;

  if p_expense_id is not null then
    select org_id, total, kind, payment_status
      into v_exp_org, v_exp_total, v_exp_kind, v_exp_payment_status
      from public.expenses
     where id = p_expense_id;
    if v_exp_org is null then
      raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
    end if;
    if v_exp_org is distinct from v_org then
      raise exception 'forbidden: cross-org expense link' using errcode = '42501';
    end if;
    if v_amount_out > 0 then
      if coalesce(v_exp_kind, 'operating') not in ('operating','drawing','capex') then
        raise exception 'invalid expense kind for custody cash out-movement (kind=%)', v_exp_kind using errcode = '22023';
      end if;
      if coalesce(v_exp_payment_status, '') <> 'paid_from_custody' then
        raise exception 'set expense payment_status to paid_from_custody through fn_set_expense_payment_status before linking a cash out-movement'
          using errcode = '22023';
      end if;
      if v_amount_out <> coalesce(v_exp_total,0) then
        raise exception 'custody cash out-movement must equal the linked expense total (%)', v_exp_total
          using errcode = '22023';
      end if;
      if exists (
         select 1 from public.custody_movements m
          where m.expense_id = p_expense_id and m.amount_out > 0) then
        raise exception 'expense already has a custody cash out-movement; post a reversal before another cash out' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_amount_out > 0 then
    select coalesce(sum(amount_in), 0) - coalesce(sum(amount_out), 0)
      into v_balance
      from public.custody_movements
     where org_id = v_org
       and custody_account_id = p_account;

    if coalesce(v_balance, 0) < v_amount_out then
      raise exception 'insufficient custody balance: available %, requested %', coalesce(v_balance, 0), v_amount_out
        using errcode = '22023';
    end if;
  end if;

  insert into public.custody_movements(org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id, note)
  values (v_org, p_account, coalesce(p_occurred_at, current_date), v_movement_type,
          v_amount_in, v_amount_out, p_expense_id, p_note)
  returning id into v_id;

  if p_expense_id is null and v_amount_in > 0 then
    v_debit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    v_credit_account := public.fn_ensure_account(v_org, '3000', 'تمويل المالك', 'equity', 'credit');
    v_journal := public.fn_post_two_line_journal(
      v_org,
      coalesce(p_occurred_at, current_date),
      'custody_owner_funding',
      v_id,
      'استلام عهدة من المالك',
      v_debit_account,
      v_credit_account,
      v_amount_in,
      'استلام نقدية عهدة من المالك',
      'تمويل المالك للعهدة',
      p_account,
      v_id,
      null,
      null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;

  if p_expense_id is not null and v_amount_out > 0 then
    v_debit_account := public.fn_expense_posting_account(v_org, p_expense_id, v_exp_kind);
    v_credit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    v_journal := public.fn_post_two_line_journal(
      v_org,
      coalesce(p_occurred_at, current_date),
      'expense_payment',
      p_expense_id,
      'سداد مصروف من العهدة',
      v_debit_account,
      v_credit_account,
      v_amount_out,
      'إثبات مصروف/مسحوبات/رأسمالي عند السداد النقدي',
      'خروج نقدية من العهدة',
      p_account,
      v_id,
      p_expense_id,
      null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) to authenticated;

commit;

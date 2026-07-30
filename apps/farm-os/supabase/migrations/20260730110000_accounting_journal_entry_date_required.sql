-- #719 item 3: the internal journal choke point must receive an explicit accounting date.
--
-- Every active caller already resolves its business date before this call. Rejecting NULL here prevents
-- a future caller from silently converting an unknown historical date to current_date and bypassing a
-- locked period. The signature, idempotency, mutex, account/org checks, line shape, and grants are unchanged.
--
-- Rollback: restore the fn_post_two_line_journal body from migration 20260726170000.

begin;

create or replace function public.fn_post_two_line_journal(
  p_org uuid,
  p_entry_date date,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_debit_account uuid,
  p_credit_account uuid,
  p_amount numeric,
  p_debit_description text default null,
  p_credit_description text default null,
  p_custody_account uuid default null,
  p_custody_movement uuid default null,
  p_expense uuid default null,
  p_payment_request uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source_type text;
  v_source_sequence integer;
  v_existing uuid;
  v_entry uuid;
  v_debit_org uuid;
  v_credit_org uuid;
  v_exp_org uuid;
  v_exp_cost_center uuid;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_entry_date is null then raise exception 'entry_date required' using errcode = '23502'; end if;
  v_source_type := trim(coalesce(p_source_type, ''));
  if v_source_type = '' then raise exception 'source_type required' using errcode = '23502'; end if;
  if p_source_id is null then raise exception 'source_id required' using errcode = '23502'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'journal amount must be positive' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(private.fn_accounting_period_mutex_key(p_org));

  perform 1
    from public.journal_entries
   where org_id = p_org
     and source_type = v_source_type
     and source_id = p_source_id
   order by source_sequence
   for update;

  select id into v_existing
    from public.journal_entries
   where org_id = p_org
     and source_type = v_source_type
     and source_id = p_source_id
     and status = 'posted'
   order by source_sequence desc
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce(max(source_sequence), 0) + 1 into v_source_sequence
    from public.journal_entries
   where org_id = p_org
     and source_type = v_source_type
     and source_id = p_source_id;

  if public.fn_period_locked(p_org, p_entry_date) then
    raise exception 'الفترة المحاسبية مقفلة — لا يمكن ترحيل قيد بتاريخ %', p_entry_date
      using errcode = '55000';
  end if;

  select org_id into v_debit_org from public.accounts where id = p_debit_account;
  select org_id into v_credit_org from public.accounts where id = p_credit_account;
  if v_debit_org is distinct from p_org or v_credit_org is distinct from p_org then
    raise exception 'journal accounts must belong to the entry org' using errcode = '42501';
  end if;

  if p_expense is not null then
    select org_id, cost_center_id into v_exp_org, v_exp_cost_center
      from public.expenses
     where id = p_expense;
    if v_exp_org is null then
      raise exception 'expense % not found', p_expense using errcode = 'P0002';
    end if;
    if v_exp_org is distinct from p_org then
      raise exception 'journal expense must belong to the entry org' using errcode = '42501';
    end if;
  end if;

  insert into public.journal_entries(org_id, entry_date, source_type, source_id, source_sequence, description)
  values (p_org, p_entry_date, v_source_type, p_source_id, v_source_sequence, p_description)
  returning id into v_entry;

  insert into public.journal_lines(
    org_id, journal_entry_id, account_id, debit, credit, description,
    custody_account_id, custody_movement_id, expense_id, payment_request_id, cost_center_id)
  values
    (p_org, v_entry, p_debit_account, p_amount, 0, p_debit_description,
     p_custody_account, p_custody_movement, p_expense, p_payment_request, v_exp_cost_center),
    (p_org, v_entry, p_credit_account, 0, p_amount, p_credit_description,
     p_custody_account, p_custody_movement, p_expense, p_payment_request, null);

  return v_entry;
end;
$$;

revoke execute on function public.fn_post_two_line_journal(
  uuid, date, text, uuid, text, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid
) from public, anon, authenticated;

comment on function public.fn_post_two_line_journal(
  uuid, date, text, uuid, text, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid
) is
  'Internal two-line journal posting choke point. Requires an explicit accounting entry date; enforces period lock, org/account integrity, idempotency, source sequencing, and the accounting-period mutex.';

commit;

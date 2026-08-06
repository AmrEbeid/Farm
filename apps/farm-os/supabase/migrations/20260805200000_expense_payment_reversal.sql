-- SPEC-0028 C-1: atomic correction of a custody-paid expense.
--
-- Problem: the old advice to post a manual custody cash-in could restore the float but left the
-- expense active in owner P&L and was not idempotent. A custody-paid expense could not be returned
-- to an editable state because its original movement and journal remained visible to the routed-money guard.
--
-- Intent: preserve the original movement, append one uniquely linked compensating movement, reverse
-- the original journal through the existing period-aware helper, and move the expense either back to
-- the unrouted state or to the existing cancelled state. Payment-request-linked expenses stay blocked
-- until that workflow has its own complete reversal semantics.
--
-- Security: authenticated owner/accountant only through the existing custody.write + budget.write
-- permission intersection. SECURITY DEFINER, empty search_path, tenant membership checked before writes.
-- Rollback: revoke/drop fn_reverse_expense_payment, restore the previous routed-money guard definition,
-- then drop the reversal columns/indexes only after proving no reversal rows exist. Reversal rows themselves
-- are accounting evidence and must never be deleted as a routine rollback.

begin;

alter table public.custody_movements
  add column if not exists reversal_of uuid references public.custody_movements(id),
  add column if not exists reversal_reason text,
  add column if not exists expense_reversal_outcome text,
  add column if not exists reversed_by uuid references public.custody_movements(id),
  add column if not exists reversed_at timestamptz;

alter table public.custody_movements
  drop constraint if exists custody_movements_reversal_shape_check;
alter table public.custody_movements
  add constraint custody_movements_reversal_shape_check check (
    (
      (
        reversal_of is null
        and reversal_reason is null
        and expense_reversal_outcome is null
      ) or (
        reversal_of is not null
        and reversal_of is distinct from id
        and nullif(btrim(reversal_reason), '') is not null
        and amount_in > 0
        and amount_out = 0
        and expense_reversal_outcome in ('unrouted', 'cancelled')
        and expense_id is not null
      )
    )
    and (
      (reversed_by is null and reversed_at is null)
      or (
        reversed_by is not null
        and reversed_at is not null
        and reversal_of is null
        and amount_out > 0
      )
    )
  );

drop index if exists public.custody_movements_one_out_per_expense_uniq;
create unique index custody_movements_one_out_per_expense_uniq
  on public.custody_movements(expense_id)
  where amount_out > 0 and expense_id is not null and reversed_by is null;
create unique index if not exists custody_movements_one_reversal_per_original_uniq
  on public.custody_movements(reversal_of)
  where reversal_of is not null;
create unique index if not exists custody_movements_one_original_per_reversal_uniq
  on public.custody_movements(reversed_by)
  where reversed_by is not null;
create index if not exists custody_movements_expense_reversal_idx
  on public.custody_movements(org_id, expense_id, reversal_of)
  where reversal_of is not null;

create or replace function public.fn_reverse_expense_payment(
  p_expense uuid,
  p_expected_movement uuid,
  p_outcome text,
  p_reason text,
  p_reversal_date date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_original public.custody_movements%rowtype;
  v_existing public.custody_movements%rowtype;
  v_original_journal public.journal_entries%rowtype;
  v_outcome text := nullif(btrim(coalesce(p_outcome, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_reversal_journal uuid;
  v_reversal_movement uuid;
  v_expected_status text;
begin
  if p_expense is null then
    raise exception 'expense required' using errcode = '23502';
  end if;
  if p_expected_movement is null then
    raise exception 'expected custody movement required' using errcode = '23502';
  end if;
  if v_outcome is null or v_outcome not in ('unrouted', 'cancelled') then
    raise exception 'outcome must be unrouted or cancelled' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'reversal reason required' using errcode = '23502';
  end if;
  if length(v_reason) > 500 then
    raise exception 'reversal reason exceeds 500 characters' using errcode = '22023';
  end if;
  if p_reversal_date is null then
    raise exception 'reversal date required' using errcode = '23502';
  end if;

  select *
    into v_expense
    from public.expenses
   where id = p_expense
     and org_id in (select public.user_org_ids())
   for update;
  if not found then
    raise exception 'expense % not found', p_expense using errcode = 'P0002';
  end if;
  if not public.authorize('custody.write', v_expense.org_id)
     or not public.authorize('budget.write', v_expense.org_id) then
    raise exception 'forbidden: custody.write and budget.write are required' using errcode = '42501';
  end if;

  select *
    into v_original
    from public.custody_movements
   where id = p_expected_movement
     and org_id = v_expense.org_id
     and expense_id = v_expense.id
     and amount_out > 0
     and reversal_of is null
   for update;
  if not found then
    raise exception 'expected custody payment movement is not linked to this expense'
      using errcode = '22023';
  end if;

  select *
    into v_existing
    from public.custody_movements
   where reversal_of = v_original.id
   for update;
  if found then
    v_expected_status := case when v_existing.expense_reversal_outcome = 'cancelled' then 'cancelled' else null end;
    if v_existing.expense_reversal_outcome is distinct from v_outcome
       or v_existing.reversal_reason is distinct from v_reason
       or not exists (
         select 1
           from public.journal_entries reversal_journal
          where reversal_journal.id = v_existing.journal_entry_id
            and reversal_journal.entry_date = p_reversal_date
       )
       or v_expense.payment_status is distinct from v_expected_status then
      raise exception 'expense payment was already reversed with a different request or state'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'expense_id', v_expense.id,
      'outcome', v_existing.expense_reversal_outcome,
      'original_movement_id', v_original.id,
      'reversal_movement_id', v_existing.id,
      'reversal_journal_id', v_existing.journal_entry_id,
      'idempotent', true
    );
  end if;

  if v_expense.payment_status is distinct from 'paid_from_custody' then
    raise exception 'only an active paid_from_custody expense can be reversed (status=%)',
      coalesce(v_expense.payment_status, 'unrouted') using errcode = '22023';
  end if;
  if v_original.amount_in <> 0
     or v_original.amount_out <> v_expense.total
     or v_original.custody_account_id is null
     or v_original.journal_entry_id is null then
    raise exception 'expense payment movement is incomplete or does not match the expense'
      using errcode = '22023';
  end if;
  if v_original.payment_request_id is not null
     or exists (
       select 1
         from public.payment_request_lines line
        where line.org_id = v_expense.org_id
          and line.expense_id = v_expense.id
     ) then
    raise exception 'payment-request-linked expenses require the request reversal workflow'
      using errcode = '22023';
  end if;

  -- Before this RPC existed, operators were told to restore custody with an unlinked manual cash-in.
  -- Such a row cannot be distinguished reliably from later legitimate funding. Fail closed whenever
  -- a same-account, same-amount unlinked cash-in was recorded after this payment; finance must first
  -- reconcile/map that legacy evidence so this RPC cannot restore the same float twice.
  if exists (
    select 1
      from public.custody_movements candidate
     where candidate.org_id = v_expense.org_id
       and candidate.custody_account_id = v_original.custody_account_id
       and candidate.amount_in = v_original.amount_out
       and candidate.amount_out = 0
       and candidate.expense_id is null
       and candidate.payment_request_id is null
       and candidate.reversal_of is null
       and candidate.created_at >= v_original.created_at
  ) then
    raise exception 'possible legacy manual custody correction requires reconciliation before automatic reversal'
      using errcode = '22023';
  end if;

  select *
    into v_original_journal
    from public.journal_entries
   where id = v_original.journal_entry_id
   for update;
  if not found
     or v_original_journal.org_id is distinct from v_expense.org_id
     or v_original_journal.source_type is distinct from 'expense_payment'
     or v_original_journal.source_id is distinct from v_expense.id
     or v_original_journal.status is distinct from 'posted'
     or v_original_journal.reversal_of is not null then
    raise exception 'expense payment journal linkage is invalid' using errcode = '22023';
  end if;

  v_reversal_journal := public.fn_reverse_journal_entry(
    v_original.journal_entry_id,
    v_reason,
    p_reversal_date
  );

  insert into public.custody_movements(
    org_id,
    custody_account_id,
    occurred_at,
    movement_type,
    amount_in,
    amount_out,
    expense_id,
    journal_entry_id,
    note,
    reversal_of,
    reversal_reason,
    expense_reversal_outcome
  ) values (
    v_expense.org_id,
    v_original.custody_account_id,
    p_reversal_date,
    'عكس سداد مصروف من العهدة',
    v_original.amount_out,
    0,
    v_expense.id,
    v_reversal_journal,
    concat('عكس الحركة ', v_original.id::text, ' — السبب: ', v_reason),
    v_original.id,
    v_reason,
    v_outcome
  )
  returning id into v_reversal_movement;

  update public.custody_movements
     set reversed_by = v_reversal_movement,
         reversed_at = now()
   where id = v_original.id;

  update public.journal_lines
     set custody_movement_id = v_reversal_movement
   where journal_entry_id = v_reversal_journal
     and custody_movement_id = v_original.id;

  update public.expenses
     set payment_status = case when v_outcome = 'cancelled' then 'cancelled' else null end,
         paid_by = null
   where id = v_expense.id;

  return jsonb_build_object(
    'expense_id', v_expense.id,
    'outcome', v_outcome,
    'original_movement_id', v_original.id,
    'reversal_movement_id', v_reversal_movement,
    'reversal_journal_id', v_reversal_journal,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.fn_reverse_expense_payment(uuid, uuid, text, text, date)
  from public, anon, authenticated;
grant execute on function public.fn_reverse_expense_payment(uuid, uuid, text, text, date)
  to authenticated;

-- Preserve the latest journal/balance-hardened movement writer, changing only its duplicate-payment
-- predicate: a linked reversed attempt is history, while one unmatched cash-out remains the active attempt.
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
          where m.expense_id = p_expense_id
            and m.amount_out > 0
            and m.reversed_by is null) then
        raise exception 'expense already has an active custody cash out-movement; reverse it before another cash out' using errcode = '22023';
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
      v_org, coalesce(p_occurred_at, current_date), 'custody_owner_funding', v_id,
      'استلام عهدة من المالك', v_debit_account, v_credit_account, v_amount_in,
      'استلام نقدية عهدة من المالك', 'تمويل المالك للعهدة', p_account, v_id, null, null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;

  if p_expense_id is not null and v_amount_out > 0 then
    v_debit_account := public.fn_expense_posting_account(v_org, p_expense_id, v_exp_kind);
    v_credit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    v_journal := public.fn_post_two_line_journal(
      v_org, coalesce(p_occurred_at, current_date), 'expense_payment', p_expense_id,
      'سداد مصروف من العهدة', v_debit_account, v_credit_account, v_amount_out,
      'إثبات مصروف/مسحوبات/رأسمالي عند السداد النقدي', 'خروج نقدية من العهدة',
      p_account, v_id, p_expense_id, null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text)
  to authenticated;

-- Preserve the latest account-tree payment router, narrowing its existing-movement lookup to the one
-- active attempt. The expense row lock remains the concurrency mutex for a new post-reversal payment.
create or replace function public.fn_set_expense_payment_status(
  p_expense uuid, p_status text, p_custody_account uuid default null, p_paid_by text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_total numeric;
  v_kind text;
  v_payment_status text;
  v_existing int;
  v_existing_movement uuid;
  v_has_request_line boolean := false;
  v_journal uuid;
begin
  select org_id, total, kind, payment_status
    into v_org, v_total, v_kind, v_payment_status
    from public.expenses
   where id = p_expense
   for update;
  if v_org is null then raise exception 'expense % not found', p_expense using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if p_status not in ('paid_from_custody','post_paid_unpaid','paid_by_owner','cancelled') then
    raise exception 'invalid payment_status: %', p_status using errcode = '22023'; end if;
  if v_payment_status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'cancelled expense payment state is terminal; create a new expense instead'
      using errcode = '22023';
  end if;
  if p_status in ('paid_from_custody','post_paid_unpaid') and coalesce(v_kind, 'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind for custody/request routing (kind=%)', v_kind using errcode = '22023';
  end if;

  select count(*), (array_agg(id order by created_at))[1]
    into v_existing, v_existing_movement
    from public.custody_movements
   where expense_id = p_expense
     and amount_out > 0
     and reversed_by is null;

  if p_status <> 'paid_from_custody' and v_existing > 0 then
    raise exception 'expense already has an active custody cash out-movement; reverse it before rerouting payment_status' using errcode = '22023';
  end if;

  select exists (
    select 1
      from public.payment_request_lines l
     where l.expense_id = p_expense
       and l.paid_at is null)
    into v_has_request_line;
  if v_has_request_line and p_status is distinct from v_payment_status then
    raise exception 'expense is already included in an unpaid payment request line; confirm payment through the request workflow'
      using errcode = '22023';
  end if;

  update public.expenses
     set payment_status = p_status,
         paid_by = p_paid_by
   where id = p_expense;

  if p_status = 'paid_from_custody' then
    if p_custody_account is null and v_existing = 0 then
      raise exception 'custody account required for paid_from_custody' using errcode = '22023';
    end if;
    if p_custody_account is not null and (select org_id from public.custody_accounts where id = p_custody_account) is distinct from v_org then
      raise exception 'forbidden: cross-org custody account' using errcode = '42501';
    end if;
    if v_existing = 0 and coalesce(v_total,0) > 0 then
      v_existing_movement := public.fn_record_custody_movement(
        p_custody_account, 'صرف نقدي', 0, v_total, current_date, p_expense,
        'صرف نقدي للمصروف ' || left(p_expense::text, 8));
    elsif v_existing_movement is not null then
      select journal_entry_id into v_journal from public.custody_movements where id = v_existing_movement;
      if v_journal is null then
        v_journal := public.fn_post_two_line_journal(
          v_org, current_date, 'expense_payment', p_expense, 'سداد مصروف من العهدة',
          public.fn_expense_posting_account(v_org, p_expense, v_kind),
          public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit'),
          coalesce(v_total,0), 'إثبات مصروف/مسحوبات/رأسمالي عند السداد النقدي',
          'خروج نقدية من العهدة',
          (select custody_account_id from public.custody_movements where id = v_existing_movement),
          v_existing_movement, p_expense, null);
        update public.custody_movements set journal_entry_id = v_journal where id = v_existing_movement;
      end if;
    end if;
  end if;
end;
$$;
revoke execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text)
  to authenticated;

-- Complete an `unrouted` payment correction in one transaction. Editing the expense and routing its
-- replacement payment must share the expense row lock; otherwise two browser submissions can interleave
-- between an UPDATE and fn_set_expense_payment_status and silently overwrite the corrected amount.
create or replace function public.fn_correct_and_route_reversed_expense(
  p_expense uuid,
  p_date date,
  p_category text,
  p_description text,
  p_total numeric,
  p_supplier uuid,
  p_account uuid,
  p_cost_center uuid,
  p_route text,
  p_custody_account uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_latest_outcome text;
begin
  select expense.*
    into v_expense
    from public.expenses expense
   where expense.id = p_expense
     and expense.org_id in (select public.user_org_ids())
   for update;
  if not found then
    raise exception 'expense not found' using errcode = 'P0002';
  end if;
  if not public.authorize('budget.write', v_expense.org_id) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;
  if v_expense.payment_status is not null then
    raise exception 'expense is no longer awaiting corrected routing' using errcode = '22023';
  end if;

  select movement.expense_reversal_outcome
    into v_latest_outcome
    from public.custody_movements movement
   where movement.org_id = v_expense.org_id
     and movement.expense_id = p_expense
     and movement.reversal_of is not null
   order by movement.created_at desc, movement.id desc
   limit 1;
  if v_latest_outcome is distinct from 'unrouted' then
    raise exception 'expense has no open payment-only correction' using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.custody_movements movement
     where movement.org_id = v_expense.org_id
       and movement.expense_id = p_expense
       and movement.amount_out > 0
       and movement.reversed_by is null
  ) then
    raise exception 'expense already has an active custody payment' using errcode = '22023';
  end if;

  p_category := btrim(coalesce(p_category, ''));
  p_description := nullif(btrim(coalesce(p_description, '')), '');
  if p_category = '' or length(p_category) > 80 then
    raise exception 'invalid expense category' using errcode = '22023';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'invalid expense total' using errcode = '22023';
  end if;
  if length(coalesce(p_description, '')) > 200 then
    raise exception 'invalid expense description' using errcode = '22023';
  end if;
  if p_route not in ('custody', 'later', 'none') then
    raise exception 'invalid corrected payment route' using errcode = '22023';
  end if;
  if p_route = 'custody' and p_custody_account is null then
    raise exception 'custody account is required' using errcode = '22023';
  end if;
  if p_supplier is not null and not exists (
    select 1 from public.suppliers supplier
     where supplier.id = p_supplier and supplier.org_id = v_expense.org_id
  ) then
    raise exception 'supplier does not belong to the expense organization' using errcode = '42501';
  end if;

  update public.expenses
     set date = p_date,
         category = p_category,
         description = p_description,
         total = p_total,
         supplier_id = p_supplier,
         account_id = p_account,
         cost_center_id = p_cost_center
   where id = p_expense;

  if p_route = 'custody' then
    perform public.fn_set_expense_payment_status(
      p_expense, 'paid_from_custody', p_custody_account, null
    );
  elsif p_route = 'later' then
    perform public.fn_set_expense_payment_status(
      p_expense, 'post_paid_unpaid', null, null
    );
  end if;

  return jsonb_build_object(
    'expense_id', p_expense,
    'payment_status', case p_route
      when 'custody' then 'paid_from_custody'
      when 'later' then 'post_paid_unpaid'
      else null
    end
  );
end;
$$;
revoke execute on function public.fn_correct_and_route_reversed_expense(
  uuid, date, text, text, numeric, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.fn_correct_and_route_reversed_expense(
  uuid, date, text, text, numeric, uuid, uuid, uuid, text, uuid
) to authenticated;

-- Preserve the latest account-aware request linker, selecting only the active custody-payment
-- attempt after an expense has been reversed, edited and paid again.
create or replace function public.fn_add_expense_to_request(p_request uuid, p_expense uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_exp_org uuid;
  v_exp_kind text;
  v_exp_payment_status text;
  v_exp_account uuid;
  v_paid_by text;
  v_id uuid;
  v_existing_movement uuid;
  v_existing_account uuid;
  v_existing_journal uuid;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then
    raise exception 'forbidden: request.prepare is required' using errcode='42501'; end if;
  if v_status <> 'draft' then raise exception 'request is not draft (%)', v_status using errcode='22023'; end if;

  select org_id, kind, payment_status, account_id, paid_by
    into v_exp_org, v_exp_kind, v_exp_payment_status, v_exp_account, v_paid_by
    from public.expenses
   where id = p_expense
   for update;
  if v_exp_org is distinct from v_org then raise exception 'forbidden: cross-org expense' using errcode='42501'; end if;
  if coalesce(v_exp_kind, 'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind for a payment request (kind=%)', v_exp_kind using errcode='22023'; end if;
  if v_exp_account is null then
    raise exception 'expense account_id is required before adding an expense to a payment request' using errcode='22023';
  end if;
  perform public.fn_expense_posting_account(v_org, p_expense, v_exp_kind);
  if coalesce(v_exp_payment_status, '') not in ('post_paid_unpaid','paid_from_custody') then
    raise exception 'only post_paid_unpaid or paid_from_custody expenses can be added to a payment request (payment_status=%)', v_exp_payment_status using errcode='22023'; end if;
  if exists (
       select 1 from public.payment_request_lines l
        where l.expense_id = p_expense
          and l.payment_request_id <> p_request) then
    raise exception 'expense is already included in another payment request' using errcode='22023';
  end if;

  if v_exp_payment_status = 'paid_from_custody' then
    select m.id, m.custody_account_id, m.journal_entry_id
      into v_existing_movement, v_existing_account, v_existing_journal
      from public.custody_movements m
     where m.expense_id = p_expense
       and m.amount_out > 0
       and m.reversed_by is null
     order by m.created_at
     limit 1;
    if v_existing_movement is null then
      raise exception 'paid_from_custody expense has no active custody cash out-movement' using errcode='22023';
    end if;
  end if;

  insert into public.payment_request_lines(
    org_id, payment_request_id, expense_id, paid_at, paid_by, paid_from_custody_account_id, custody_movement_id, journal_entry_id)
  values (
    v_org,
    p_request,
    p_expense,
    case when v_exp_payment_status = 'paid_from_custody' then now() else null end,
    case when v_exp_payment_status = 'paid_from_custody' then v_paid_by else null end,
    v_existing_account,
    v_existing_movement,
    v_existing_journal)
  on conflict (payment_request_id, expense_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_add_expense_to_request(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_add_expense_to_request(uuid, uuid)
  to authenticated;

-- Preserve the custody cash-expense report contract while selecting the one active payment attempt.
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
          and mm.reversed_by is null
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
revoke execute on function public.fn_custody_cash_expense_report(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_custody_cash_expense_report(uuid, date, date)
  to authenticated;

-- A fully reversed historical route no longer freezes the expense amount/classification. The original
-- rows remain append-only, but only an unmatched cash-out, a posted journal, or a request line is active money.
create or replace function public.expense_guard_routed_money_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_request_line boolean := false;
  v_has_cash_movement boolean := false;
  v_has_journal_line boolean := false;
  v_money_changed boolean;
  v_account_changed boolean;
  v_cost_center_changed boolean;
  v_account_merge_source uuid;
  v_account_merge_target uuid;
  v_cost_center_merge_source uuid;
  v_cost_center_merge_target uuid;
  v_account_change_allowed boolean := false;
  v_cost_center_change_allowed boolean := false;
begin
  if old.payment_status = 'cancelled' and new is distinct from old then
    raise exception 'cancelled expense evidence is immutable; create a new expense for any correction'
      using errcode = '22023';
  end if;

  v_money_changed := old.total is distinct from new.total or old.kind is distinct from new.kind;
  v_account_changed := old.account_id is distinct from new.account_id;
  v_cost_center_changed := old.cost_center_id is distinct from new.cost_center_id;
  if not v_money_changed and not v_account_changed and not v_cost_center_changed then
    return new;
  end if;

  if to_regclass('public.payment_request_lines') is not null then
    execute 'select exists (select 1 from public.payment_request_lines l where l.expense_id = $1)'
      into v_has_request_line
      using old.id;
  end if;

  v_has_cash_movement := exists (
    select 1
      from public.custody_movements original
     where original.expense_id = old.id
       and original.amount_out > 0
       and original.reversal_of is null
       and not exists (
         select 1
           from public.custody_movements reversal
          where reversal.reversal_of = original.id
       )
  );

  if to_regclass('public.journal_lines') is not null then
    execute $query$
      select exists (
        select 1
          from public.journal_lines l
          join public.journal_entries entry on entry.id = l.journal_entry_id
         where l.expense_id = $1
           and entry.status = 'posted'
      )
    $query$
      into v_has_journal_line
      using old.id;
  end if;

  if v_money_changed and (
       coalesce(old.payment_status, '') in ('paid_from_custody','post_paid_unpaid','cancelled')
    or v_has_cash_movement
    or v_has_request_line
    or v_has_journal_line) then
    raise exception 'routed expense amount/kind is immutable; post a reversal or create a new expense'
      using errcode = '22023';
  end if;

  if (v_account_changed or v_cost_center_changed)
     and (
       old.payment_status = 'cancelled'
       or v_has_cash_movement
       or v_has_request_line
       or v_has_journal_line
     ) then
    begin
      v_account_merge_source := nullif(current_setting('app.account_merge_source', true), '')::uuid;
      v_account_merge_target := nullif(current_setting('app.account_merge_target', true), '')::uuid;
      v_cost_center_merge_source := nullif(current_setting('app.cost_center_merge_source', true), '')::uuid;
      v_cost_center_merge_target := nullif(current_setting('app.cost_center_merge_target', true), '')::uuid;
    exception when invalid_text_representation then
      v_account_merge_source := null;
      v_account_merge_target := null;
      v_cost_center_merge_source := null;
      v_cost_center_merge_target := null;
    end;

    v_account_change_allowed := not v_account_changed or (
      v_account_merge_source is not distinct from old.account_id
      and v_account_merge_target is not distinct from new.account_id);
    v_cost_center_change_allowed := not v_cost_center_changed or (
      v_cost_center_merge_source is not distinct from old.cost_center_id
      and v_cost_center_merge_target is not distinct from new.cost_center_id);

    if not (v_account_change_allowed and v_cost_center_change_allowed) then
      raise exception 'routed expense account/cost center is immutable; use a controlled merge'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.expense_guard_routed_money_immutable()
  from public, anon, authenticated;
drop trigger if exists expense_guard_routed_money_immutable on public.expenses;
create trigger expense_guard_routed_money_immutable
  before update on public.expenses
  for each row execute function public.expense_guard_routed_money_immutable();

commit;

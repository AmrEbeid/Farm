-- D3: journal reversal RPC + source-sequence repost semantics.
--
-- The accounting kernel already had `status = reversed` and `reversal_of`, but no client-safe way to
-- create the reversal pair. It also keyed idempotency only on (org, source_type, source_id), so a
-- corrected re-post after reversal was swallowed by the old reversed row.
--
-- Model:
-- - A reversal marks the original entry `reversed`.
-- - A mirror entry is inserted with swapped lines, `status = reversed`, and `reversal_of = original`.
-- - Posted-only statements exclude both rows; the older all-lines trial balance sees both and they net to 0.
-- - Re-posting the same business source creates the next `source_sequence` as the new posted entry.

alter table public.journal_entries
  add column if not exists source_sequence integer not null default 1;

do $$
begin
  alter table public.journal_entries
    add constraint journal_entries_source_sequence_positive check (source_sequence >= 1);
exception
  when duplicate_object then null;
end $$;

alter table public.journal_entries
  drop constraint if exists journal_entries_org_id_source_type_source_id_key;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.journal_entries'::regclass
       and conname = 'journal_entries_source_sequence_key'
  ) then
    alter table public.journal_entries
      add constraint journal_entries_source_sequence_key
      unique (org_id, source_type, source_id, source_sequence);
  end if;
end $$;

create index if not exists journal_entries_posted_source_idx
  on public.journal_entries(org_id, source_type, source_id, source_sequence)
  where status = 'posted';

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
  v_source_type := trim(coalesce(p_source_type, ''));
  if v_source_type = '' then raise exception 'source_type required' using errcode = '23502'; end if;
  if p_source_id is null then raise exception 'source_id required' using errcode = '23502'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'journal amount must be positive' using errcode = '22023'; end if;

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

  -- Keep the period-lock guard after the idempotency return: repeat submissions of the current posted
  -- entry stay harmless no-ops, while corrected re-posts after a reversal count as genuinely new postings.
  if public.fn_period_locked(p_org, coalesce(p_entry_date, current_date)) then
    raise exception 'الفترة المحاسبية مقفلة — لا يمكن ترحيل قيد بتاريخ %', coalesce(p_entry_date, current_date)
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
  values (p_org, coalesce(p_entry_date, current_date), v_source_type, p_source_id, v_source_sequence, p_description)
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
revoke execute on function public.fn_post_two_line_journal(uuid, date, text, uuid, text, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.fn_reverse_journal_entry(
  p_entry uuid,
  p_reason text,
  p_reversal_date date default current_date)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_original public.journal_entries%rowtype;
  v_reason text;
  v_reversal_date date;
  v_reversal uuid;
  v_source_sequence integer;
begin
  if p_entry is null then
    raise exception 'journal entry required' using errcode = '23502';
  end if;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'reversal reason required' using errcode = '23502';
  end if;
  v_reversal_date := coalesce(p_reversal_date, current_date);

  select *
    into v_original
    from public.journal_entries
   where id = p_entry
   for update;
  if not found then
    raise exception 'journal entry % not found', p_entry using errcode = 'P0002';
  end if;

  if v_original.org_id not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org journal reversal' using errcode = '42501';
  end if;
  if not public.authorize('budget.write', v_original.org_id) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501';
  end if;

  if v_original.reversal_of is not null then
    raise exception 'cannot reverse a reversal journal entry' using errcode = '22023';
  end if;

  if v_original.status = 'reversed' then
    select id into v_reversal
      from public.journal_entries
     where reversal_of = v_original.id
     order by created_at desc, id desc
     limit 1;
    return coalesce(v_reversal, v_original.id);
  end if;

  if public.fn_period_locked(v_original.org_id, v_original.entry_date) then
    raise exception 'cannot reverse a journal entry from a locked accounting period' using errcode = '55000';
  end if;
  if public.fn_period_locked(v_original.org_id, v_reversal_date) then
    raise exception 'cannot post a reversal into a locked accounting period' using errcode = '55000';
  end if;

  perform 1
    from public.journal_entries
   where org_id = v_original.org_id
     and source_type = v_original.source_type
     and source_id = v_original.source_id
   order by source_sequence
   for update;

  select coalesce(max(source_sequence), 0) + 1 into v_source_sequence
    from public.journal_entries
   where org_id = v_original.org_id
     and source_type = v_original.source_type
     and source_id = v_original.source_id;

  update public.journal_entries
     set status = 'reversed'
   where id = v_original.id;

  insert into public.journal_entries(
    org_id, entry_date, source_type, source_id, source_sequence, description, status, reversal_of)
  values (
    v_original.org_id,
    v_reversal_date,
    v_original.source_type,
    v_original.source_id,
    v_source_sequence,
    concat('عكس القيد: ', coalesce(v_original.description, v_original.source_type), ' — السبب: ', v_reason),
    'reversed',
    v_original.id)
  returning id into v_reversal;

  insert into public.journal_lines(
    org_id, journal_entry_id, account_id, debit, credit, description,
    custody_account_id, custody_movement_id, expense_id, payment_request_id, cost_center_id)
  select
    org_id,
    v_reversal,
    account_id,
    credit,
    debit,
    concat('عكس: ', coalesce(description, v_original.description, v_original.source_type)),
    custody_account_id,
    custody_movement_id,
    expense_id,
    payment_request_id,
    cost_center_id
  from public.journal_lines
  where journal_entry_id = v_original.id
  order by id;

  return v_reversal;
end;
$$;
revoke execute on function public.fn_reverse_journal_entry(uuid, text, date) from public, anon, authenticated;
grant execute on function public.fn_reverse_journal_entry(uuid, text, date) to authenticated;

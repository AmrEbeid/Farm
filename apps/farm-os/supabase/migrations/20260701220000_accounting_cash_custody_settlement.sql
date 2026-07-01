-- Farm OS — standalone accounting slice 1: cash-method custody settlement.
--
-- PROBLEM. SPEC-0018 currently stops at final owner approval. The owner clarified that approved owner funding
-- must be recorded as custody first, then each payout is confirmed from the selected holder custody. Those paid
-- amounts must then appear in the accounting system under the farm's cash method.
--
-- INTENT. Add the smallest double-entry kernel needed for custody cash: org-scoped accounts, posted journal
-- entries/lines, a trial-balance RPC, owner-funding receipt against a payment request, and request-line payment
-- confirmation from either accountant or farm-manager custody. Unpaid/debt request lines remain operational
-- pending items until payment is confirmed.
--
-- SECURITY. Finance tables are owner/accountant-readable through finance.read. Direct DML is revoked; client
-- writes go through SECURITY DEFINER RPCs with search_path=''. This migration does not broaden farm-manager app
-- access; owner/accountant users can record movements for a physical farm-manager custody holder.
--
-- CASH METHOD. Owner funding: Dr custody cash / Cr owner funding. Payment confirmation: Dr expense/capex/drawing
-- account / Cr selected custody cash. Owner drawings stay separate from operating expenses.
--
-- ROLLBACK. Drop the new RPCs/tables/columns and restore the re-emitted SPEC-0018 RPCs from 20260701140000 and
-- 20260629150000/150100. No existing production data is mutated by this draft migration.

begin;

-- ── 1) Accounting kernel ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  code text not null,
  name_ar text not null,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  normal_balance text not null check (normal_balance in ('debit','credit')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (org_id, code)
);
create index if not exists accounts_org_idx on public.accounts(org_id, code);
alter table public.accounts enable row level security;
alter table public.accounts force row level security;
drop policy if exists tenant_read on public.accounts;
create policy tenant_read on public.accounts for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.accounts to authenticated;
revoke insert, update, delete on public.accounts from authenticated, anon;
drop trigger if exists audit_account on public.accounts;
create trigger audit_account after insert or update or delete on public.accounts
  for each row execute function public.fn_audit('account');

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  entry_date date not null default current_date,
  source_type text not null,
  source_id uuid not null,
  description text,
  status text not null default 'posted' check (status in ('posted','reversed')),
  posted_at timestamptz not null default now(),
  posted_by uuid default auth.uid(),
  reversal_of uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  unique (org_id, source_type, source_id)
);
create index if not exists journal_entries_org_date_idx on public.journal_entries(org_id, entry_date desc);
create index if not exists journal_entries_source_idx on public.journal_entries(org_id, source_type, source_id);
create index if not exists journal_entries_reversal_idx on public.journal_entries(reversal_of);
alter table public.journal_entries enable row level security;
alter table public.journal_entries force row level security;
drop policy if exists tenant_read on public.journal_entries;
create policy tenant_read on public.journal_entries for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.journal_entries to authenticated;
revoke insert, update, delete on public.journal_entries from authenticated, anon;
drop trigger if exists audit_journal_entry on public.journal_entries;
create trigger audit_journal_entry after insert or update or delete on public.journal_entries
  for each row execute function public.fn_audit('journal_entry');

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  description text,
  custody_account_id uuid references public.custody_accounts(id),
  custody_movement_id uuid references public.custody_movements(id),
  expense_id uuid references public.expenses(id),
  payment_request_id uuid references public.payment_requests(id),
  created_at timestamptz not null default now(),
  constraint journal_line_one_side check ((debit > 0) <> (credit > 0))
);
create index if not exists journal_lines_org_idx on public.journal_lines(org_id);
create index if not exists journal_lines_entry_idx on public.journal_lines(journal_entry_id);
create index if not exists journal_lines_account_idx on public.journal_lines(account_id);
create index if not exists journal_lines_custody_account_idx on public.journal_lines(custody_account_id);
create index if not exists journal_lines_custody_movement_idx on public.journal_lines(custody_movement_id);
create index if not exists journal_lines_expense_idx on public.journal_lines(expense_id);
create index if not exists journal_lines_request_idx on public.journal_lines(payment_request_id);
alter table public.journal_lines enable row level security;
alter table public.journal_lines force row level security;
drop policy if exists tenant_read on public.journal_lines;
create policy tenant_read on public.journal_lines for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.journal_lines to authenticated;
revoke insert, update, delete on public.journal_lines from authenticated, anon;
drop trigger if exists audit_journal_line on public.journal_lines;
create trigger audit_journal_line after insert or update or delete on public.journal_lines
  for each row execute function public.fn_audit('journal_line');

create or replace function public.journal_lines_balance_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_debit numeric;
  v_credit numeric;
begin
  if tg_op = 'DELETE' then
    v_entry := old.journal_entry_id;
  else
    v_entry := new.journal_entry_id;
  end if;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_debit, v_credit
    from public.journal_lines
   where journal_entry_id = v_entry;

  if v_debit <> v_credit then
    raise exception 'journal entry % is unbalanced: debit %, credit %', v_entry, v_debit, v_credit
      using errcode = '22023';
  end if;
  return null;
end;
$$;
revoke execute on function public.journal_lines_balance_guard() from public, anon, authenticated;
drop trigger if exists journal_lines_balance_guard on public.journal_lines;
create constraint trigger journal_lines_balance_guard
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function public.journal_lines_balance_guard();

-- Keep finance audit mirrors restricted. Preserve the prior payroll/sale/expense/custody posture and add
-- accounting entities.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (
      (
        entity_type is distinct from 'people_compensation'
        and entity_type not in (
          'sale','expense','custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding'
        )
      )
      or (entity_type = 'people_compensation' and public.authorize('payroll.read', org_id))
      or (entity_type in ('sale','expense') and public.authorize('budget.write', org_id))
      or (
        entity_type in (
          'custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding'
        )
        and public.authorize('finance.read', org_id)
      )
    )
  );

-- ── 2) Payment request settlement links ────────────────────────────────────────────────────────────────
alter table public.custody_movements add column if not exists payment_request_id uuid references public.payment_requests(id);
alter table public.custody_movements add column if not exists journal_entry_id uuid references public.journal_entries(id);
create index if not exists custody_movements_request_idx on public.custody_movements(payment_request_id);
create index if not exists custody_movements_journal_idx on public.custody_movements(journal_entry_id);

alter table public.payment_requests add column if not exists approved_post_paid_total numeric;
alter table public.payment_requests add column if not exists approved_custody_top_up numeric;
alter table public.payment_requests add column if not exists approved_net_request numeric;

alter table public.payment_request_lines add column if not exists paid_at timestamptz;
alter table public.payment_request_lines add column if not exists paid_by text;
alter table public.payment_request_lines add column if not exists paid_from_custody_account_id uuid references public.custody_accounts(id);
alter table public.payment_request_lines add column if not exists custody_movement_id uuid references public.custody_movements(id);
alter table public.payment_request_lines add column if not exists journal_entry_id uuid references public.journal_entries(id);
create index if not exists prl_paid_from_acct_idx on public.payment_request_lines(paid_from_custody_account_id);
create index if not exists prl_custody_movement_idx on public.payment_request_lines(custody_movement_id);
create index if not exists prl_journal_entry_idx on public.payment_request_lines(journal_entry_id);

create table if not exists public.payment_request_fundings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  custody_account_id uuid not null references public.custody_accounts(id),
  custody_movement_id uuid references public.custody_movements(id),
  journal_entry_id uuid references public.journal_entries(id),
  occurred_at date not null default current_date,
  amount numeric not null check (amount > 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists payment_request_fundings_org_idx on public.payment_request_fundings(org_id, created_at);
create index if not exists payment_request_fundings_request_idx on public.payment_request_fundings(payment_request_id);
create index if not exists payment_request_fundings_account_idx on public.payment_request_fundings(custody_account_id);
create index if not exists payment_request_fundings_movement_idx on public.payment_request_fundings(custody_movement_id);
create index if not exists payment_request_fundings_journal_idx on public.payment_request_fundings(journal_entry_id);
alter table public.payment_request_fundings enable row level security;
alter table public.payment_request_fundings force row level security;
drop policy if exists tenant_read on public.payment_request_fundings;
create policy tenant_read on public.payment_request_fundings for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.payment_request_fundings to authenticated;
revoke insert, update, delete on public.payment_request_fundings from authenticated, anon;
drop trigger if exists audit_payment_request_funding on public.payment_request_fundings;
create trigger audit_payment_request_funding after insert or update or delete on public.payment_request_fundings
  for each row execute function public.fn_audit('payment_request_funding');

-- ── 3) Internal accounting helpers ─────────────────────────────────────────────────────────────────────
create or replace function public.fn_ensure_account(
  p_org uuid,
  p_code text,
  p_name_ar text,
  p_account_type text,
  p_normal_balance text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_code is null or trim(p_code) = '' then raise exception 'account code required' using errcode = '23502'; end if;
  if p_account_type not in ('asset','liability','equity','revenue','expense') then
    raise exception 'invalid account_type: %', p_account_type using errcode = '22023';
  end if;
  if p_normal_balance not in ('debit','credit') then
    raise exception 'invalid normal_balance: %', p_normal_balance using errcode = '22023';
  end if;

  insert into public.accounts(org_id, code, name_ar, account_type, normal_balance)
  values (p_org, trim(p_code), trim(p_name_ar), p_account_type, p_normal_balance)
  on conflict (org_id, code) do update
     set name_ar = excluded.name_ar,
         account_type = excluded.account_type,
         normal_balance = excluded.normal_balance,
         active = true
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.fn_ensure_account(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.fn_account_for_expense_kind(p_org uuid, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if coalesce(p_kind, 'operating') = 'capex' then
    return public.fn_ensure_account(p_org, '1500', 'أصول ومشروعات رأسمالية', 'asset', 'debit');
  elsif coalesce(p_kind, 'operating') = 'drawing' then
    return public.fn_ensure_account(p_org, '3100', 'مسحوبات المالك', 'equity', 'debit');
  elsif coalesce(p_kind, 'operating') = 'operating' then
    return public.fn_ensure_account(p_org, '5000', 'مصروفات تشغيلية', 'expense', 'debit');
  end if;
  raise exception 'invalid expense kind: %', p_kind using errcode = '22023';
end;
$$;
revoke execute on function public.fn_account_for_expense_kind(uuid, text) from public, anon, authenticated;

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
  v_existing uuid;
  v_entry uuid;
  v_debit_org uuid;
  v_credit_org uuid;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_source_type is null or trim(p_source_type) = '' then raise exception 'source_type required' using errcode = '23502'; end if;
  if p_source_id is null then raise exception 'source_id required' using errcode = '23502'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'journal amount must be positive' using errcode = '22023'; end if;

  select id into v_existing
    from public.journal_entries
   where org_id = p_org and source_type = p_source_type and source_id = p_source_id;
  if v_existing is not null then
    return v_existing;
  end if;

  select org_id into v_debit_org from public.accounts where id = p_debit_account;
  select org_id into v_credit_org from public.accounts where id = p_credit_account;
  if v_debit_org is distinct from p_org or v_credit_org is distinct from p_org then
    raise exception 'journal accounts must belong to the entry org' using errcode = '42501';
  end if;

  insert into public.journal_entries(org_id, entry_date, source_type, source_id, description)
  values (p_org, coalesce(p_entry_date, current_date), trim(p_source_type), p_source_id, p_description)
  returning id into v_entry;

  insert into public.journal_lines(
    org_id, journal_entry_id, account_id, debit, credit, description,
    custody_account_id, custody_movement_id, expense_id, payment_request_id)
  values
    (p_org, v_entry, p_debit_account, p_amount, 0, p_debit_description,
     p_custody_account, p_custody_movement, p_expense, p_payment_request),
    (p_org, v_entry, p_credit_account, 0, p_amount, p_credit_description,
     p_custody_account, p_custody_movement, p_expense, p_payment_request);

  return v_entry;
end;
$$;
revoke execute on function public.fn_post_two_line_journal(uuid, date, text, uuid, text, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- ── 4) Trial balance RPC ────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_accounting_trial_balance(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org trial balance' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'account_id', a.id,
      'code', a.code,
      'name_ar', a.name_ar,
      'account_type', a.account_type,
      'normal_balance', a.normal_balance,
      'debit', coalesce(t.debit, 0),
      'credit', coalesce(t.credit, 0),
      'net', coalesce(t.debit, 0) - coalesce(t.credit, 0)
    )
    order by a.code
  ), '[]'::jsonb)
  into v_rows
  from public.accounts a
  left join (
    select account_id, sum(debit) as debit, sum(credit) as credit
      from public.journal_lines
     where org_id = p_org
     group by account_id
  ) t on t.account_id = a.id
  where a.org_id = p_org and a.active;

  return v_rows;
end;
$$;
revoke execute on function public.fn_accounting_trial_balance(uuid) from public, anon, authenticated;
grant execute on function public.fn_accounting_trial_balance(uuid) to authenticated;

-- ── 5) Re-emit custody payment routing with all expense kinds + journal posting ────────────────────────
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
begin
  select org_id into v_org from public.custody_accounts where id = p_account;
  if v_org is null then raise exception 'custody account % not found', p_account using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody' using errcode = '42501'; end if;
  if not public.authorize('custody.write', v_org) then
    raise exception 'forbidden: custody.write is required' using errcode = '42501'; end if;
  if coalesce(p_amount_in,0) < 0 or coalesce(p_amount_out,0) < 0 then
    raise exception 'amounts must be non-negative' using errcode = '22023'; end if;
  if (coalesce(p_amount_in,0) > 0) = (coalesce(p_amount_out,0) > 0) then
    raise exception 'exactly one of amount_in / amount_out must be > 0' using errcode = '22023'; end if;

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
    if coalesce(p_amount_out,0) > 0 then
      if coalesce(v_exp_kind, 'operating') not in ('operating','drawing','capex') then
        raise exception 'invalid expense kind for custody cash out-movement (kind=%)', v_exp_kind using errcode = '22023';
      end if;
      if coalesce(v_exp_payment_status, '') <> 'paid_from_custody' then
        raise exception 'set expense payment_status to paid_from_custody through fn_set_expense_payment_status before linking a cash out-movement'
          using errcode = '22023';
      end if;
      if coalesce(p_amount_out,0) <> coalesce(v_exp_total,0) then
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

  insert into public.custody_movements(org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id, note)
  values (v_org, p_account, coalesce(p_occurred_at, current_date), p_movement_type,
          coalesce(p_amount_in,0), coalesce(p_amount_out,0), p_expense_id, p_note)
  returning id into v_id;

  if p_expense_id is null
     and coalesce(p_amount_in,0) > 0
     and p_movement_type = 'استلام عهدة من المالك' then
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
      coalesce(p_amount_in,0),
      'استلام نقدية عهدة من المالك',
      'تمويل المالك للعهدة',
      p_account,
      v_id,
      null,
      null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;

  if p_expense_id is not null and coalesce(p_amount_out,0) > 0 then
    v_debit_account := public.fn_account_for_expense_kind(v_org, v_exp_kind);
    v_credit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    v_journal := public.fn_post_two_line_journal(
      v_org,
      coalesce(p_occurred_at, current_date),
      'expense_payment',
      p_expense_id,
      'سداد مصروف من العهدة',
      v_debit_account,
      v_credit_account,
      coalesce(p_amount_out,0),
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
  if p_status in ('paid_from_custody','post_paid_unpaid') and coalesce(v_kind, 'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind for custody/request routing (kind=%)', v_kind using errcode = '22023';
  end if;

  select count(*), (array_agg(id order by created_at))[1]
    into v_existing, v_existing_movement
    from public.custody_movements
   where expense_id = p_expense and amount_out > 0;

  if p_status <> 'paid_from_custody' and v_existing > 0 then
    raise exception 'expense already has a custody cash out-movement; post a reversal before rerouting payment_status' using errcode = '22023';
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
          v_org,
          current_date,
          'expense_payment',
          p_expense,
          'سداد مصروف من العهدة',
          public.fn_account_for_expense_kind(v_org, v_kind),
          public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit'),
          coalesce(v_total,0),
          'إثبات مصروف/مسحوبات/رأسمالي عند السداد النقدي',
          'خروج نقدية من العهدة',
          (select custody_account_id from public.custody_movements where id = v_existing_movement),
          v_existing_movement,
          p_expense,
          null);
        update public.custody_movements set journal_entry_id = v_journal where id = v_existing_movement;
      end if;
    end if;
  end if;
end;
$$;
revoke execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) to authenticated;

-- ── 6) Re-emit payment request line/totals/final approval for cash-method settlement ───────────────────
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

  select org_id, kind, payment_status, paid_by
    into v_exp_org, v_exp_kind, v_exp_payment_status, v_paid_by
    from public.expenses
   where id = p_expense
   for update;
  if v_exp_org is distinct from v_org then raise exception 'forbidden: cross-org expense' using errcode='42501'; end if;
  if coalesce(v_exp_kind, 'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind for a payment request (kind=%)', v_exp_kind using errcode='22023'; end if;
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
     where m.expense_id = p_expense and m.amount_out > 0
     order by m.created_at
     limit 1;
    if v_existing_movement is null then
      raise exception 'paid_from_custody expense has no custody cash out-movement' using errcode='22023';
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
revoke execute on function public.fn_add_expense_to_request(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_add_expense_to_request(uuid, uuid) to authenticated;

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

  select
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'operating'), 0),
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'capex'), 0),
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'drawing'), 0)
  into v_operating, v_capex, v_drawing
  from public.payment_request_lines l
  join public.expenses e on e.id = l.expense_id
  where l.payment_request_id = p_request;

  v_unpaid := coalesce(v_operating,0) + coalesce(v_capex,0) + coalesce(v_drawing,0);

  if v_acct is null then
    v_target := 0;
    v_current := 0;
  else
    select coalesce(target_float,0) into v_target from public.custody_accounts where id = v_acct;
    v_current := coalesce(public.fn_custody_balance(v_acct), 0);
  end if;
  v_topup := greatest(0, coalesce(v_target,0) - v_current);
  v_gross := v_unpaid + v_topup;

  select coalesce(sum(amount),0) into v_funding
    from public.payment_request_fundings
   where payment_request_id = p_request;
  select coalesce(sum(m.amount_out),0) into v_cash_out
    from public.payment_request_lines l
    join public.custody_movements m on m.id = l.custody_movement_id
   where l.payment_request_id = p_request;

  v_snapshot := coalesce(v_approved_net, v_gross);
  v_remaining := greatest(0, v_snapshot - coalesce(v_funding,0));

  return jsonb_build_object(
    'operating_unpaid', coalesce(v_operating,0),
    'capex_unpaid', coalesce(v_capex,0),
    'drawing_unpaid', coalesce(v_drawing,0),
    'post_paid_unpaid', v_unpaid,
    'target_float', coalesce(v_target,0),
    'current_custody', v_current,
    'custody_top_up', v_topup,
    'gross_request', v_gross,
    'approved_post_paid_total', coalesce(v_approved_post_paid,0),
    'approved_custody_top_up', coalesce(v_approved_topup,0),
    'approved_net_request', coalesce(v_approved_net,0),
    'owner_funding_received', coalesce(v_funding,0),
    'request_cash_out', coalesce(v_cash_out,0),
    'remaining_to_fund', v_remaining,
    'net_request', v_remaining);
end;
$$;
revoke execute on function public.fn_payment_request_totals(uuid) from public, anon, authenticated;
grant  execute on function public.fn_payment_request_totals(uuid) to authenticated;

create or replace function public.fn_approve_request_final(p_request uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid;
  v_status text;
  v_totals jsonb;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.approve.final', v_org) then raise exception 'forbidden: request.approve.final (owner only)' using errcode='42501'; end if;
  if v_status <> 'approved_operational' then raise exception 'only an operationally-approved request can be finalized (is %)', v_status using errcode='22023'; end if;

  v_totals := public.fn_payment_request_totals(p_request);
  update public.payment_requests
     set status = case
           when (v_totals ->> 'gross_request')::numeric <= 0 then 'paid'
           else 'approved_final'
         end,
         approved_final_by=(select auth.uid()),
         approved_final_at=now(),
         approved_post_paid_total=(v_totals ->> 'post_paid_unpaid')::numeric,
         approved_custody_top_up=(v_totals ->> 'custody_top_up')::numeric,
         approved_net_request=(v_totals ->> 'gross_request')::numeric
   where id=p_request and status='approved_operational';
  if not found then raise exception 'request % is no longer operationally-approved (concurrent transition)', p_request using errcode='40001'; end if;
end; $$;
revoke execute on function public.fn_approve_request_final(uuid) from public, anon, authenticated;
grant execute on function public.fn_approve_request_final(uuid) to authenticated;

-- ── 7) Owner funding and payment confirmation RPCs ────────────────────────────────────────────────────
create or replace function public.fn_record_payment_request_funding(
  p_request uuid,
  p_custody_account uuid,
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
  v_org uuid;
  v_status text;
  v_acct_org uuid;
  v_acct_active boolean;
  v_totals jsonb;
  v_remaining numeric;
  v_funding_id uuid;
  v_movement_id uuid;
  v_journal_id uuid;
  v_debit_account uuid;
  v_credit_account uuid;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request for update;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org request' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then raise exception 'forbidden: request.prepare is required' using errcode='42501'; end if;
  if v_status not in ('approved_final','paid') then
    raise exception 'owner funding can be recorded only after final approval (status=%)', v_status using errcode='22023';
  end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'funding amount must be positive' using errcode='22023'; end if;

  select org_id, active into v_acct_org, v_acct_active from public.custody_accounts where id = p_custody_account;
  if v_acct_org is distinct from v_org then raise exception 'forbidden: cross-org custody account' using errcode='42501'; end if;
  if not coalesce(v_acct_active, false) then raise exception 'custody account is inactive' using errcode='22023'; end if;

  v_totals := public.fn_payment_request_totals(p_request);
  v_remaining := (v_totals ->> 'remaining_to_fund')::numeric;
  if p_amount > v_remaining then
    raise exception 'funding amount % exceeds remaining request amount %', p_amount, v_remaining using errcode='22023';
  end if;

  insert into public.custody_movements(
    org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, payment_request_id, note)
  values (
    v_org, p_custody_account, coalesce(p_occurred_at, current_date), 'استلام تمويل من المالك لطلب صرف',
    p_amount, 0, p_request, p_note)
  returning id into v_movement_id;

  insert into public.payment_request_fundings(
    org_id, payment_request_id, custody_account_id, custody_movement_id, occurred_at, amount, note)
  values (v_org, p_request, p_custody_account, v_movement_id, coalesce(p_occurred_at, current_date), p_amount, p_note)
  returning id into v_funding_id;

  v_debit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
  v_credit_account := public.fn_ensure_account(v_org, '3000', 'تمويل المالك', 'equity', 'credit');
  v_journal_id := public.fn_post_two_line_journal(
    v_org,
    coalesce(p_occurred_at, current_date),
    'payment_request_funding',
    v_funding_id,
    'استلام تمويل من المالك لطلب صرف',
    v_debit_account,
    v_credit_account,
    p_amount,
    'استلام نقدية عهدة من المالك',
    'تمويل المالك لطلب صرف',
    p_custody_account,
    v_movement_id,
    null,
    p_request);

  update public.custody_movements set journal_entry_id = v_journal_id where id = v_movement_id;
  update public.payment_request_fundings set journal_entry_id = v_journal_id where id = v_funding_id;
  update public.payment_requests
     set status = case
       when ((public.fn_payment_request_totals(p_request) ->> 'remaining_to_fund')::numeric) <= 0 then 'paid'
       else status
     end
   where id = p_request;

  return v_funding_id;
end;
$$;
revoke execute on function public.fn_record_payment_request_funding(uuid, uuid, numeric, date, text) from public, anon, authenticated;
grant execute on function public.fn_record_payment_request_funding(uuid, uuid, numeric, date, text) to authenticated;

create or replace function public.fn_confirm_request_expense_paid(
  p_request uuid,
  p_expense uuid,
  p_custody_account uuid,
  p_occurred_at date default current_date,
  p_paid_by text default null,
  p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_line uuid;
  v_line_paid_at timestamptz;
  v_exp_org uuid;
  v_exp_total numeric;
  v_exp_kind text;
  v_exp_payment_status text;
  v_acct_org uuid;
  v_acct_active boolean;
  v_movement_id uuid;
  v_journal_id uuid;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request for update;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org request' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then raise exception 'forbidden: request.prepare is required' using errcode='42501'; end if;
  if v_status <> 'paid' then raise exception 'request must be funded before confirming payouts (status=%)', v_status using errcode='22023'; end if;

  select id, paid_at into v_line, v_line_paid_at
    from public.payment_request_lines
   where payment_request_id = p_request and expense_id = p_expense
   for update;
  if v_line is null then raise exception 'expense is not on this payment request' using errcode='P0002'; end if;
  if v_line_paid_at is not null then raise exception 'payment request line is already paid' using errcode='22023'; end if;

  select org_id, total, kind, payment_status
    into v_exp_org, v_exp_total, v_exp_kind, v_exp_payment_status
    from public.expenses
   where id = p_expense
   for update;
  if v_exp_org is distinct from v_org then raise exception 'forbidden: cross-org expense' using errcode='42501'; end if;
  if coalesce(v_exp_payment_status, '') <> 'post_paid_unpaid' then
    raise exception 'only post_paid_unpaid request lines can be confirmed paid (payment_status=%)', v_exp_payment_status using errcode='22023';
  end if;

  select org_id, active into v_acct_org, v_acct_active from public.custody_accounts where id = p_custody_account;
  if v_acct_org is distinct from v_org then raise exception 'forbidden: cross-org custody account' using errcode='42501'; end if;
  if not coalesce(v_acct_active, false) then raise exception 'custody account is inactive' using errcode='22023'; end if;

  update public.expenses
     set payment_status = 'paid_from_custody',
         paid_by = p_paid_by
   where id = p_expense;

  v_movement_id := public.fn_record_custody_movement(
    p_custody_account,
    'صرف نقدي لطلب صرف',
    0,
    v_exp_total,
    coalesce(p_occurred_at, current_date),
    p_expense,
    p_note);

  select journal_entry_id into v_journal_id from public.custody_movements where id = v_movement_id;
  update public.custody_movements set payment_request_id = p_request where id = v_movement_id;
  update public.journal_lines set payment_request_id = p_request where custody_movement_id = v_movement_id;

  update public.payment_request_lines
     set paid_at = now(),
         paid_by = p_paid_by,
         paid_from_custody_account_id = p_custody_account,
         custody_movement_id = v_movement_id,
         journal_entry_id = v_journal_id
   where id = v_line;

  return v_line;
end;
$$;
revoke execute on function public.fn_confirm_request_expense_paid(uuid, uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.fn_confirm_request_expense_paid(uuid, uuid, uuid, date, text, text) to authenticated;

create or replace function public.fn_close_payment_request(p_request uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_unpaid int;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request for update;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org request' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then raise exception 'forbidden: request.prepare is required' using errcode='42501'; end if;
  if v_status <> 'paid' then raise exception 'only a funded request can be closed (status=%)', v_status using errcode='22023'; end if;

  select count(*) into v_unpaid
    from public.payment_request_lines
   where payment_request_id = p_request and paid_at is null;
  if v_unpaid > 0 then
    raise exception 'cannot close request with % unpaid line(s)', v_unpaid using errcode='22023';
  end if;

  update public.payment_requests set status = 'closed' where id = p_request and status = 'paid';
  if not found then raise exception 'request % is no longer paid (concurrent transition)', p_request using errcode='40001'; end if;
end;
$$;
revoke execute on function public.fn_close_payment_request(uuid) from public, anon, authenticated;
grant execute on function public.fn_close_payment_request(uuid) to authenticated;

commit;

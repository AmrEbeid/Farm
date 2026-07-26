-- Accounting reconciliation expense execution.
--
-- This slice executes only approved, frozen EXPENSE rows. It uses one inner
-- PL/pgSQL subtransaction for every financial write in the batch. On failure,
-- the inner block rolls back in full and the outer block persists only a safe
-- batch-level failure code and batch-row UUID locator.
--
-- No real reconciliation batch is executed by this migration.

begin;

alter table public.expenses
  drop constraint if exists expenses_payment_status_check;
alter table public.expenses
  add constraint expenses_payment_status_check
  check (
    payment_status is null
    or payment_status in (
      'paid_from_custody', 'post_paid_unpaid', 'paid_by_owner', 'cancelled',
      'historical_treasury', 'historical_reversed'
    )
  );

alter table public.reconciliation_batch_rows
  drop constraint if exists reconciliation_batch_rows_expense_payment_decision_check;
alter table public.reconciliation_batch_rows
  add constraint reconciliation_batch_rows_expense_payment_decision_check
  check (
    (expense_payment_decision is null or expense_payment_decision = 'routed_now')
    and (
      target_table is distinct from 'expenses'
      or disposition is distinct from 'include'
      or expense_payment_decision is not distinct from 'routed_now'
    )
  );

insert into public.accounts(
  org_id, code, name_ar, account_type, normal_balance, parent_id,
  kind, is_system, sort_order, active
)
select
  custody.org_id, '1010', 'النقدية بالخزينة', 'asset', 'debit',
  custody.parent_id, null, true, 15, true
  from public.accounts custody
 where custody.code = '1000'
   and not exists (
     select 1 from public.accounts treasury
      where treasury.org_id = custody.org_id
        and treasury.code = '1010'
   );

create or replace function private.fn_ensure_general_treasury_account(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.accounts(
    org_id, code, name_ar, account_type, normal_balance, parent_id,
    kind, is_system, sort_order, active
  )
  select
    p_org, '1010', 'النقدية بالخزينة', 'asset', 'debit',
    custody.parent_id, null, true, 15, true
    from public.accounts custody
   where custody.org_id = p_org
     and custody.code = '1000'
     and not exists (
       select 1 from public.accounts treasury
        where treasury.org_id = p_org
          and treasury.code = '1010'
     );
$$;

revoke execute on function private.fn_ensure_general_treasury_account(uuid)
  from public, anon, authenticated;

create or replace function private.fn_seed_general_treasury_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.fn_ensure_general_treasury_account(new.id);
  return new;
end;
$$;

revoke execute on function private.fn_seed_general_treasury_account()
  from public, anon, authenticated;

drop trigger if exists zz_seed_general_treasury_account
  on public.organization;
create trigger zz_seed_general_treasury_account
  after insert on public.organization
  for each row execute function private.fn_seed_general_treasury_account();

create or replace function private.fn_guard_historical_treasury_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.payment_status = 'historical_reversed' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'reversed historical expense is immutable'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if new.payment_status in ('historical_treasury', 'historical_reversed')
     and new.payment_status is distinct from old.payment_status
     and to_jsonb(new) - array['payment_status']::text[]
       is distinct from to_jsonb(old) - array['payment_status']::text[] then
    raise exception 'historical reconciliation transition cannot alter expense fields'
      using errcode = '22023';
  end if;

  if new.payment_status = 'historical_treasury'
     and old.payment_status is distinct from 'historical_treasury' then
    if not exists (
      select 1
        from public.journal_entries je
        join public.journal_lines cash_line
          on cash_line.journal_entry_id = je.id
        join public.accounts cash_account
          on cash_account.id = cash_line.account_id
         and cash_account.org_id = old.org_id
         and cash_account.code = '1010'
       where je.org_id = old.org_id
         and je.source_type = 'expense'
         and je.source_id = old.id
         and je.status = 'posted'
         and cash_line.credit = old.total
         and cash_line.debit = 0
    ) then
      raise exception 'historical treasury status requires a matching posted treasury journal'
        using errcode = '22023';
    end if;
  end if;

  if new.payment_status = 'historical_reversed'
     and old.payment_status is distinct from 'historical_reversed' then
    if not exists (
      select 1
        from public.reconciliation_action_links al
        join public.journal_entries reversal
          on reversal.id = al.journal_entry_id
        join public.journal_entries original
          on original.id = reversal.reversal_of
       where al.org_id = old.org_id
         and al.target_table = 'expenses'
         and al.target_id = old.id
         and al.action_kind = 'correction_reversal'
         and original.org_id = old.org_id
         and original.source_type = 'expense'
         and original.source_id = old.id
    ) then
      raise exception 'historical reversed status requires a verified reconciliation reversal'
        using errcode = '22023';
    end if;
  end if;

  if old.payment_status is distinct from 'historical_treasury' then
    return new;
  end if;

  if to_jsonb(new) - array['payment_status']::text[]
       is distinct from to_jsonb(old) - array['payment_status']::text[] then
    raise exception 'posted historical treasury expense is immutable'
      using errcode = '22023';
  end if;

  if new.payment_status is distinct from old.payment_status
     and new.payment_status <> 'historical_reversed' then
    raise exception 'historical treasury reconciliation must be reversed, not rerouted'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function private.fn_guard_historical_treasury_expense()
  from public, anon, authenticated;

drop trigger if exists guard_historical_treasury_expense
  on public.expenses;
create trigger guard_historical_treasury_expense
  before update on public.expenses
  for each row execute function private.fn_guard_historical_treasury_expense();

-- Expense-based owner P&L excludes both ordinary cancellations and verified historical reversals.
create or replace function public.fn_owner_pnl_summary(
  p_org uuid, p_from date, p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_operating numeric;
  v_drawings numeric;
  v_capex numeric;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid period: % .. %', p_from, p_to using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org P&L request' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  select
    coalesce(sum(total) filter (where kind = 'operating'), 0),
    coalesce(sum(total) filter (where kind = 'drawing'), 0),
    coalesce(sum(total) filter (where kind = 'capex'), 0)
    into v_operating, v_drawings, v_capex
    from public.expenses
   where org_id = p_org
     and date >= p_from
     and date <= p_to
     and coalesce(payment_status, '') not in ('cancelled', 'historical_reversed');

  return jsonb_build_object(
    'period_start', p_from,
    'period_end', p_to,
    'operating_expenses', v_operating,
    'owner_drawings', v_drawings,
    'capex', v_capex
  );
end;
$$;

revoke execute on function public.fn_owner_pnl_summary(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_owner_pnl_summary(uuid, date, date)
  to authenticated;

create or replace function private.fn_reconciliation_execution_payload_hash(
  p_row public.reconciliation_batch_rows
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  return encode(sha256(convert_to(jsonb_build_object(
    'evidence_item_id', p_row.evidence_item_id,
    'target_table', p_row.target_table,
    'disposition', p_row.disposition,
    'expense_category', p_row.expense_category,
    'expense_description', p_row.expense_description,
    'expense_kind', p_row.expense_kind,
    'expense_account_id', p_row.expense_account_id,
    'expense_cost_center_id', p_row.expense_cost_center_id,
    'expense_supplier_id', p_row.expense_supplier_id,
    'expense_payment_decision', p_row.expense_payment_decision,
    'sale_crop', p_row.sale_crop,
    'sale_quantity', p_row.sale_quantity,
    'sale_unit', p_row.sale_unit,
    'sale_unit_price', p_row.sale_unit_price,
    'sale_recorded_total', p_row.sale_recorded_total,
    'sale_buyer_id', p_row.sale_buyer_id,
    'sale_cost_center_id', p_row.sale_cost_center_id,
    'sale_farm_id', p_row.sale_farm_id,
    'sale_sector_id', p_row.sale_sector_id,
    'sale_hawsha_id', p_row.sale_hawsha_id,
    'sale_season', p_row.sale_season,
    'sale_delivery_date', p_row.sale_delivery_date,
    'sale_notes', p_row.sale_notes,
    'sale_historical_date_decision', p_row.sale_historical_date_decision,
    'sale_effective_date', p_row.sale_effective_date,
    'corrects_expense_id', p_row.corrects_expense_id,
    'corrects_sale_id', p_row.corrects_sale_id
  )::text, 'UTF8')), 'hex');
end;
$$;
revoke execute on function private.fn_reconciliation_execution_payload_hash(
  public.reconciliation_batch_rows
) from public, anon, authenticated;

create unique index if not exists reconciliation_baselines_batch_uq
  on public.reconciliation_baselines(batch_id);

create or replace function public.fn_execute_reconciliation_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_status text;
  v_failure boolean := false;
  v_failure_code text;
  v_sqlstate text;
  v_last_safe_row_locator uuid;
  v_cash_account uuid;
  v_expenses_count integer;
  v_expenses_total numeric;
  v_journal_count integer;
  v_row_hash_set jsonb;
  v_journal_hash_set jsonb;
  v_new_expense_id uuid;
  v_new_journal_id uuid;
  v_original_journal_id uuid;
  v_reversal_journal_id uuid;
  v_ledger_id uuid;
  v_executed_count integer := 0;
  v_skipped_count integer := 0;
  v_expected_domain_total numeric := 0;
  v_actual_domain_total numeric := 0;
  v_expected_domain_count integer := 0;
  v_actual_domain_count integer := 0;
  v_expected_posted_journal_delta integer := 0;
  v_dimension_id uuid;
  v_result jsonb;
  r record;
  v_batch_row public.reconciliation_batch_rows%rowtype;
begin
  if p_batch_id is null then
    raise exception 'batch id required' using errcode = '23502';
  end if;

  select b.org_id, b.status
    into v_org, v_status
    from public.reconciliation_batches b
   where b.id = p_batch_id
   for update;

  if v_org is null then
    raise exception 'reconciliation batch not found' using errcode = 'P0002';
  end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org reconciliation batch' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.organization_member m
     where m.org_id = v_org
       and m.user_id = v_uid
       and m.role = 'owner'
  ) or not public.authorize('reconciliation.write', v_org) then
    raise exception 'forbidden: only an owner may execute reconciliation' using errcode = '42501';
  end if;

  if v_status in ('executed', 'failed', 'rolled_back') then
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', v_status,
      'idempotent', true
    );
  end if;
  if v_status <> 'approved' then
    raise exception 'only an approved reconciliation batch may execute' using errcode = '22023';
  end if;

  update public.reconciliation_batches
     set status = 'executing',
         result_summary = null
   where id = p_batch_id;

  begin
    if exists (
      select 1
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and (
           br.review_state <> 'frozen'
           or br.frozen is distinct from true
           or br.payload_hash is null
         )
    ) then
      raise exception 'included rows must be frozen' using errcode = '22023';
    end if;

    if exists (
      select 1
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and br.target_table is distinct from 'expenses'
    ) then
      raise exception 'expense execution slice cannot execute another domain' using errcode = '22023';
    end if;

    for v_batch_row in
      select br.*
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
       order by br.evidence_item_id
       for update
    loop
      if private.fn_reconciliation_execution_payload_hash(v_batch_row)
           is distinct from v_batch_row.payload_hash then
        v_last_safe_row_locator := v_batch_row.id;
        raise exception 'frozen payload drift' using errcode = '23514';
      end if;
    end loop;

    select a.id
      into v_cash_account
      from public.accounts a
     where a.org_id = v_org
       and a.code = '1010'
       and a.active
     for update;
    if v_cash_account is null then
      raise exception 'cash posting account is unavailable' using errcode = '23514';
    end if;

    perform 1
      from public.reconciliation_batch_rows br
      join public.expenses e
        on e.id = br.corrects_expense_id
       and e.org_id = br.org_id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by e.id
     for update of e;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'expense'
       and je.source_id = br.corrects_expense_id
       and je.status = 'posted'
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by je.id
     for update of je;

    perform 1
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'expense'
       and je.source_id = br.corrects_expense_id
       and je.status = 'posted'
      join public.journal_lines jl on jl.journal_entry_id = je.id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null
     order by jl.id
     for update of jl;

    select count(*)::integer, coalesce(sum(e.total), 0)
      into v_expenses_count, v_expenses_total
      from public.expenses e
     where e.org_id = v_org;

    select count(*)::integer
      into v_journal_count
      from public.journal_entries je
     where je.org_id = v_org
       and je.status = 'posted';

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'original_payment_status', e.payment_status,
        'hash', encode(sha256(convert_to(jsonb_build_object(
          'id', e.id,
          'org_id', e.org_id,
          'date', e.date,
          'farm_id', e.farm_id,
          'sector_id', e.sector_id,
          'hawsha_id', e.hawsha_id,
          'event_id', e.event_id,
          'plan_id', e.plan_id,
          'category', e.category,
          'description', e.description,
          'supplier_id', e.supplier_id,
          'qty', e.qty,
          'unit', e.unit,
          'unit_price', e.unit_price,
          'total', e.total,
          'payment_method', e.payment_method,
          'recorded_by', e.recorded_by,
          'approved_by', e.approved_by,
          'status', e.status,
          'payment_status', 'historical_reversed',
          'paid_by', e.paid_by,
          'kind', e.kind,
          'account_id', e.account_id,
          'cost_center_id', e.cost_center_id,
          'corrects_expense_id', e.corrects_expense_id,
          'reversed_by_rollback_at', e.reversed_by_rollback_at
        )::text, 'UTF8')), 'hex')
      ) order by e.id
    ), '[]'::jsonb)
      into v_row_hash_set
      from public.reconciliation_batch_rows br
      join public.expenses e
        on e.id = br.corrects_expense_id
       and e.org_id = br.org_id
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', je.id,
        'hash', encode(sha256(convert_to(jsonb_build_object(
          'id', je.id,
          'entry_date', je.entry_date,
          'source_type', je.source_type,
          'source_id', je.source_id,
          'source_sequence', je.source_sequence,
          'status', je.status,
          'lines', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', line.id,
              'line_ordinal', line.line_ordinal,
              'account_id', line.account_id,
              'debit', line.debit,
              'credit', line.credit,
              'cost_center_id', line.cost_center_id,
              'expense_id', line.expense_id
            ) order by line.line_ordinal), '[]'::jsonb)
              from (
                select jl.*, row_number() over (order by jl.id)::integer as line_ordinal
                  from public.journal_lines jl
                 where jl.journal_entry_id = je.id
              ) line
          )
        )::text, 'UTF8')), 'hex')
      ) order by je.id
    ), '[]'::jsonb)
      into v_journal_hash_set
      from public.reconciliation_batch_rows br
      join public.journal_entries je
        on je.org_id = br.org_id
       and je.source_type = 'expense'
       and je.source_id = br.corrects_expense_id
       and je.status = 'posted'
     where br.batch_id = p_batch_id
       and br.disposition = 'include'
       and br.corrects_expense_id is not null;

    insert into public.reconciliation_baselines(
      org_id, batch_id, expenses_count, expenses_total, sales_count, sales_total,
      journal_entries_count, row_hash_set, journal_hash_set
    )
    values (
      v_org, p_batch_id, v_expenses_count, v_expenses_total, 0, 0,
      v_journal_count, v_row_hash_set, v_journal_hash_set
    );

    for r in
      select je.*
        from public.reconciliation_batch_rows br
        join public.journal_entries je
          on je.org_id = br.org_id
         and je.source_type = 'expense'
         and je.source_id = br.corrects_expense_id
         and je.status = 'posted'
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
         and br.corrects_expense_id is not null
       order by je.id
       for update of je
    loop
      insert into public.reconciliation_baseline_journal_headers(
        org_id, batch_id, original_journal_entry_id, entry_date, source_type,
        source_id, source_sequence, description, status, posted_at, posted_by,
        reversal_of, canonical_hash
      )
      values (
        r.org_id, p_batch_id, r.id, r.entry_date, r.source_type,
        r.source_id, r.source_sequence, r.description, r.status, r.posted_at,
        r.posted_by, r.reversal_of,
        encode(sha256(convert_to(jsonb_build_object(
          'original_journal_entry_id', r.id,
          'entry_date', r.entry_date,
          'source_type', r.source_type,
          'source_id', r.source_id,
          'source_sequence', r.source_sequence,
          'description', r.description,
          'status', r.status,
          'posted_at', r.posted_at,
          'posted_by', r.posted_by,
          'reversal_of', r.reversal_of
        )::text, 'UTF8')), 'hex')
      )
      returning id into v_ledger_id;

      insert into public.reconciliation_baseline_journal_lines(
        org_id, baseline_journal_header_id, original_journal_line_id,
        line_ordinal, account_id, debit, credit, description, cost_center_id,
        custody_account_id, custody_movement_id, expense_id,
        payment_request_id, canonical_hash
      )
      select
        line.org_id, v_ledger_id, line.id, line.line_ordinal, line.account_id,
        line.debit, line.credit, line.description, line.cost_center_id,
        line.custody_account_id, line.custody_movement_id, line.expense_id,
        line.payment_request_id,
        encode(sha256(convert_to(jsonb_build_object(
          'original_journal_line_id', line.id,
          'line_ordinal', line.line_ordinal,
          'account_id', line.account_id,
          'debit', line.debit,
          'credit', line.credit,
          'description', line.description,
          'cost_center_id', line.cost_center_id,
          'custody_account_id', line.custody_account_id,
          'custody_movement_id', line.custody_movement_id,
          'expense_id', line.expense_id,
          'payment_request_id', line.payment_request_id
        )::text, 'UTF8')), 'hex')
        from (
          select jl.*, row_number() over (order by jl.id)::integer as line_ordinal
            from public.journal_lines jl
           where jl.journal_entry_id = r.id
        ) line
       order by line.line_ordinal;
    end loop;

    for v_batch_row in
      select br.*
        from public.reconciliation_batch_rows br
       where br.batch_id = p_batch_id
         and br.disposition = 'include'
       order by br.evidence_item_id
       for update
    loop
      v_last_safe_row_locator := v_batch_row.id;

      select l.id
        into v_ledger_id
        from public.reconciliation_execution_ledger l
       where l.evidence_item_id = v_batch_row.evidence_item_id
         and l.status = 'executed'
       for update;

      if v_ledger_id is not null then
        update public.reconciliation_batch_rows
           set execution_result = 'skipped',
               execution_error = null
         where id = v_batch_row.id;
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      select ei.source_amount, ei.source_date_parsed, ei.classification,
             ei.invalid_calendar_quality_flag
        into r
        from public.reconciliation_evidence_items ei
       where ei.id = v_batch_row.evidence_item_id
         and ei.org_id = v_org;

      if r.source_amount is null
        or r.source_date_parsed is null
        or coalesce(r.invalid_calendar_quality_flag, false)
        or r.source_amount < 0
        or round(r.source_amount, 2) is distinct from r.source_amount
      then
        raise exception 'source amount or date is not executable' using errcode = '23514';
      end if;

      select a.id
        into v_dimension_id
        from public.accounts a
       where a.id = v_batch_row.expense_account_id
         and a.org_id = v_org
         and a.active
         and a.kind = v_batch_row.expense_kind
         and not exists (
           select 1
             from public.accounts child
            where child.parent_id = a.id
              and child.org_id = v_org
              and child.active
         )
       for update;
      if v_dimension_id is null then
        raise exception 'reviewed expense account is not executable' using errcode = '23514';
      end if;
      if v_batch_row.expense_cost_center_id is not null and not exists (
        select 1 from public.cost_centers c
         where c.id = v_batch_row.expense_cost_center_id and c.org_id = v_org
      ) then
        raise exception 'reviewed cost center is not executable' using errcode = '23514';
      end if;
      if v_batch_row.expense_supplier_id is not null and not exists (
        select 1 from public.suppliers s
         where s.id = v_batch_row.expense_supplier_id and s.org_id = v_org
      ) then
        raise exception 'reviewed supplier is not executable' using errcode = '23514';
      end if;

      if v_batch_row.corrects_expense_id is not null then
        if exists (
          select 1
            from public.expenses target
           where target.id = v_batch_row.corrects_expense_id
             and (
               target.payment_status is not null
               and target.payment_status <> 'historical_treasury'
             )
        ) or exists (
          select 1
            from public.custody_movements movement
           where movement.expense_id = v_batch_row.corrects_expense_id
        ) or exists (
          select 1
            from public.payment_request_lines request_line
           where request_line.expense_id = v_batch_row.corrects_expense_id
        ) or exists (
          select 1
            from public.journal_entries payment_journal
           where payment_journal.org_id = v_org
             and payment_journal.source_type = 'expense_payment'
             and payment_journal.source_id = v_batch_row.corrects_expense_id
        ) then
          raise exception 'correction target has another payment path'
            using errcode = '23514';
        end if;

        select je.id
          into v_original_journal_id
          from public.journal_entries je
         where je.org_id = v_org
           and je.source_type = 'expense'
           and je.source_id = v_batch_row.corrects_expense_id
           and je.status = 'posted'
         order by je.source_sequence desc
         limit 1
         for update;
        if v_original_journal_id is null then
          raise exception 'correction target has no posted journal' using errcode = '23514';
        end if;
        if not exists (
          select 1
            from public.expenses target
           where target.id = v_batch_row.corrects_expense_id
             and target.org_id = v_org
             and target.total > 0
             and target.account_id is not null
             and (
               select count(*)
                 from public.journal_lines line
                where line.journal_entry_id = v_original_journal_id
             ) = 2
             and exists (
               select 1
                 from public.journal_lines debit_line
                where debit_line.journal_entry_id = v_original_journal_id
                  and debit_line.account_id = target.account_id
                  and debit_line.expense_id = target.id
                  and debit_line.debit = target.total
                  and debit_line.credit = 0
             )
             and exists (
               select 1
                 from public.journal_lines cash_line
                 join public.accounts cash_account
                   on cash_account.id = cash_line.account_id
                  and cash_account.org_id = target.org_id
                  and cash_account.code = '1010'
                where cash_line.journal_entry_id = v_original_journal_id
                  and cash_line.expense_id = target.id
                  and cash_line.debit = 0
                  and cash_line.credit = target.total
             )
        ) then
          raise exception 'correction target expense and journal do not match'
            using errcode = '23514';
        end if;

        v_reversal_journal_id := public.fn_reverse_journal_entry(
          v_original_journal_id,
          coalesce(nullif(v_batch_row.review_reason, ''), 'approved reconciliation correction'),
          r.source_date_parsed
        );
        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id, 'correction_reversal',
          'expenses', v_batch_row.corrects_expense_id, v_reversal_journal_id
        );
        update public.expenses
           set payment_status = 'historical_reversed'
         where id = v_batch_row.corrects_expense_id
           and org_id = v_org;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta - 1;
      end if;

      if r.source_amount = 0 then
        if v_batch_row.corrects_expense_id is null then
          insert into public.reconciliation_action_links(
            org_id, batch_id, batch_row_id, action_kind
          )
          values (v_org, p_batch_id, v_batch_row.id, 'zero_value_noop');
        end if;
        update public.reconciliation_batch_rows
           set execution_result = case
                 when v_batch_row.corrects_expense_id is null then 'skipped'
                 else 'reversed'
               end,
               execution_error = null
         where id = v_batch_row.id;
      else
        if v_batch_row.expense_payment_decision is distinct from 'routed_now' then
          raise exception 'positive historical expense must be routed to treasury'
            using errcode = '23514';
        end if;

        v_result := public.fn_save_expense(
          null, v_org, r.source_date_parsed, v_batch_row.expense_category,
          r.source_amount, v_batch_row.expense_description,
          v_batch_row.expense_supplier_id, v_batch_row.expense_kind,
          v_batch_row.expense_account_id, v_batch_row.expense_cost_center_id
        );
        v_new_expense_id := (v_result->>'id')::uuid;
        if v_new_expense_id is null then
          raise exception 'expense save returned no id' using errcode = '23514';
        end if;

        if v_batch_row.corrects_expense_id is not null then
          update public.expenses
             set corrects_expense_id = v_batch_row.corrects_expense_id
           where id = v_new_expense_id
             and org_id = v_org;
        end if;

        v_new_journal_id := public.fn_post_two_line_journal(
          v_org, r.source_date_parsed, 'expense', v_new_expense_id,
          left(coalesce(v_batch_row.expense_description, ''), 500),
          v_batch_row.expense_account_id, v_cash_account, r.source_amount,
          null, null, null, null, v_new_expense_id, null
        );

        update public.expenses
           set payment_status = 'historical_treasury'
         where id = v_new_expense_id
           and org_id = v_org;

        insert into public.reconciliation_action_links(
          org_id, batch_id, batch_row_id, action_kind, target_table,
          target_id, journal_entry_id
        )
        values (
          v_org, p_batch_id, v_batch_row.id,
          case when v_batch_row.corrects_expense_id is null
            then 'addition' else 'correction_replacement' end,
          'expenses', v_new_expense_id, v_new_journal_id
        );

        update public.reconciliation_batch_rows
           set execution_result = case
                 when v_batch_row.corrects_expense_id is null then 'posted'
                 else 'reversed'
               end,
               execution_error = null
         where id = v_batch_row.id;

        v_expected_domain_total := v_expected_domain_total + r.source_amount;
        v_expected_domain_count := v_expected_domain_count + 1;
        v_expected_posted_journal_delta :=
          v_expected_posted_journal_delta + 1;
      end if;

      select l.id
        into v_ledger_id
        from public.reconciliation_execution_ledger l
       where l.evidence_item_id = v_batch_row.evidence_item_id
         and l.status = 'unexecuted'
       order by l.id
       limit 1
       for update;

      if v_ledger_id is null then
        insert into public.reconciliation_execution_ledger(
          org_id, evidence_item_id, status, executed_by_batch_row_id, executed_at
        )
        values (
          v_org, v_batch_row.evidence_item_id, 'executed',
          v_batch_row.id, now()
        );
      else
        update public.reconciliation_execution_ledger
           set status = 'executed',
               executed_by_batch_row_id = v_batch_row.id,
               executed_at = now(),
               reversed_at = null
         where id = v_ledger_id;
      end if;
      v_executed_count := v_executed_count + 1;
    end loop;

    select count(*)::integer, coalesce(sum(e.total), 0)
      into v_actual_domain_count, v_actual_domain_total
      from public.reconciliation_action_links al
      join public.expenses e
        on al.target_table = 'expenses'
       and al.target_id = e.id
       and e.org_id = al.org_id
     where al.batch_id = p_batch_id
       and al.action_kind in ('addition', 'correction_replacement');

    if v_actual_domain_count is distinct from v_expected_domain_count
      or round(v_actual_domain_total, 2)
           is distinct from round(v_expected_domain_total, 2)
    then
      raise exception 'domain postflight mismatch' using errcode = '23514';
    end if;

    if (
      select count(*) from public.expenses e where e.org_id = v_org
    ) is distinct from v_expenses_count + v_expected_domain_count
      or round((
        select coalesce(sum(e.total), 0)
          from public.expenses e
         where e.org_id = v_org
      ), 2) is distinct from round(
        v_expenses_total + v_expected_domain_total, 2
      )
      or (
        select count(*)
          from public.journal_entries je
         where je.org_id = v_org
           and je.status = 'posted'
      ) is distinct from v_journal_count + v_expected_posted_journal_delta
    then
      raise exception 'organization accounting baseline delta mismatch'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links al
        join public.journal_lines jl on jl.journal_entry_id = al.journal_entry_id
       where al.batch_id = p_batch_id
       group by al.journal_entry_id
      having round(sum(jl.debit), 2) is distinct from round(sum(jl.credit), 2)
    ) then
      raise exception 'journal postflight mismatch' using errcode = '23514';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(v_row_hash_set) baseline_row
        join public.expenses e on e.id = (baseline_row->>'id')::uuid
       where baseline_row->>'hash' is distinct from encode(sha256(convert_to(jsonb_build_object(
         'id', e.id,
         'org_id', e.org_id,
         'date', e.date,
         'farm_id', e.farm_id,
         'sector_id', e.sector_id,
         'hawsha_id', e.hawsha_id,
         'event_id', e.event_id,
         'plan_id', e.plan_id,
         'category', e.category,
         'description', e.description,
         'supplier_id', e.supplier_id,
         'qty', e.qty,
         'unit', e.unit,
         'unit_price', e.unit_price,
         'total', e.total,
         'payment_method', e.payment_method,
         'recorded_by', e.recorded_by,
         'approved_by', e.approved_by,
         'status', e.status,
         'payment_status', e.payment_status,
         'paid_by', e.paid_by,
         'kind', e.kind,
         'account_id', e.account_id,
         'cost_center_id', e.cost_center_id,
         'corrects_expense_id', e.corrects_expense_id,
         'reversed_by_rollback_at', e.reversed_by_rollback_at
       )::text, 'UTF8')), 'hex')
       or e.payment_status is distinct from 'historical_reversed'
    ) then
      raise exception 'correction target changed during execution' using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links reversal
        join public.journal_entries reversal_entry
          on reversal_entry.id = reversal.journal_entry_id
        join public.reconciliation_baseline_journal_headers original
          on original.batch_id = reversal.batch_id
         and original.source_id = reversal.target_id
       where reversal.batch_id = p_batch_id
         and reversal.action_kind = 'correction_reversal'
         and (
           reversal_entry.reversal_of is distinct from original.original_journal_entry_id
           or not exists (
             select 1
               from public.journal_entries original_entry
              where original_entry.id = original.original_journal_entry_id
                and original_entry.status = 'reversed'
           )
         )
    ) then
      raise exception 'correction reversal linkage mismatch' using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_baseline_journal_headers baseline
        left join public.journal_entries original
          on original.id = baseline.original_journal_entry_id
       where baseline.batch_id = p_batch_id
         and (
           original.id is null
           or original.org_id is distinct from baseline.org_id
           or original.entry_date is distinct from baseline.entry_date
           or original.source_type is distinct from baseline.source_type
           or original.source_id is distinct from baseline.source_id
           or original.source_sequence is distinct from baseline.source_sequence
           or original.description is distinct from baseline.description
           or original.status is distinct from 'reversed'
           or original.posted_at is distinct from baseline.posted_at
           or original.posted_by is distinct from baseline.posted_by
           or original.reversal_of is distinct from baseline.reversal_of
         )
    ) then
      raise exception 'original journal header changed during correction'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_baseline_journal_lines baseline_line
        join public.reconciliation_baseline_journal_headers baseline_header
          on baseline_header.id = baseline_line.baseline_journal_header_id
        left join public.journal_lines original_line
          on original_line.id = baseline_line.original_journal_line_id
       where baseline_header.batch_id = p_batch_id
         and (
           original_line.id is null
           or original_line.org_id is distinct from baseline_line.org_id
           or original_line.journal_entry_id
                is distinct from baseline_header.original_journal_entry_id
           or original_line.account_id is distinct from baseline_line.account_id
           or original_line.debit is distinct from baseline_line.debit
           or original_line.credit is distinct from baseline_line.credit
           or original_line.description is distinct from baseline_line.description
           or original_line.cost_center_id is distinct from baseline_line.cost_center_id
           or original_line.custody_account_id is distinct from baseline_line.custody_account_id
           or original_line.custody_movement_id is distinct from baseline_line.custody_movement_id
           or original_line.expense_id is distinct from baseline_line.expense_id
           or original_line.payment_request_id is distinct from baseline_line.payment_request_id
         )
    ) or exists (
      select 1
        from public.reconciliation_baseline_journal_headers baseline_header
       where baseline_header.batch_id = p_batch_id
         and (
           select count(*) from public.journal_lines original_line
            where original_line.journal_entry_id =
                  baseline_header.original_journal_entry_id
         ) is distinct from (
           select count(*) from public.reconciliation_baseline_journal_lines baseline_line
            where baseline_line.baseline_journal_header_id = baseline_header.id
         )
    ) then
      raise exception 'original journal lines changed during correction'
        using errcode = '23514';
    end if;

    if exists (
      select 1
        from public.reconciliation_action_links reversal
        join public.reconciliation_baseline_journal_headers baseline_header
          on baseline_header.batch_id = reversal.batch_id
         and baseline_header.source_id = reversal.target_id
       where reversal.batch_id = p_batch_id
         and reversal.action_kind = 'correction_reversal'
         and (
           exists (
             (
               select account_id, credit, debit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.reconciliation_baseline_journal_lines
                where baseline_journal_header_id = baseline_header.id
               except all
               select account_id, debit, credit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.journal_lines
                where journal_entry_id = reversal.journal_entry_id
             )
             union all
             (
               select account_id, debit, credit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.journal_lines
                where journal_entry_id = reversal.journal_entry_id
               except all
               select account_id, credit, debit, cost_center_id,
                      custody_account_id, custody_movement_id, expense_id,
                      payment_request_id
                 from public.reconciliation_baseline_journal_lines
                where baseline_journal_header_id = baseline_header.id
             )
           )
         )
    ) then
      raise exception 'reversal journal is not the exact inverse of its snapshot'
        using errcode = '23514';
    end if;

  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      v_failure := true;
      v_failure_code := case
        when v_sqlstate = '55000' then 'locked_period'
        when v_sqlstate in ('23503', '23505', '23514') then 'integrity_check'
        when v_sqlstate in ('22023', '23502') then 'invalid_state'
        else 'execution_failed'
      end;
  end;

  if v_failure then
    update public.reconciliation_batches
       set status = 'failed',
           result_summary = jsonb_build_object(
             'failure_code', v_failure_code,
             'safe_locator', v_last_safe_row_locator
           )
     where id = p_batch_id;
    return jsonb_build_object(
      'batch_id', p_batch_id,
      'status', 'failed',
      'failure_code', v_failure_code,
      'safe_locator', v_last_safe_row_locator
    );
  end if;

  update public.reconciliation_batches
     set status = 'executed',
         result_summary = jsonb_build_object(
           'executed_rows', v_executed_count,
           'skipped_rows', v_skipped_count
         )
   where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'executed',
    'executed_rows', v_executed_count,
    'skipped_rows', v_skipped_count
  );
end;
$$;

revoke execute on function public.fn_execute_reconciliation_batch(uuid)
  from public, anon;
grant execute on function public.fn_execute_reconciliation_batch(uuid)
  to authenticated;

comment on function public.fn_execute_reconciliation_batch(uuid) is
  'Owner-only, whole-batch atomic expense reconciliation execution.';

commit;

-- SPEC-0033 R4k: exact, versioned balance-sheet and income-statement transport.
-- The trusted statement functions remain the sole accounting definitions. These wrappers preserve their
-- posted-only calculations while serializing every numeric as decimal text and binding the payload to the
-- active organization and requested dates. No posting, period-lock, permission, or business row changes.

begin;

create or replace function public.fn_accounting_balance_sheet_snapshot(
  p_org uuid,
  p_as_of date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_source jsonb;
  v_result jsonb;
begin
  if p_org is null then
    raise exception 'organization is required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids())
     or not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required for the active organization'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.journal_lines line
      join public.journal_entries entry on entry.id = line.journal_entry_id
      join public.accounts account on account.id = line.account_id
     where entry.status = 'posted'
       and entry.entry_date <= v_as_of
       and (line.org_id = p_org or entry.org_id = p_org or account.org_id = p_org)
       and (line.org_id is distinct from p_org
         or entry.org_id is distinct from p_org
         or account.org_id is distinct from p_org)
  ) then
    raise exception 'balance sheet journal relationship mismatch' using errcode = '23514';
  end if;

  v_source := public.fn_accounting_balance_sheet(p_org, v_as_of);

  select jsonb_build_object(
    'version', 'farm-os.balance-sheet.v1',
    'org_id', p_org,
    'as_of', v_source->>'as_of',
    'asset_count', jsonb_array_length(v_source->'assets')::text,
    'liability_count', jsonb_array_length(v_source->'liabilities')::text,
    'equity_count', jsonb_array_length(v_source->'equity')::text,
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', line->>'code',
        'name_ar', line->>'name_ar',
        'balance', line->>'balance',
        'kind', null
      ) order by line->>'code')
      from jsonb_array_elements(v_source->'assets') line
    ), '[]'::jsonb),
    'liabilities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', line->>'code',
        'name_ar', line->>'name_ar',
        'balance', line->>'balance',
        'kind', null
      ) order by line->>'code')
      from jsonb_array_elements(v_source->'liabilities') line
    ), '[]'::jsonb),
    'equity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', line->>'code',
        'name_ar', line->>'name_ar',
        'balance', line->>'balance',
        'kind', line->'kind'
      ) order by line->>'code')
      from jsonb_array_elements(v_source->'equity') line
    ), '[]'::jsonb),
    'assets_total', v_source->>'assets_total',
    'liabilities_total', v_source->>'liabilities_total',
    'equity_total', v_source->>'equity_total',
    'drawings_total', v_source->>'drawings_total',
    'revenue_total', v_source->>'revenue_total',
    'expense_total', v_source->>'expense_total',
    'net_income', v_source->>'net_income',
    'total_equity_incl_income', v_source->>'total_equity_incl_income',
    'liabilities_plus_equity', v_source->>'liabilities_plus_equity',
    'balanced', v_source->'balanced'
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.fn_accounting_income_statement_snapshot(
  p_org uuid,
  p_from date,
  p_to date default current_date
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, current_date);
  v_source jsonb;
  v_result jsonb;
begin
  if p_org is null then
    raise exception 'organization is required' using errcode = '23502';
  end if;
  if p_from is null then
    raise exception 'period start is required' using errcode = '23502';
  end if;
  if v_to < p_from then
    raise exception 'period end before start' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids())
     or not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required for the active organization'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.journal_lines line
      join public.journal_entries entry on entry.id = line.journal_entry_id
      join public.accounts account on account.id = line.account_id
     where entry.status = 'posted'
       and entry.entry_date between p_from and v_to
       and (line.org_id = p_org or entry.org_id = p_org or account.org_id = p_org)
       and (line.org_id is distinct from p_org
         or entry.org_id is distinct from p_org
         or account.org_id is distinct from p_org)
  ) then
    raise exception 'income statement journal relationship mismatch' using errcode = '23514';
  end if;

  v_source := public.fn_accounting_income_statement(p_org, p_from, v_to);

  select jsonb_build_object(
    'version', 'farm-os.income-statement.v1',
    'org_id', p_org,
    'period_start', v_source->>'period_start',
    'period_end', v_source->>'period_end',
    'revenue_count', jsonb_array_length(v_source->'revenue')::text,
    'expense_count', jsonb_array_length(v_source->'expenses')::text,
    'revenue', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', line->>'code',
        'name_ar', line->>'name_ar',
        'amount', line->>'amount',
        'kind', null
      ) order by line->>'code')
      from jsonb_array_elements(v_source->'revenue') line
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', line->>'code',
        'name_ar', line->>'name_ar',
        'amount', line->>'amount',
        'kind', line->'kind'
      ) order by line->>'code')
      from jsonb_array_elements(v_source->'expenses') line
    ), '[]'::jsonb),
    'revenue_total', v_source->>'revenue_total',
    'expenses_total', v_source->>'expenses_total',
    'operating_expenses', v_source->>'operating_expenses',
    'net_income', v_source->>'net_income'
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.fn_accounting_balance_sheet_snapshot(uuid, date)
  from public, anon, authenticated;
grant execute on function public.fn_accounting_balance_sheet_snapshot(uuid, date) to authenticated;

revoke execute on function public.fn_accounting_income_statement_snapshot(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_accounting_income_statement_snapshot(uuid, date, date) to authenticated;

comment on function public.fn_accounting_balance_sheet_snapshot(uuid, date) is
  'Versioned exact-decimal transport for the trusted posted-only balance sheet; fails closed on journal tenant drift.';
comment on function public.fn_accounting_income_statement_snapshot(uuid, date, date) is
  'Versioned exact-decimal transport for the trusted posted-only income statement; fails closed on journal tenant drift.';

commit;

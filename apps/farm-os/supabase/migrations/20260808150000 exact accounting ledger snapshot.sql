-- One exact, atomic read for the daily accounting ledger.
-- Money leaves PostgreSQL as text, and the recent-line count lets the app reject a truncated detail sample.

begin;

create or replace function public.fn_accounting_ledger_snapshot(
  p_org uuid,
  p_entry_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_line_limit constant integer := 500;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_entry_limit is null or p_entry_limit < 1 or p_entry_limit > 100 then
    raise exception 'entry limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org accounting ledger snapshot' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  with
  recent_entries as materialized (
    select je.id, je.entry_date, je.source_type, je.source_id, je.description, je.status, je.posted_at
      from public.journal_entries je
     where je.org_id = p_org
     order by je.entry_date desc nulls last, je.posted_at desc nulls last, je.id desc
     limit p_entry_limit
  ),
  trial_totals as materialized (
    select jl.account_id, sum(jl.debit) as debit, sum(jl.credit) as credit
      from public.journal_lines jl
      join public.journal_entries je
        on je.id = jl.journal_entry_id
       and je.org_id = p_org
       and je.status = 'posted'
     where jl.org_id = p_org
     group by jl.account_id
  ),
  entry_amounts as materialized (
    select jl.journal_entry_id, count(*)::integer as line_count, sum(jl.debit) as amount
      from public.journal_lines jl
      join recent_entries re on re.id = jl.journal_entry_id
     where jl.org_id = p_org
     group by jl.journal_entry_id
  ),
  organization_line_candidates as materialized (
    select jl.id
      from public.journal_lines jl
     where jl.org_id = p_org
    union
    select jl.id
      from public.journal_entries je
      join public.journal_lines jl on jl.journal_entry_id = je.id
     where je.org_id = p_org
    union
    select jl.id
      from public.accounts a
      join public.journal_lines jl on jl.account_id = a.id
     where a.org_id = p_org
  ),
  account_mismatches as materialized (
    select count(*)::integer as mismatch_count
      from organization_line_candidates candidate
      join public.journal_lines jl on jl.id = candidate.id
      join public.journal_entries je on je.id = jl.journal_entry_id
      join public.accounts a on a.id = jl.account_id
     where jl.org_id is distinct from p_org
        or je.org_id is distinct from p_org
        or a.org_id is distinct from p_org
  ),
  recent_line_source as materialized (
    select
      jl.id,
      jl.journal_entry_id,
      jl.account_id,
      a.code as account_code,
      a.name_ar as account_name_ar,
      jl.debit,
      jl.credit,
      jl.description,
      jl.payment_request_id,
      jl.expense_id,
      jl.created_at
    from public.journal_lines jl
    join recent_entries re on re.id = jl.journal_entry_id
    left join public.accounts a on a.id = jl.account_id and a.org_id = p_org
    where jl.org_id = p_org
  ),
  recent_lines as materialized (
    select *
      from recent_line_source
     order by journal_entry_id desc, created_at desc nulls last, id desc
     limit v_line_limit
  )
  select jsonb_build_object(
    'version', 'farm-os.accounting-ledger.v1',
    'org_id', p_org,
    'entry_limit', p_entry_limit,
    'line_limit', v_line_limit,
    'line_count', (select count(*) from recent_line_source),
    'account_mismatch_count', (select mismatch_count from account_mismatches),
    'trial_balance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', a.id,
        'org_id', a.org_id,
        'code', a.code,
        'name_ar', a.name_ar,
        'account_type', a.account_type,
        'normal_balance', a.normal_balance,
        'parent_id', a.parent_id,
        'active', a.active,
        'has_postings', tt.account_id is not null,
        'debit', coalesce(tt.debit, 0)::text,
        'credit', coalesce(tt.credit, 0)::text,
        'net', (coalesce(tt.debit, 0) - coalesce(tt.credit, 0))::text
      ) order by a.code)
      from public.accounts a
      left join trial_totals tt on tt.account_id = a.id
      where a.org_id = p_org
    ), '[]'::jsonb),
    'recent_entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', re.id,
        'entry_date', re.entry_date,
        'source_type', re.source_type,
        'source_id', re.source_id,
        'description', re.description,
        'status', re.status,
        'posted_at', re.posted_at,
        'amount', case when ea.line_count > 0 then ea.amount::text else null end
      ) order by re.entry_date desc nulls last, re.posted_at desc nulls last, re.id desc)
      from recent_entries re
      left join entry_amounts ea on ea.journal_entry_id = re.id
    ), '[]'::jsonb),
    'recent_lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rl.id,
        'journal_entry_id', rl.journal_entry_id,
        'account_id', rl.account_id,
        'account_code', rl.account_code,
        'account_name_ar', rl.account_name_ar,
        'debit', rl.debit::text,
        'credit', rl.credit::text,
        'description', rl.description,
        'payment_request_id', rl.payment_request_id,
        'expense_id', rl.expense_id
      ) order by rl.journal_entry_id desc, rl.created_at desc nulls last, rl.id desc)
      from recent_lines rl
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.fn_accounting_ledger_snapshot(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.fn_accounting_ledger_snapshot(uuid, integer) to authenticated;

commit;

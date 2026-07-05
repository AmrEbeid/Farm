-- 20260705110000 — Trusted balance-sheet report RPC (SPEC-0004 / ROADMAP Slice A: "P&L/balance-sheet reports").
--
-- Problem: the only statement-level read is fn_accounting_trial_balance (20260701220000) — raw all-time GL, and it
--   sums journal_lines WITHOUT filtering journal_entries.status, so REVERSED entries leak into totals, and it has
--   no as-of date. A trustworthy balance sheet needs: posted-only, as-of-scoped, grouped by account_type, with
--   owner drawings shown as a contra-equity line (non-negotiable #6) and the current-period result folded into
--   equity as net income.
--
-- Design: read-only, finance.read-gated, SECURITY DEFINER (mirrors fn_accounting_trial_balance /
--   fn_custody_ledger_report). Per-account signed balances over posted journal_lines with entry_date <= as-of,
--   grouped into asset / liability / equity sections; net income = revenue − expense for the period-to-as-of.
--   Because every journal entry balances (Σdebits=Σcredits) and the status/date filter is applied consistently to
--   whole entries, the identity Assets = Liabilities + Equity + NetIncome holds exactly — surfaced as a `balanced`
--   flag (a self-checking invariant the pgTAP oracle asserts). No schema change, no posting, no permission change.
--
-- Rollback: drop function public.fn_accounting_balance_sheet(uuid, date).

create or replace function public.fn_accounting_balance_sheet(
  p_org uuid,
  p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org balance sheet' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  with posted as (
    -- INNER join so ONLY posted, in-range entry lines are summed (a left join would leak reversed/future lines).
    select jl.account_id,
           sum(jl.debit)  as debit,
           sum(jl.credit) as credit
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
     where jl.org_id = p_org
       and je.org_id = p_org
       and je.status = 'posted'
       and je.entry_date <= coalesce(p_as_of, current_date)
     group by jl.account_id
  ),
  signed as (
    select a.id, a.code, a.name_ar, a.account_type, a.kind,
           case when a.account_type in ('asset','expense')
                then coalesce(p.debit, 0) - coalesce(p.credit, 0)
                else coalesce(p.credit, 0) - coalesce(p.debit, 0)
           end as balance,
           (coalesce(p.debit, 0) <> 0 or coalesce(p.credit, 0) <> 0) as has_activity
      from public.accounts a
      left join posted p on p.account_id = a.id
     -- NB: do NOT filter on a.active — an archived account that carried activity within the as-of window must still
     -- count toward the totals, or a historical balance sheet silently drops balances and the `balanced` identity
     -- goes stale. `has_activity` (below) already keeps zero-balance accounts out of the listed line items.
     where a.org_id = p_org
  ),
  totals as (
    select
      coalesce(sum(balance) filter (where account_type = 'asset'), 0)      as assets_total,
      coalesce(sum(balance) filter (where account_type = 'liability'), 0)  as liabilities_total,
      coalesce(sum(balance) filter (where account_type = 'equity'), 0)     as equity_total,
      -- positive magnitude of owner drawings (#6). Already NETTED into equity_total above (a drawing account is
      -- equity + debit-normal, so its credit-debit balance is negative and reduces equity_total) — surfaced here
      -- as a positive line for display; consumers must NOT subtract it from equity_total again.
      - coalesce(sum(balance) filter (where account_type = 'equity' and kind = 'drawing'), 0) as drawings_total,
      coalesce(sum(balance) filter (where account_type = 'revenue'), 0)    as revenue_total,
      coalesce(sum(balance) filter (where account_type = 'expense'), 0)    as expense_total
      from signed
  )
  select jsonb_build_object(
    'as_of', coalesce(p_as_of, current_date),
    'assets', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name_ar', name_ar, 'balance', balance) order by code)
                          from signed where account_type = 'asset' and has_activity), '[]'::jsonb),
    'liabilities', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name_ar', name_ar, 'balance', balance) order by code)
                          from signed where account_type = 'liability' and has_activity), '[]'::jsonb),
    'equity', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name_ar', name_ar, 'balance', balance, 'kind', kind) order by code)
                          from signed where account_type = 'equity' and has_activity), '[]'::jsonb),
    'assets_total',             t.assets_total,
    'liabilities_total',        t.liabilities_total,
    'equity_total',             t.equity_total,
    'drawings_total',           t.drawings_total,
    'revenue_total',            t.revenue_total,
    'expense_total',            t.expense_total,
    'net_income',               t.revenue_total - t.expense_total,
    'total_equity_incl_income', t.equity_total + (t.revenue_total - t.expense_total),
    'liabilities_plus_equity',  t.liabilities_total + t.equity_total + (t.revenue_total - t.expense_total),
    'balanced',                 t.assets_total = t.liabilities_total + t.equity_total + (t.revenue_total - t.expense_total)
  )
  into v_result
  from totals t;

  return v_result;
end;
$$;
revoke execute on function public.fn_accounting_balance_sheet(uuid, date) from public, anon, authenticated;
grant execute on function public.fn_accounting_balance_sheet(uuid, date) to authenticated;

-- 20260705130000 — trial balance must include ARCHIVED accounts that still carry postings.
--
-- PROBLEM (money-correctness, #1): fn_accounting_trial_balance filters `where a.org_id = p_org and a.active`.
--   fn_archive_account (20260701440000) deactivates an account (+ its subtree) with NO check that it carries
--   journal_lines — it only blocks SYSTEM accounts. So archiving a leaf account that has postings DROPS its
--   debit/credit lines from the trial balance while the balancing line on the still-active counter-account
--   remains → Σdebit ≠ Σcredit: the trial balance no longer FOOTS, and the /accounting KPIs (custodyCash,
--   ownerFunding, operatingExpenses, drawings, capex — all derived via sumAccountSubtreeNet over this trial
--   balance) silently UNDERSTATE. A balance can never be hidden by archiving the account it lives on. This is
--   the same defect class the new balance sheet (20260705110000) already avoids by deliberately NOT filtering
--   a.active; this brings the trial balance in line.
--
-- FIX: re-emit fn_accounting_trial_balance VERBATIM from 20260701220000 with ONE predicate change — include an
--   account when it is active OR when it has journal lines (`t.account_id is not null` after the left join).
--   Active accounts are unchanged; a zero-line archived account stays excluded (no clutter); an archived
--   account that still carries postings is now shown with its real balance → the statement always foots.
--   NOT touched: the reversed/posted-entry status handling (the trial balance sums all lines; the balance
--   sheet filters je.status='posted'). Reconciling those is tied to the still-DRAFT reversal framework
--   (SPEC-0028 / #704) and is a separate, decision-laden change — deliberately out of scope here.
--
-- SECURITY: unchanged — same SECURITY DEFINER, set search_path='', STABLE, the cross-org (user_org_ids) and
--   authorize('finance.read') guards, and the EXECUTE lockdown (revoke public/anon/authenticated; grant
--   authenticated). Read-only; no data mutated.
--
-- Rollback: re-emit fn_accounting_trial_balance from 20260701220000 (restore the bare `and a.active`).

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
  -- include active accounts AND any account (even archived) that still carries postings, so an archived
  -- posted account's balance can't vanish and unbalance the trial balance (#1).
  where a.org_id = p_org and (a.active or t.account_id is not null);

  return v_rows;
end;
$$;
revoke execute on function public.fn_accounting_trial_balance(uuid) from public, anon, authenticated;
grant execute on function public.fn_accounting_trial_balance(uuid) to authenticated;

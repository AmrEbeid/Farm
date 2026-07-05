-- Farm OS — #owner-P&L correctness: exclude CANCELLED expenses from the owner P&L summary. Money surface
-- (non-negotiable #1: never present a wrong financial figure). Found by a money-correctness re-audit.
--
-- BUG: fn_owner_pnl_summary (migration 20260701270000) sums expenses.total by kind over the period with NO
-- payment_status filter. `payment_status='cancelled'` is a defined void state (expenses_payment_status_check,
-- migration 0629150000; reachable via fn_set_expense_payment_status). A cancelled expense therefore still
-- inflates operating_expenses / owner_drawings / capex on /finance/pnl → overstated expenses, understated
-- operating profit — a wrong owner-facing figure.
--
-- FIX: re-emit fn_owner_pnl_summary VERBATIM from 0701270000 with ONE added WHERE predicate —
-- `and coalesce(payment_status, '') <> 'cancelled'`. NULL payment_status (a normal live expense) is retained;
-- only the explicit void state is excluded. (The legacy free-text `expenses.status` column has no defined void
-- semantics — NOT touched here; that needs an Owner data decision.) Grants preserved by create-or-replace.
-- Validation: pgTAP 112 (extended, define-check-first: a cancelled in-period expense is excluded) + full harness.

begin;

create or replace function public.fn_owner_pnl_summary(p_org uuid, p_from date, p_to date)
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
    coalesce(sum(total) filter (where kind = 'drawing'),   0),
    coalesce(sum(total) filter (where kind = 'capex'),     0)
  into v_operating, v_drawings, v_capex
  from public.expenses
  where org_id = p_org
    and date >= p_from
    and date <= p_to
    -- exclude cancelled (void) expenses; NULL payment_status (a normal live expense) is retained.
    and coalesce(payment_status, '') <> 'cancelled';

  return jsonb_build_object(
    'period_start',       p_from,
    'period_end',         p_to,
    'operating_expenses', v_operating,
    'owner_drawings',     v_drawings,
    'capex',              v_capex
  );
end;
$$;

revoke execute on function public.fn_owner_pnl_summary(uuid, date, date) from public, anon, authenticated;
grant  execute on function public.fn_owner_pnl_summary(uuid, date, date) to authenticated;

commit;

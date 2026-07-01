-- 20260701270000 — Owner P&L period summary RPC (read-only, additive, narrowly scoped).
--
-- CONTEXT / WHY THIS IS SMALL: PR #368 (branch feat/stage-7-accounting-backend, still an unmerged
-- DRAFT) already builds a full "/accounting" P&L page + a `sales` table + `fn_accounting_pnl_summary`.
-- This migration does NOT duplicate that framework. Separately, PR #540 ("gate expense reads on
-- kind='drawing' — owner-drawings privacy") was CLOSED without merging, so on `main` today the
-- `expenses` table's SELECT RLS is still the plain org-scoped policy from migration 0044/0012 — no
-- role gate on reads at all. This migration does not attempt to fix that table-wide gap either (that
-- is #368/#540's job). It adds ONE narrowly-scoped, role-gated aggregate for a new "/finance/pnl"
-- period-summary page (app PR, this same change): operating expenses, owner drawings (مسحوبات، #6),
-- and capex for an org + date range — computed as a real SUM() over the full period (no row cap, no
-- cached/guessed figure). Restricted to `finance.read` (owner/accountant only — see migration
-- 20260629150000, the CURRENT actual gate on `main`); any other role, including farm_manager, is
-- REJECTED with 42501 rather than shown a zeroed/placeholder figure. There is still no `sales`/revenue
-- table on `main`, so revenue is intentionally NOT computed here — the app layer reports "no revenue
-- model yet" instead of fabricating a number.
--
-- Owner-gated apply (draft only, append-only). Validate with test-shims/run-pgtap-local.sh.

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
    and date <= p_to;

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

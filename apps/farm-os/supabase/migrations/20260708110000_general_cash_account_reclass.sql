-- Farm OS — split the farm's general cash out of the field-custody imprest account (Owner-reported bug).
--
-- BUG (Owner: "the custody account balance is totally wrong"). The chart of accounts had only ONE cash account,
-- `1000 عهدة نقدية` — which is specifically the FIELD-CUSTODY IMPREST (the float a holder like «abdo» carries,
-- tracked operationally in custody_accounts/custody_movements). The 7-year GL history backfill (20260707115445)
-- had no general cash/treasury account to use, so it routed the ENTIRE cash flow through `1000`:
--     source_type='sale'   (162 lines)    +25,835,533   (all historical sales cash-in)
--     source_type='expense'(10,201 lines) −20,527,757   (all historical expenses cash-out)
--     source_type='custody_owner_funding'(1 line)  +80,000   (the ONE real custody movement)
--     → 1000 balance 5,387,776, while the operational custody ledger (fn_custody_balance) shows only 80,000.
-- A field imprest cannot be 5.39M; that figure is the farm's whole treasury, misfiled under عهدة نقدية.
--
-- FIX. Add a proper general-cash account `1010 النقدية بالخزينة` and reclass ONLY the backfill cash lines
-- (source_type in 'sale','expense') from 1000 → 1010. The real custody movement (custody_owner_funding, +80,000)
-- STAYS in 1000, so the GL custody-control account finally equals the operational custody ledger.
--   After:  1000 عهدة نقدية = 80,000   ·   1010 النقدية بالخزينة = 5,307,776   ·   total assets UNCHANGED.
-- Only journal_lines.account_id changes — debit/credit are untouched, so every entry stays balanced and no
-- statement total moves; this only relabels which asset line the historical cash sits on.
--
-- WHY source_type in ('sale','expense') is exact & future-safe: those are precisely the backfill lines on 1000
-- (verified: 162 + 10,201). Live sales post Dr 1200/Cr 4000 (never 1000); live custody expense-payments post
-- through fn_record_custody_movement under a custody source_type; so no future entry hits 1000 with these types.
--
-- IDEMPOTENT: the account insert is `not exists`-guarded; the reclass is guarded on account_id = <1000> so a
-- re-run matches nothing (lines are already on 1010). REVERSIBLE (rollback):
--   update public.journal_lines jl set account_id = a1000.id
--     from public.journal_entries je, public.accounts a1000, public.accounts a1010
--    where jl.journal_entry_id = je.id and je.source_type in ('sale','expense')
--      and a1000.org_id = jl.org_id and a1000.code='1000' and a1010.org_id = jl.org_id and a1010.code='1010'
--      and jl.account_id = a1010.id;
--   -- then optionally: delete from public.accounts where code='1010' and not exists (postings);
-- SECURITY: data-only + one new leaf account. No RLS/RPC/permission change; direct DML in a migration (same
-- pattern as the sibling backfills 20260707115445 / 20260708090000).

begin;

-- 1) General cash / treasury account, mirroring 1000's system-account shape (per org that has a 1000).
insert into public.accounts (id, org_id, code, name_ar, account_type, normal_balance, parent_id, kind, is_system, sort_order, active)
select gen_random_uuid(), a1000.org_id, '1010', 'النقدية بالخزينة', 'asset', 'debit', a1000.parent_id, null, true, 15, true
  from public.accounts a1000
 where a1000.code = '1000'
   and not exists (select 1 from public.accounts x where x.org_id = a1000.org_id and x.code = '1010');

-- 2) Reclass the historical backfill cash lines 1000 → 1010 (leaves real custody movements in 1000).
do $$
declare v_org uuid; v_1000 uuid; v_1010 uuid; v_n int;
begin
  for v_org in select distinct org_id from public.accounts where code = '1000' loop
    select id into v_1000 from public.accounts where org_id = v_org and code = '1000';
    select id into v_1010 from public.accounts where org_id = v_org and code = '1010';
    if v_1000 is null or v_1010 is null then continue; end if;

    update public.journal_lines jl
       set account_id = v_1010
      from public.journal_entries je
     where jl.journal_entry_id = je.id
       and jl.org_id = v_org
       and jl.account_id = v_1000
       and je.source_type in ('sale', 'expense');

    get diagnostics v_n = row_count;
    raise notice 'org %: reclassed % backfill cash lines 1000 عهدة نقدية -> 1010 النقدية بالخزينة', v_org, v_n;
  end loop;
end $$;

-- Post-reclass invariant (money-migration guard): no historical sale/expense cash line may remain on the
-- field-custody account. Clean-DB-safe (0 such lines in seed → passes); on prod, a silently-incomplete reclass
-- leaves lines behind and this rolls the whole migration back.
do $$
declare v_remaining int;
begin
  select count(*) into v_remaining
    from public.journal_lines jl
    join public.accounts a on a.id = jl.account_id and a.code = '1000'
    join public.journal_entries je on je.id = jl.journal_entry_id
   where je.source_type in ('sale', 'expense');
  if v_remaining <> 0 then
    raise exception 'reclass incomplete: % sale/expense cash line(s) still on 1000 عهدة نقدية', v_remaining;
  end if;
end $$;

commit;

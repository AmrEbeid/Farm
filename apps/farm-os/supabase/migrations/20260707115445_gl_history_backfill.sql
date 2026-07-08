-- Farm OS — historical GL reconciliation backfill (2019–2026).
--
-- PROBLEM. The full 7-year history was imported into the operational tables but never linked to the
--   ledger: 1,271 of 10,232 expenses had a NULL account_id (all 726 owner drawings, all 511 capex, and
--   34 stray operating rows), and NOTHING was posted to the double-entry GL — journal_entries held a
--   single row. Because the trusted statements (balance sheet / income statement / trial balance /
--   budget-vs-actual) all read journal_lines, they were effectively empty for the entire history.
--
-- INTENT (two cash-method slices, both idempotent):
--   SLICE 1 — set expenses.account_id for every row via the canonical rule the import already used:
--     operating → the 5xxx account matching نوع المصروف (category); owner drawings (مسحوبات) → 3100
--     مسحوبات المالك (equity); capex → 1520 إنشاء بساتين (asset leaf). 3 rows mislabelled
--     category='مسحوبات' kind='operating' are normalised to kind='drawing' first.
--   SLICE 2 — post one balanced two-line journal per expense and per sale via the existing
--     fn_post_two_line_journal primitive (cash method):
--        expense: Dr <expense/capex/drawing account> / Cr 1000 عهدة نقدية
--        sale:    Dr 1000 عهدة نقدية              / Cr <revenue account by crop>
--     The single cash contra (1000) makes the balance sheet balance (Assets = Equity) without a
--     historical bank ledger. Drawings (3100, equity) and capex (1520, asset) are excluded from the
--     P&L by construction (account_type filtering), preserving non-negotiable #6 (drawings ≠ opex).
--
-- SECURITY. Pure data migration. Uses the existing SECURITY DEFINER helpers (fn_post_two_line_journal)
--   with pinned search_path. No schema change, no permission change, no new RPC. The expense_account_guard
--   kind-match and active-leaf rules are satisfied by the mapping above; account_id is set BEFORE any
--   journal line exists, so expense_guard_routed_money_immutable is not tripped.
--
-- IDEMPOTENT / RE-RUNNABLE. Slice 1 updates only rows whose account_id/kind differ from target.
--   fn_post_two_line_journal returns the existing entry when (org_id, source_type, source_id) already
--   exists, so Slice 2 is a no-op on re-run. Amounts must be > 0; any non-positive total is skipped and
--   surfaced via a NOTICE (none exist in current prod data).
--
-- REVIEW EVIDENCE (dry-run against prod, read-only): expense debit total 20,858,758 ties to SUM(total);
--   revenue credit total 25,835,533 ties to SUM(sales.total); resulting balance sheet balances
--   (Assets 5,470,750 = Cash 4,976,775 + Capex 493,975 ; Equity 5,470,750 = Net income 8,431,227 −
--   Drawings 2,960,477). Net operating expense 17,404,306.
--
-- ROLLBACK.
--   delete from public.journal_lines   where journal_entry_id in
--     (select id from public.journal_entries where source_type in ('expense','sale'));
--   delete from public.journal_entries where source_type in ('expense','sale');
--   -- (optionally) update public.expenses set account_id = null;  -- reverts Slice 1
--
-- NOTE. This migration reconstructs the ACCOUNTING layer only. Vendor/supplier, item, quantity and
--   customer/buyer were never captured in the source sheet (blank template columns) and are deliberately
--   NOT fabricated. Pre-2019 cost (~9.66M, summary-only in the source) is out of scope here.

begin;

-- ── SLICE 1: account_id linkage on public.expenses ────────────────────────────────────────────────────
do $$
declare
  v_org uuid;
begin
  for v_org in select distinct org_id from public.expenses loop

    -- Normalise mislabelled owner drawings (category مسحوبات recorded as kind='operating').
    update public.expenses
       set kind = 'drawing'
     where org_id = v_org
       and category = 'مسحوبات'
       and kind is distinct from 'drawing';

    -- Set account_id from the canonical category/kind rule, only where it differs (idempotent).
    update public.expenses e
       set account_id = a.id
      from public.accounts a
     where e.org_id = v_org
       and a.org_id = v_org
       and a.code = case
             when e.kind = 'drawing' then '3100'          -- مسحوبات المالك (equity/drawing)
             when e.kind = 'capex'   then '1520'          -- إنشاء بساتين (asset leaf)
             else case e.category                          -- operating → 5xxx by نوع المصروف
                    when 'تموين وايجار مكينه' then '5320'  -- وقود وطاقة
                    when 'عماله'              then '5210'  -- عمالة موسمية ويومية
                    when 'مرتبات'             then '5220'  -- مرتبات دائمة
                    when 'صيانه للمزرعه'      then '5440'  -- صيانة منشآت
                    when 'مشتريات'            then '5410'  -- مشتريات
                    when 'اسمده ومبيدات'      then '5110'  -- أسمدة
                    when 'ضيافه'              then '5420'  -- ضيافة
                    when 'كهرباء'             then '5430'  -- كهرباء ومياه
                    else '5490'                            -- أخرى + crop-cost cats (بنجر/ذرة/قمح/برج الحمام/جنينه البلد)
                  end
           end
       and e.account_id is distinct from a.id;

  end loop;
end $$;

-- Fail loudly if Slice 1 left any expense unlinked (invariant: 100% account coverage).
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing from public.expenses where account_id is null;
  if v_missing > 0 then
    raise exception 'GL backfill Slice 1 incomplete: % expenses still have NULL account_id', v_missing;
  end if;
end $$;

-- ── SLICE 2: post the double-entry GL (cash method) ───────────────────────────────────────────────────
do $$
declare
  v_org   uuid;
  v_cash  uuid;
  r       record;
  v_rev   uuid;
  v_skipped int := 0;
begin
  for v_org in select distinct org_id from public.expenses loop

    select id into v_cash from public.accounts where org_id = v_org and code = '1000';
    if v_cash is null then
      raise exception 'cash account 1000 عهدة نقدية missing for org %', v_org;
    end if;

    -- Expenses: Dr <own account_id> / Cr cash.
    for r in
      select id, account_id, date, description, total
        from public.expenses
       where org_id = v_org
    loop
      if coalesce(r.total, 0) <= 0 then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      perform public.fn_post_two_line_journal(
        v_org, r.date, 'expense', r.id,
        left(coalesce(r.description, ''), 500),
        r.account_id, v_cash, r.total,
        null, null, null, null, r.id, null);
    end loop;

    -- Sales: Dr cash / Cr <revenue account by crop>.
    for r in
      select id, crop, sale_date, created_at, total
        from public.sales
       where org_id = v_org
    loop
      if coalesce(r.total, 0) <= 0 then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      select id into v_rev from public.accounts
       where org_id = v_org
         and code = case
               when r.crop ~ 'خرده|خشب|سلك|خراطيم|مكن|الشفعه'                     then '4090'
               when r.crop ~ 'فسائل|فسيلة|فسيله'                                  then '4020'
               when r.crop ~ 'بنجر'                                               then '4040'
               when r.crop ~ 'برحي|بلح|تمور|خلاص|مجدول|زغلول|النخيل|نخيل'          then '4010'
               when r.crop ~ 'ذرة|قمح|فول|ثوم|بصل|شعير|برسيم|تقاوي|سيلاج|تبن|فلفل' then '4050'
               when r.crop ~ 'برتقال|يوسفي|ليمون|كمثري|مانجو|تفاح|عنب|رمان|موركيت|خوخ|قشط|كافور|صيني|كلاله' then '4030'
               else '4090'
             end;
      if v_rev is null then
        raise exception 'revenue account missing for org % (crop=%)', v_org, r.crop;
      end if;
      perform public.fn_post_two_line_journal(
        v_org, coalesce(r.sale_date, r.created_at::date), 'sale', r.id,
        left(coalesce(r.crop, ''), 500),
        v_cash, v_rev, r.total,
        null, null, null, null, null, null);
    end loop;

  end loop;

  if v_skipped > 0 then
    raise notice 'GL backfill: skipped % non-positive-amount rows (not posted)', v_skipped;
  end if;
end $$;

commit;

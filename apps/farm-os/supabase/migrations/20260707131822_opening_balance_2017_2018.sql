-- Farm OS — opening balance as of 2019-01-01: the 2017–2018 establishment investment.
--
-- CONTEXT. The detailed ledger starts at the first 2019 transaction, so the balance sheet ignored everything the
--   farm built before then. The source workbook's `مصروفات 2017و2018` sheet records the founding years:
--   2017 = 7,470,586 and 2018 = 2,187,302 (total 9,657,887) of expenses with ZERO revenue — the orchards were
--   being established and not yet producing. Summary only (by category; no line detail).
--
-- OWNER DECISION (Option A, cost basis). Capitalize the whole 2017–2018 establishment spend as an orchard-
--   development ASSET, funded by OWNER CAPITAL, in a single opening entry dated 2019-01-01:
--       Dr 1520 إنشاء بساتين (asset)   /   Cr 3000 تمويل المالك (equity/capital)   = 9,657,887
--   There is NO revenue/expense line, so this has zero P&L impact on any year — it only establishes the opening
--   balance-sheet position (Assets = Equity both rise by 9,657,887; the ledger stays balanced).
--
-- EXPLICITLY NOT DONE (needs an accountant/valuer — future Option B/C):
--   • splitting the 9,657,887 into capitalizable asset vs consumed startup expense (accumulated deficit);
--   • valuing the LAND and the standing orchards (4,380+ palms) at fair value — the farm's largest real asset,
--     not captured by any cost sheet;
--   • depreciation of the orchard-development asset once producing.
--
-- IDEMPOTENT. Fixed source_id; fn_post_two_line_journal returns the existing entry if (org,'opening_balance',src)
--   already exists, so re-running is a no-op.
-- REVERSIBLE. delete from public.journal_entries where source_type='opening_balance';  (cascade removes lines).
-- SECURITY. Data-only; uses the existing SECURITY DEFINER primitive. No schema/permission change.

begin;

do $$
declare
  v_org uuid;
  v_asset uuid;
  v_capital uuid;
  v_src uuid := '0b0e2017-2018-4a18-9000-000000000001';
begin
  for v_org in select distinct org_id from public.expenses loop
    select id into v_asset   from public.accounts where org_id=v_org and code='1520';
    select id into v_capital from public.accounts where org_id=v_org and code='3000';
    if v_asset is null or v_capital is null then
      raise exception 'opening balance: account 1520/3000 missing for org %', v_org;
    end if;
    perform public.fn_post_two_line_journal(
      v_org, date '2019-01-01', 'opening_balance', v_src,
      'رصيد افتتاحي ٢٠١٩-٠١-٠١ — استثمار تأسيس البساتين ٢٠١٧–٢٠١٨ (رأسملة على أساس التكلفة)',
      v_asset, v_capital, 9657887,
      'إنشاء بساتين — تأسيس ٢٠١٧–٢٠١٨',
      'تمويل المالك — رأس المال المستثمر في التأسيس',
      null, null, null, null);
  end loop;
end $$;

commit;

-- Farm OS — reclass mature palm-TREE disposals out of crop revenue 4010 (Owner-directed, SPEC-0004 Stage-M follow-up).
--
-- CONTEXT. The history GL backfill (20260707115445) routed every sale into a revenue line by crop keyword. Three
--   sale rows are NOT date-crop revenue — they are proceeds from selling the actual mature palm TREES (uprooted /
--   sold standing), i.e. disposals of a biological asset. The keyword rule mis-posted them to 4010 «تمور برحي»
--   (date-crop revenue), inflating the crop-revenue line. The tree-WOOD and scrap disposals from the same era
--   already sit in 4090 «إيرادات أخرى» (other income); these three belong with them.
--
--     sale_id                               crop                                                    total
--     5710acfb-57b5-40ba-9b94-cb9b42454b32  النخيل المجدول والخلاص بالخطارة حتي تاريخ 15-03-2023م   256,600
--     4fad71f1-0778-4d00-8c11-04bbdb84efc2  المبلغ المتبقي من بيع النخيل المجدول والخلاص بالخطارة    28,600
--     a88e66f2-cc47-428d-abc1-738bd1be9bb1  نخيل الزغلول بمشاية حوض البابور                          14,000
--                                                                                          total = 299,200
--
-- WHAT. Re-point the CREDIT line of each of these three 'sale' journal entries from 4010 → 4090. Only the
--   account_id changes; debit/credit amounts are untouched, so each entry stays balanced (the deferred
--   journal_lines balance guard passes) and TOTAL revenue is unchanged — this only moves 299,200 from the
--   date-crop line to the other-income line. Sheet reconciliation (revenue = 25,835,533) is preserved.
--
-- SCOPE (deliberately minimal — the rest is an accountant's policy call, NOT decided here):
--   • Only the three palm-TREE rows mis-posted to 4010. Pinned by sale_id + guarded on account = 4010.
--   • NOT touched: the 4030 tree sales (اشجار القشطة 73,600، شجر الخوخ 4,500), the 4090 wood/scrap already there,
--     and whether asset disposals should be revenue at all vs netted against 1520 book value / a below-the-line
--     gain account. Those need an accountant's decision (see the PR / decision memo).
--
-- IDEMPOTENT. The UPDATE is guarded on `jl.account_id = <4010>`; after the first run the lines are on 4090, so a
--   re-run matches zero rows. Pinned to explicit sale_ids, so it can never sweep in future/other rows.
--
-- REVERSIBLE. To restore (move them back to 4010):
--     update public.journal_lines jl set account_id = a10.id
--       from public.journal_entries je, public.accounts a10, public.accounts a90
--      where jl.journal_entry_id = je.id and je.source_type='sale'
--        and je.source_id in ('5710acfb-57b5-40ba-9b94-cb9b42454b32',
--                             '4fad71f1-0778-4d00-8c11-04bbdb84efc2',
--                             'a88e66f2-cc47-428d-abc1-738bd1be9bb1')
--        and a10.org_id=je.org_id and a10.code='4010' and a90.org_id=je.org_id and a90.code='4090'
--        and jl.credit > 0 and jl.account_id = a90.id;
--
-- SECURITY. Data-only. No schema / RLS / permission / RPC change. Direct DML in a migration is the same pattern
--   the sibling backfill migrations use (20260707115445 Slice 1, 20260707130001). No application-table shape change.

begin;

do $$
declare
  v_org  uuid;
  v_4010 uuid;
  v_4090 uuid;
  v_n    int;
begin
  for v_org in select distinct org_id from public.sales loop
    select id into v_4010 from public.accounts where org_id = v_org and code = '4010';
    select id into v_4090 from public.accounts where org_id = v_org and code = '4090';
    if v_4010 is null or v_4090 is null then
      continue;  -- org without the standard revenue chart; nothing to reclass
    end if;

    update public.journal_lines jl
       set account_id = v_4090
      from public.journal_entries je
     where jl.journal_entry_id = je.id
       and je.org_id = v_org
       and je.source_type = 'sale'
       and je.source_id in (
         '5710acfb-57b5-40ba-9b94-cb9b42454b32',  -- النخيل المجدول والخلاص بالخطارة — 256,600
         '4fad71f1-0778-4d00-8c11-04bbdb84efc2',  -- المبلغ المتبقي من بيع النخيل المجدول والخلاص — 28,600
         'a88e66f2-cc47-428d-abc1-738bd1be9bb1'   -- نخيل الزغلول بمشاية حوض البابور — 14,000
       )
       and jl.credit > 0
       and jl.account_id = v_4010;

    get diagnostics v_n = row_count;
    raise notice 'org %: reclassed % palm-tree sale credit line(s) 4010 -> 4090', v_org, v_n;
  end loop;
end $$;

commit;

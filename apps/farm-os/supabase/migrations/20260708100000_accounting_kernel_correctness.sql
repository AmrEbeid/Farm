-- Farm OS — accounting-kernel correctness pass (bug-hunt findings; all pure function re-emits, no data/schema change).
--
-- Three latent correctness gaps in the revenue + reversal framework, all found by an independent accounting
-- review. Prod today has 0 pending sales, 0 reversed entries, 0 locked periods, so none is misstating the live
-- books yet — this closes them BEFORE the farm exercises finalization/reversal at volume. Each fix is a plain
-- CREATE OR REPLACE of an existing function (idempotent; rollback = re-apply the prior definition from
-- 20260701500000_revenue_sales.sql / 20260705130000_trial_balance_include_posted_accounts.sql). No table DDL,
-- no data mutation, no permission change (grants preserved + re-stated).
--
-- F2 — fn_finalize_sale_price posted revenue on current_date instead of the sale's economic date.
--   In the deliver-before-price model, finalize usually happens in a later period than delivery, so posting at
--   current_date mis-periods the P&L, permanently desyncs the GL income statement from the /finance/season view
--   (which groups by sale_date), and lets a sale that belongs to a now-locked period post into the open one.
--   Fix: post at coalesce(sale_date, delivery_date, current_date) — matching the expense path (r.date) and the
--   history backfill (coalesce(sale_date, created_at)). NOTE: finalizing a sale whose sale_date falls in a LOCKED
--   period is now (correctly) rejected by the period-lock guard — reopen the period if a late-priced delivery
--   must post into it. (No locked periods exist in prod today.)
--
-- F1 — fn_record_sale_collection let you collect on a sale whose revenue entry had been reversed.
--   fn_reverse_journal_entry marks the sale's revenue entry 'reversed' but does not reset sales.price_status, so
--   the old collection guard (price_status='finalized' + Σcollections < total) still passed → a collection would
--   Cr ذمم مدينة 1200 with no matching posted debit → NEGATIVE receivable + phantom cash. Fix: require a LIVE
--   posted 'sale' journal entry to exist before collecting. This composes with source_sequence re-posting: if the
--   revenue is reversed then re-posted, a new status='posted' entry exists and collection is allowed again.
--   (Deeper follow-up, NOT decided here — a product/semantics call: whether reversing a sale should reset
--   price_status, unwind prior collections, and whether the sector/season scorecards should read the posted GL
--   instead of sales.total. Documented in SESSION-BRIEF; these views only diverge once a reversal exists.)
--
-- F3 — fn_accounting_trial_balance summed reversed lines into the per-account debit/credit columns.
--   The net column stayed correct (a reversed pair nets to 0) but debit/credit were inflated by every reversed
--   line — the same over-count the #863 cost-center rollup fix addressed. Its deferral was explicitly "tied to the
--   still-DRAFT reversal framework"; reversal has since shipped, so the premise is stale. Fix: filter the inner
--   aggregate on journal_entries.status='posted', matching the balance sheet / income statement.

begin;

-- ── F2 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_finalize_sale_price(p_sale uuid, p_unit_price numeric)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_qty numeric; v_status text; v_total numeric; v_ar uuid; v_rev uuid; v_journal uuid;
  v_sale_date date; v_delivery_date date; v_entry_date date;
begin
  if p_unit_price is null or p_unit_price < 0 then raise exception 'unit_price must be non-negative' using errcode = '22023'; end if;
  select org_id, qty, price_status, sale_date, delivery_date
    into v_org, v_qty, v_status, v_sale_date, v_delivery_date
    from public.sales where id = p_sale for update;
  if v_org is null then raise exception 'sale % not found', p_sale using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org sale' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if v_status = 'finalized' then raise exception 'sale price already finalized' using errcode = '22023'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'set a positive qty before finalizing the price' using errcode = '22023'; end if;

  v_total := round(v_qty * p_unit_price, 2);
  update public.sales
     set unit_price = p_unit_price, total = v_total, price_status = 'finalized', price_finalized_at = now()
   where id = p_sale;

  -- Recognize revenue on the sale's economic date (delivery/sale), not current_date — reconciles the GL with the
  -- season view and the expense/backfill convention. A locked economic period will (correctly) reject the post.
  v_entry_date := coalesce(v_sale_date, v_delivery_date, current_date);
  v_ar  := public.fn_ensure_account(v_org, '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit');
  v_rev := public.fn_ensure_account(v_org, '4000', 'إيرادات المبيعات', 'revenue', 'credit');
  v_journal := public.fn_post_two_line_journal(
    v_org, v_entry_date, 'sale', p_sale, 'إثبات إيراد بيع عند تحديد السعر',
    v_ar, v_rev, v_total, 'ذمم مدينة على العميل', 'إيراد مبيعات', null, null, null, null);

  return jsonb_build_object('id', p_sale, 'total', v_total, 'price_status', 'finalized', 'journal_entry_id', v_journal);
end $$;
revoke execute on function public.fn_finalize_sale_price(uuid, numeric) from public, anon, authenticated;
grant  execute on function public.fn_finalize_sale_price(uuid, numeric) to authenticated;

-- ── F1 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_record_sale_collection(
  p_sale uuid, p_amount numeric, p_occurred_at date default current_date,
  p_collected_by text default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_org uuid; v_status text; v_total numeric; v_collected numeric; v_new_total numeric;
  v_cash uuid; v_ar uuid; v_id uuid; v_journal uuid; v_pay text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'collection amount must be positive' using errcode = '22023'; end if;
  select org_id, price_status, total into v_org, v_status, v_total from public.sales where id = p_sale for update;
  if v_org is null then raise exception 'sale % not found', p_sale using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org sale' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if v_status <> 'finalized' then raise exception 'cannot collect on a pending-price sale; finalize the price first' using errcode = '22023'; end if;

  -- Refuse to collect when the sale's revenue entry is not currently posted (e.g. it was reversed): otherwise the
  -- collection credits ذمم مدينة 1200 with no matching posted debit → negative receivable + phantom cash.
  if not exists (
    select 1 from public.journal_entries
     where org_id = v_org and source_type = 'sale' and source_id = p_sale and status = 'posted'
  ) then
    raise exception 'cannot collect: this sale has no posted revenue entry (was it reversed?)' using errcode = '22023';
  end if;

  select coalesce(sum(amount),0) into v_collected from public.sale_collections where sale_id = p_sale;
  v_new_total := v_collected + p_amount;
  if v_new_total > coalesce(v_total,0) then
    raise exception 'collection exceeds the outstanding receivable (total %, already collected %)', v_total, v_collected using errcode = '22023';
  end if;

  insert into public.sale_collections(org_id, sale_id, amount, occurred_at, collected_by, note)
  values (v_org, p_sale, p_amount, coalesce(p_occurred_at, current_date), nullif(trim(coalesce(p_collected_by,'')),''), nullif(trim(coalesce(p_note,'')),''))
  returning id into v_id;

  -- Clear the receivable: Dr نقدية المبيعات / Cr ذمم مدينة.
  v_cash := public.fn_ensure_account(v_org, '1100', 'نقدية المبيعات', 'asset', 'debit');
  v_ar   := public.fn_ensure_account(v_org, '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit');
  v_journal := public.fn_post_two_line_journal(
    v_org, coalesce(p_occurred_at, current_date), 'sale_collection', v_id, 'تحصيل من عميل',
    v_cash, v_ar, p_amount, 'نقدية محصّلة', 'سداد ذمم مدينة', null, null, null, null);
  update public.sale_collections set journal_entry_id = v_journal where id = v_id;

  -- Refresh payment_status from Σ(collections); the caller never supplies it and no running balance is stored.
  v_pay := case when v_new_total >= coalesce(v_total,0) then 'collected'
                when v_new_total > 0 then 'partially_collected' else 'unpaid' end;
  update public.sales set payment_status = v_pay where id = p_sale;

  return jsonb_build_object('id', v_id, 'collected_total', v_new_total, 'payment_status', v_pay, 'journal_entry_id', v_journal);
end $$;
revoke execute on function public.fn_record_sale_collection(uuid, numeric, date, text, text) from public, anon, authenticated;
grant  execute on function public.fn_record_sale_collection(uuid, numeric, date, text, text) to authenticated;

-- ── F3 ─────────────────────────────────────────────────────────────────────────────────────────────
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
    -- posted-only: a reversed pair must not inflate the per-account debit/credit columns (#863-class over-count).
    select jl.account_id, sum(jl.debit) as debit, sum(jl.credit) as credit
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
     where jl.org_id = p_org and je.status = 'posted'
     group by jl.account_id
  ) t on t.account_id = a.id
  -- include active accounts AND any account (even archived) that still carries postings, so an archived
  -- posted account's balance can't vanish and unbalance the trial balance (#1).
  where a.org_id = p_org and (a.active or t.account_id is not null);

  return v_rows;
end;
$$;
revoke execute on function public.fn_accounting_trial_balance(uuid) from public, anon, authenticated;
grant  execute on function public.fn_accounting_trial_balance(uuid) to authenticated;

commit;
